import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSessionsStore } from '~/stores/sessions'
import type { QuotaAction } from '~/stores/sessions'
import { useSettingsStore } from '~/stores/settings'
import { useAccounts } from '~/composables/useAccounts'

// ── Usage-quota guard (Settings → Usage quota) ───────────────────────────────
// Watches each ACCOUNT's real Anthropic 5-hour rate-limit usage (store.quotaUsage,
// fed by account.usage → /api/oauth/usage — the same number the account popover
// shows) against the configured threshold and enforces the three quota actions:
//   • warn       — one-shot toast when an account first crosses the threshold
//     (re-armed once usage drops back below the band — e.g. after the window resets).
//   • abort      — when `abortSessionsOnThreshold`, cancel the in-flight turns of the
//     CROSSING account only (session-scoped store.cancel). Sessions on other accounts
//     are untouched — quota is per-account.
//   • block new  — enforced in store.create() via store.newSessionsBlocked (create
//     returns null when the new session's account is over threshold). The crossing
//     toast below tells the user why a new session was refused.
//
// The guard owns the polling cadence: the sidecar caches account.usage 60s, so a 60s
// poll is at most one network hit per account per window. It also polls on mount (so
// block-new is accurate before any turn runs) and force-refreshes an account right
// after one of its sessions settles a turn (quota just changed).
//
// One app-lifetime mount (QuotaGuardHost in the layout). The toast queue is owned
// here and rendered by the host. SoC: orchestrates store + settings + accounts only.

export type QuotaToast = { id: string; text: string; action?: QuotaAction }

const TOAST_TTL_MS = 6000
const POLL_MS = 60_000

// Module-level toast queue so the host renders exactly what the guard pushes.
const toasts = ref<QuotaToast[]>([])

// Push a quota toast. Exported (module-level, no Vue context needed) so the store
// can surface the "new session blocked" reason from create() — the single gate —
// without importing i18n into the store. An actionable toast (`action` present, e.g.
// "switch account & retry") is NOT auto-dismissed — it waits for the user to click the
// button or the toast body, so the action never vanishes mid-decision.
export function pushQuotaToast(text: string, action?: QuotaAction): void {
  const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  toasts.value = [...toasts.value, action ? { id, text, action } : { id, text }]
  if (action) return
  setTimeout(() => {
    toasts.value = toasts.value.filter((tt) => tt.id !== id)
  }, TOAST_TTL_MS)
}

export function dismissQuotaToast(id: string): void {
  toasts.value = toasts.value.filter((tt) => tt.id !== id)
}

export function useQuotaGuard() {
  const store = useSessionsStore()
  const settings = useSettingsStore()
  const { accountById } = useAccounts()
  const { sessions, quotaUsage } = storeToRefs(store)
  const { t } = useI18n()

  // When the store refuses a new session (create) or a new turn (send) on an
  // over-quota account, surface the reason. The store owns the gate but has no i18n;
  // it passes the account label + which gate fired back.
  store.onQuotaBlocked((account, kind, action) =>
    pushQuotaToast(
      t(kind === 'send' ? 'sessions.quota.blockedSend' : 'sessions.quota.blocked', {
        account: account || t('sessions.quota.account'),
      }),
      action,
    ),
  )

  const accountLabel = (accountId: string): string =>
    accountById(accountId)?.label ?? accountById(accountId)?.display ?? accountId

  // Per-account crossing latch: true once we've warned/aborted for the current
  // crossing; re-armed when usage drops well below the threshold (hysteresis so an
  // account hovering at the edge doesn't spam toasts every poll).
  const warned = new Map<string, boolean>()
  const REARM_MARGIN = 10

  // Track each session's prior status so we can force a fresh usage read the moment a
  // turn settles (streaming/awaiting → idle/error) — that is when quota just changed.
  const prevStatus = new Map<number, string>()

  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    store.refreshQuotaUsage()
    timer = setInterval(() => store.refreshQuotaUsage(), POLL_MS)
  })

  const stop = watch(
    // Snapshot session id/account/status + the per-account usage map + settings so the
    // callback re-runs after each poll, turn settle, or setting change.
    () => ({
      list: sessions.value.map((s) => ({ id: s.id, accountId: s.accountId, status: s.status })),
      usage: quotaUsage.value,
      q: { ...settings.quota },
    }),
    ({ list }) => {
      // Force-refresh accounts whose session just settled a turn (fresh read for the
      // next gate). Done first so a crossing surfaced this tick reflects the new value.
      for (const s of list) {
        const prev = prevStatus.get(s.id)
        const wasRunning = prev === 'streaming' || prev === 'awaiting'
        const running = s.status === 'streaming' || s.status === 'awaiting'
        if (wasRunning && !running && s.accountId) void store.refreshAccountQuota(s.accountId, true)
        prevStatus.set(s.id, s.status)
      }
      for (const id of [...prevStatus.keys()]) {
        if (!list.some((s) => s.id === id)) prevStatus.delete(id)
      }

      const q = settings.quota
      if (!q.enabled) return

      // Group sessions by account — quota is per-account, so we evaluate once per
      // account (not once per session, which would spam when several share an account).
      const byAccount = new Map<string, { running: number[] }>()
      for (const s of list) {
        if (!s.accountId) continue
        const g = byAccount.get(s.accountId) ?? { running: [] }
        if (s.status === 'streaming' || s.status === 'awaiting') g.running.push(s.id)
        byAccount.set(s.accountId, g)
      }

      const live = new Set<string>()
      for (const [accountId, g] of byAccount) {
        live.add(accountId)
        const pct = store.quotaPctForAccount(accountId)
        const latched = warned.get(accountId) ?? false
        if (pct < q.threshold - REARM_MARGIN) {
          if (latched) warned.set(accountId, false)
          continue
        }
        if (pct < q.threshold || latched) continue
        warned.set(accountId, true)
        const account = accountLabel(accountId)
        pushQuotaToast(t('sessions.quota.warn', { account, pct: Math.round(pct) }))
        // Abort the crossing account's in-flight turns only (session-scoped). Never
        // touches an idle session or a session on a different account.
        if (q.abortSessionsOnThreshold && g.running.length) {
          for (const id of g.running) void store.cancel(id)
          pushQuotaToast(t('sessions.quota.aborted', { account }))
        }
      }
      // Drop accounts no longer in use so the latch map doesn't grow unbounded.
      for (const id of [...warned.keys()]) if (!live.has(id)) warned.delete(id)
    },
    { deep: true },
  )

  onBeforeUnmount(() => {
    stop()
    if (timer) clearInterval(timer)
  })

  return { toasts }
}
