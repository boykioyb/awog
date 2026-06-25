import { onBeforeUnmount, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSessionsStore } from '~/stores/sessions'
import type { Session } from '~/composables/useSessionsMock'

// ── Native turn-complete notification (§9 globals) ───────────────────────────
// Watches every session's status and fires a browser Notification when a turn
// settles (streaming/awaiting → done/error). The Electron renderer is Chromium,
// so the Notification API is available. Gating:
//   • only when the window is NOT focused (document.hidden) — avoid in-app noise
//   • permission requested once, lazily, on first eligible transition
//   • no-op + guarded when unsupported / permission denied
// Call once globally (in the layout). Returns nothing; lives for the app's life.

// Statuses considered "in flight" → a transition out of these is a turn settle.
const ACTIVE = new Set<Session['status']>(['streaming', 'awaiting'])
const SETTLED = new Set<Session['status']>(['done', 'error'])

export function useNativeNotify() {
  const store = useSessionsStore()
  const { sessions } = storeToRefs(store)
  const { t } = useI18n()

  // Last seen status per session id (numeric client id). Seeded on first run so
  // we never notify for the initial hydrate snapshot.
  const lastStatus = new Map<number, Session['status']>()
  let seeded = false

  // Notification API is absent in pure SSR / locked-down webviews.
  const supported = typeof window !== 'undefined' && 'Notification' in window

  // Request permission lazily so we don't prompt on app boot. Resolves to the
  // final permission; cached implicitly by the browser.
  let permissionAsked = false
  async function ensurePermission(): Promise<NotificationPermission> {
    if (!supported) return 'denied'
    if (Notification.permission !== 'default') return Notification.permission
    if (permissionAsked) return Notification.permission
    permissionAsked = true
    try {
      return await Notification.requestPermission()
    } catch {
      return 'denied'
    }
  }

  // Window-focus gate: only notify when the window is hidden / blurred.
  function windowIsHidden(): boolean {
    if (typeof document === 'undefined') return false
    return document.hidden || !document.hasFocus()
  }

  async function notifyTurn(s: Session) {
    if (!supported || !windowIsHidden()) return
    const perm = await ensurePermission()
    if (perm !== 'granted') return
    // Re-check focus — the permission prompt may have refocused the window.
    if (!windowIsHidden()) return
    const isError = s.status === 'error'
    const title = isError ? t('palette.notify.turnError.title') : t('palette.notify.turnDone.title')
    const body = isError
      ? t('palette.notify.turnError.body', { title: s.title })
      : t('palette.notify.turnDone.body', { title: s.title })
    try {
      const n = new Notification(title, { body, tag: `awog-session-${s.id}` })
      // Focusing the window on click is best-effort; ignore if blocked.
      n.onclick = () => {
        try {
          window.focus()
        } catch {
          /* noop */
        }
      }
    } catch {
      // Construction can throw if permission was revoked mid-flight — swallow.
    }
  }

  // Watch the whole list shallowly: we only need each session's id+status. A
  // single deep-ish watch keeps it simple (the list is small in practice).
  const stop = watch(
    () =>
      sessions.value.map((s) => ({
        id: s.id,
        status: s.status,
        title: s.title,
      })),
    (snapshot) => {
      if (!seeded) {
        for (const s of snapshot) lastStatus.set(s.id, s.status)
        seeded = true
        return
      }
      const live = new Set<number>()
      for (const s of snapshot) {
        live.add(s.id)
        const prev = lastStatus.get(s.id)
        lastStatus.set(s.id, s.status)
        if (prev != null && ACTIVE.has(prev) && SETTLED.has(s.status)) {
          const full = sessions.value.find((x) => x.id === s.id)
          if (full) void notifyTurn(full)
        }
      }
      // Drop removed sessions so the map doesn't grow unbounded.
      for (const id of [...lastStatus.keys()]) if (!live.has(id)) lastStatus.delete(id)
    },
    { deep: true },
  )

  onBeforeUnmount(stop)
}
