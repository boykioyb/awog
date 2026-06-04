// Thin wrapper around the web Notification API. Works inside the Tauri webview
// without a Rust plugin; if/when we need richer features (sound, actions, dock
// badge), upgrade to `tauri-plugin-notification`.

let cachedPermission: NotificationPermission | null = null

async function ensurePermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (cachedPermission === null) cachedPermission = Notification.permission
  if (cachedPermission === 'default') {
    try {
      cachedPermission = await Notification.requestPermission()
    } catch {
      cachedPermission = 'denied'
    }
  }
  return cachedPermission === 'granted'
}

export interface NotifyOptions {
  title: string
  body?: string
  // De-dupe key — same tag replaces an existing notification instead of stacking.
  tag?: string
  // Suppress when the window is already focused (default true — user can see
  // the inline UI anyway). Pass false to always notify.
  onlyWhenHidden?: boolean
}

export async function notify(opts: NotifyOptions): Promise<void> {
  if (typeof document !== 'undefined') {
    const hidden = document.hidden || !document.hasFocus()
    if ((opts.onlyWhenHidden ?? true) && !hidden) return
  }
  if (!(await ensurePermission())) return
  try {
    const init: NotificationOptions = {}
    if (opts.body) init.body = opts.body
    if (opts.tag) init.tag = opts.tag
    const n = new Notification(opts.title, init)
    n.onclick = () => {
      if (typeof window !== 'undefined') window.focus()
      n.close()
    }
  } catch {
    // Webview may reject (e.g. permission revoked) — silently ignore.
  }
}
