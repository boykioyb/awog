import { acceptHMRUpdate, defineStore } from 'pinia'
import { useSettingsStore } from '~/stores/settings'
import { useSessionsStore } from '~/stores/sessions'
import { notify } from '~/utils/notify'

// Live plan-quota watcher. Polls `account.usage` for the active OAuth account of
// each subscription provider (Anthropic claude.ai / OpenAI Codex) and trips a
// banner + native notification when any rate-limit crosses the user threshold.
// Optionally aborts every running session turn while over the threshold
// (kill-switch — opt-in via settings). Transient: nothing here is persisted (the
// toggle/threshold live in settings via `useQuotaWarningSettings`).

export type QuotaProvider = 'anthropic' | 'openai'

export interface QuotaAlert {
  provider: QuotaProvider
  rateLimitType: string
  utilization: number // 0..1+ (1 = at the cap)
  resetsAt?: number
}

interface UsageEntry {
  rateLimitType: string
  utilization: number
  resetsAt?: number
}
interface UsageResponse {
  usage: UsageEntry[]
}

const INITIAL_DELAY_MS = 20_000 // first poll, after startup settles
const CHECK_INTERVAL_MS = 5 * 60 * 1000 // every 5 min while running (sidecar caches 60s)
const FOCUS_MIN_GAP_MS = 60 * 1000 // debounce focus-triggered polls

const keyOf = (a: QuotaAlert): string => `${a.provider}:${a.rateLimitType}`

export const useQuotaStore = defineStore('quota', () => {
  // Current breaches (utilization ≥ threshold), worst-first.
  const alerts = ref<QuotaAlert[]>([])
  const dismissed = ref(false)
  // Set when the last poll actually stopped running turns (kill-switch fired).
  const lastAbortedCount = ref(0)

  // Non-reactive bookkeeping (store is a singleton, so this persists for its
  // life). Tracks breach keys already acted on so a sustained breach notifies
  // once instead of every poll; a key that drops below threshold is forgotten
  // so it can re-fire on the next crossing.
  const acted = new Set<string>()
  let lastCheckMs = 0

  const worst = computed<QuotaAlert | null>(() => alerts.value[0] ?? null)
  const worstPercent = computed(() => (worst.value ? Math.round(worst.value.utilization * 100) : 0))
  const bannerVisible = computed(() => alerts.value.length > 0 && !dismissed.value)

  // True when the last poll saw a plan rate-limit at/over the threshold. Reflects
  // watcher state (≤ poll interval old) — synchronous, so the pre-flight gate can
  // read it without an extra fetch.
  const overThreshold = computed(() => alerts.value.length > 0)

  // Pre-flight gate: refuse to start a new session while over the threshold
  // (opt-in via settings). Read by `sessions.createSession`.
  const blockNewSessions = computed(() => {
    if (!overThreshold.value) return false
    const q = useSettingsStore().quotaWarning
    return q.enabled && q.blockNewSessionsOnThreshold
  })

  function eligibleProviders(): QuotaProvider[] {
    const settings = useSettingsStore()
    const out: QuotaProvider[] = []
    for (const p of ['anthropic', 'openai'] as const) {
      const cfg = settings.providers[p]
      const acc = cfg.accounts.find((a) => a.id === cfg.activeAccountId)
      if (acc?.authMode === 'oauth') out.push(p)
    }
    return out
  }

  async function check(): Promise<void> {
    lastCheckMs = Date.now()
    const settings = useSettingsStore()
    const q = settings.quotaWarning
    if (!q.enabled) {
      alerts.value = []
      acted.clear()
      lastAbortedCount.value = 0
      return
    }
    const sidecar = useSidecar()
    if (!sidecar.available) return

    const providers = eligibleProviders()
    if (providers.length === 0) {
      alerts.value = []
      return
    }

    const found: QuotaAlert[] = []
    for (const provider of providers) {
      try {
        const res = await sidecar.request<UsageResponse>('account.usage', {
          provider,
          force: false,
        })
        for (const e of res.usage ?? []) {
          if (Math.round(e.utilization * 100) >= q.threshold) {
            found.push({
              provider,
              rateLimitType: e.rateLimitType,
              utilization: e.utilization,
              resetsAt: e.resetsAt,
            })
          }
        }
      } catch {
        // Usage is best-effort; a failed fetch shouldn't break the loop.
      }
    }
    found.sort((a, b) => b.utilization - a.utilization)

    // Rising-edge bookkeeping: forget keys that recovered, mark which breaches
    // are newly crossed this poll.
    const liveKeys = new Set(found.map(keyOf))
    for (const k of [...acted]) if (!liveKeys.has(k)) acted.delete(k)
    const fresh = found.filter((a) => !acted.has(keyOf(a)))
    fresh.forEach((a) => acted.add(keyOf(a)))

    alerts.value = found
    if (found.length === 0) {
      dismissed.value = false
      lastAbortedCount.value = 0
      return
    }
    if (fresh.length > 0) dismissed.value = false // re-surface on a new breach

    // Kill-switch: while over threshold, stop any in-flight turn (opt-in).
    let aborted = 0
    if (q.abortSessionsOnThreshold) {
      try {
        aborted = await useSessionsStore().cancelAllRunning()
      } catch {
        // best-effort
      }
    }
    lastAbortedCount.value = aborted

    // Notify on a new breach, or whenever we actually stopped sessions. Native
    // notification self-suppresses when the window is focused (the banner covers
    // the focused case); the tag de-dupes repeats.
    if ((fresh.length > 0 || aborted > 0) && settings.notificationsEnabled) {
      const w = found[0]
      const pct = w ? Math.round(w.utilization * 100) : q.threshold
      notify({
        title: aborted > 0 ? 'AWOG · Sessions stopped' : 'AWOG · Quota warning',
        body:
          aborted > 0
            ? `Plan quota at ${pct}% — stopped ${aborted} running session(s).`
            : `Plan quota at ${pct}% of the limit.`,
        tag: 'awog-quota',
      })
    }
  }

  function dismiss(): void {
    dismissed.value = true
  }

  // Explain a blocked new-session attempt. Re-surfaces the banner (the reliable
  // in-app surface, no permission needed) and fires a native notification — both
  // are the user's only feedback that the click did nothing on purpose. A
  // background re-check keeps the gate state honest.
  function notifyBlockedNewSession(): void {
    dismissed.value = false
    if (useSettingsStore().notificationsEnabled) {
      notify({
        title: 'AWOG · New session blocked',
        body: `Plan quota at ${worstPercent.value}% — new sessions are paused until it recovers.`,
        tag: 'awog-quota-block',
        onlyWhenHidden: false,
      })
    }
    check().catch(() => {})
  }

  // App-lifetime subscription (called from app.vue). Polls on an interval and on
  // window focus, honoring the user's toggle (the toggle is re-read inside
  // `check`, so flipping it takes effect on the next poll).
  function subscribe(): () => void {
    if (!import.meta.client) return () => {}
    const initial = window.setTimeout(() => {
      check().catch(() => {})
    }, INITIAL_DELAY_MS)
    const interval = window.setInterval(() => {
      check().catch(() => {})
    }, CHECK_INTERVAL_MS)
    const onFocus = (): void => {
      if (Date.now() - lastCheckMs >= FOCUS_MIN_GAP_MS) check().catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }

  return {
    alerts,
    dismissed,
    lastAbortedCount,
    worst,
    worstPercent,
    bannerVisible,
    overThreshold,
    blockNewSessions,
    check,
    dismiss,
    notifyBlockedNewSession,
    subscribe,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useQuotaStore, import.meta.hot))
}
