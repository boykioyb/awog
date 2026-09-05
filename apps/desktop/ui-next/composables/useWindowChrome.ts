import { onScopeDispose } from 'vue'

// Publishes the host window's native chrome state onto <body> so the shell CSS can
// react to it (docs/features/native-macos-polish.md §4 W1):
//
//   body[data-platform]   'darwin' | 'win32' | 'linux' | 'browser' (plain browser dev)
//   body[data-fullscreen] present ONLY while the window is fullscreen
//
// Why the DOM and not a store: these drive pure layout insets (the strip the macOS
// traffic lights need, the top-bar height), which app-shell.css owns end to end. No
// component needs to read them, so nothing has to re-render when they change.
//
// App-lifetime: called ONCE from app.vue. The `layout: false` surfaces (session
// popout, tray popover, pet) have no `.top`/`.side`, so the attributes are inert
// there — but they cost nothing and keep every renderer describing itself the same way.
export function useWindowChrome(): void {
  if (typeof document === 'undefined') return
  const bridge = typeof window !== 'undefined' ? window.awog : undefined

  document.body.dataset.platform = bridge?.platform ?? 'browser'

  const setFullscreen = (fullscreen: boolean): void => {
    if (fullscreen) document.body.dataset.fullscreen = '1'
    else delete document.body.dataset.fullscreen
  }
  // A window never starts fullscreen; main re-pushes the truth after every load.
  setFullscreen(false)

  const off = bridge?.onFullscreen?.(setFullscreen)
  if (off) onScopeDispose(off)
}
