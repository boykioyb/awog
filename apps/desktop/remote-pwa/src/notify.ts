import { ref } from 'vue'

// Alerts for the "away from desk" case: a permission gate / finished turn should
// reach the user even when the PWA is not the foreground app.
//
// CAPABILITY NOTE — the gateway serves the PWA over plain HTTP on the tailnet IP
// (invariant #6: no public bind, no cert), so the page is NOT a secure context.
// Browsers gate `Notification` + `serviceWorker` + `setAppBadge` on that, so all
// three are feature-detected and degrade to the in-app signal (a vibration + the
// gate badge in the session list). Put the PWA behind a Tailscale HTTPS name
// (`tailscale serve`) and the same code lights up with real notifications —
// nothing here needs to change.

export type NotifyState = 'unsupported' | 'default' | 'granted' | 'denied'

const ENABLED_KEY = 'awog.remote.notify'

function readNotification(): typeof Notification | null {
  return typeof Notification === 'undefined' ? null : Notification
}

export const supported = typeof window !== 'undefined' && !!readNotification() && window.isSecureContext

export const state = ref<NotifyState>(
  supported ? ((readNotification()?.permission ?? 'default') as NotifyState) : 'unsupported',
)

export const enabled = ref<boolean>(localStorage.getItem(ENABLED_KEY) !== 'off')

export function setEnabled(on: boolean): void {
  enabled.value = on
  localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off')
}

export async function requestPermission(): Promise<void> {
  const api = readNotification()
  if (!supported || !api) return
  try {
    state.value = (await api.requestPermission()) as NotifyState
  } catch {
    state.value = 'denied'
  }
}

// Short haptic pulse — the fallback signal when notifications aren't available.
// Best-effort: unsupported / blocked without user activation on some browsers.
export function buzz(pattern: number | number[] = 60): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* ignore */
  }
}

interface NotifyInput {
  title: string
  body: string
  // Replaces an earlier notification with the same tag instead of stacking.
  tag: string
}

export async function notify({ title, body, tag }: NotifyInput): Promise<void> {
  buzz()
  const api = readNotification()
  if (!supported || !api || !enabled.value || state.value !== 'granted') return
  const options: NotificationOptions = { body, tag, icon: './icon.svg', badge: './icon.svg' }
  try {
    // A service-worker notification is the only kind Android Chrome shows while
    // the page is backgrounded; the constructor is the desktop-browser fallback.
    const reg = await navigator.serviceWorker?.ready
    if (reg) {
      await reg.showNotification(title, options)
      return
    }
  } catch {
    /* fall through to the constructor */
  }
  try {
    new api(title, options)
  } catch {
    /* ignore */
  }
}

// App icon badge (how many gates are waiting). Best-effort — same secure-context
// gate as notifications, and absent entirely on most desktop browsers.
export function setBadge(count: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  try {
    if (count > 0) void nav.setAppBadge?.(count)
    else void nav.clearAppBadge?.()
  } catch {
    /* ignore */
  }
}
