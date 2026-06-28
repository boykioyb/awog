import { onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSessionsStore } from '~/stores/sessions'
import { useSettingsStore } from '~/stores/settings'

// ── Quota warning guard (Settings → Quota warning) ───────────────────────────
// Watches every session's context-window usage % (store.usagePct) against the
// configured threshold and enforces the three quota actions:
//   • warn          — surface a one-shot toast when a session first crosses the
//     threshold (re-armed when it drops back below the band).
//   • abort         — when `abortSessionsOnThreshold`, cancel the in-flight turn of
//     a crossing session (session-scoped store.cancel — reuses the existing abort).
//   • block new     — enforced in store.create() via store.newSessionsBlocked
//     (create returns null when over threshold). Not handled here; the crossing
//     toast below already tells the user why a new session was refused.
//
// One app-lifetime mount (QuotaGuardHost in the layout). The toast queue is owned
// here and rendered by the host. SoC: orchestrates store + settings only.

export type QuotaToast = { id: string; text: string }

const TOAST_TTL_MS = 6000

// Module-level toast queue so the host renders exactly what the guard pushes.
const toasts = ref<QuotaToast[]>([])

// Push a quota toast. Exported (module-level, no Vue context needed) so the store
// can surface the "new session blocked" reason from create() — the single gate —
// without importing i18n into the store.
export function pushQuotaToast(text: string): void {
  const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  toasts.value = [...toasts.value, { id, text }]
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
  const { sessions } = storeToRefs(store)
  const { t } = useI18n()

  // When create() refuses a new session (blockNewSessionsOnThreshold), surface the
  // reason. The store owns the gate but has no i18n; it calls this back. Registered
  // here (the guard owns the toast queue + i18n) so the message is localised.
  store.onNewSessionBlocked(() => pushQuotaToast(t('sessions.quota.blocked')))

  // Per-session crossing latch: true once we've warned/aborted for the current
  // crossing; re-armed when usage drops well below the threshold (hysteresis so a
  // session hovering at the edge doesn't spam toasts every turn).
  const warned = new Map<number, boolean>()
  const REARM_MARGIN = 10

  const stop = watch(
    // Snapshot id + usage% + status so the watcher fires after each turn settles
    // (usagePct changes when store.usage merges the turn's tokens).
    () =>
      sessions.value.map((s) => ({
        id: s.id,
        title: s.title,
        pct: store.usagePct(s),
        status: s.status,
      })),
    (snapshot) => {
      const q = settings.quota
      const live = new Set<number>()
      for (const s of snapshot) {
        live.add(s.id)
        const crossed = q.enabled && s.pct >= q.threshold
        const latched = warned.get(s.id) ?? false
        // Re-arm once usage falls back below threshold − margin (after a compaction
        // cut or a fork) so a later re-fill warns again.
        if (s.pct < q.threshold - REARM_MARGIN) {
          if (latched) warned.set(s.id, false)
          continue
        }
        if (!crossed || latched) continue
        warned.set(s.id, true)
        pushQuotaToast(t('sessions.quota.warn', { title: s.title, pct: Math.round(s.pct) }))
        // Abort the in-flight turn of a crossing session (session-scoped). Only when
        // the user opted in AND a turn is actually running/awaiting — never cancel an
        // idle session.
        if (q.abortSessionsOnThreshold && (s.status === 'streaming' || s.status === 'awaiting')) {
          void store.cancel(s.id)
          pushQuotaToast(t('sessions.quota.aborted', { title: s.title }))
        }
      }
      // Drop removed sessions so the latch map doesn't grow unbounded.
      for (const id of [...warned.keys()]) if (!live.has(id)) warned.delete(id)
    },
    { deep: true },
  )

  onBeforeUnmount(stop)

  return { toasts }
}
