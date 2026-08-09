import { BrowserWindow } from 'electron'
import { log } from './logger'
import { preloadPath } from './paths'
import { applyNavigationGuards, loadAppRoute } from './window'

// Session popout windows — "open this session in its own OS window"
// (docs/features/session-popout-window.md). Mirrors preview-window.ts: each popout is a
// real BrowserWindow loading the SPA's `/session` route, so a chat can be moved to a
// second display and kept open while the main window works on something else.
//
// MANY can be open at once, one per session: the map is keyed by engineId, so re-opening
// the same session focuses the existing window instead of stacking duplicates.
//
// HAND-OFF, not mirroring: while a session has a popout it is owned by that window — the
// main window shows a "opened in its own window" placeholder instead of the transcript.
// Ownership is what `SESSION_WINDOWS_CHANGED` broadcasts: every renderer gets the current
// set of windowed session ids and decides what to render / which engine events to apply.
//
// Security: the engineId comes from the renderer (L1, untrusted) and lands in a URL query
// param, so it is charset-validated here BEFORE a window is created. It never becomes a
// path in main (the popout re-reads the session through the sidecar, which owns its own
// path checks). The window itself gets the standard preload + contextIsolation + sandbox
// and the shared navigation guards (invariant #4).

// Session engine ids are slugs: legacy `ses-<n>` and the current
// `YYMMDD-adjective-noun-tail` (utils/session-slug.ts) both live in [a-z0-9-].
const SESSION_ID_RE = /^[a-z0-9-]+$/

// Renderer channel: the full set of session ids currently owned by a popout window.
export const SESSION_WINDOWS_CHANGED = 'session:windowsChanged'

export type SessionWindowParams = {
  engineId: string
  title: string
}

const WIDTH = 1040
const HEIGHT = 760
// A popout must not cover the main window pixel-for-pixel: cascade each new one.
const CASCADE_STEP = 28
const CASCADE_WRAP = 6

const windows = new Map<string, BrowserWindow>()
let opened = 0

function assertSessionId(engineId: string): void {
  if (typeof engineId !== 'string' || !SESSION_ID_RE.test(engineId)) {
    throw new Error(`invalid session id: ${String(engineId)}`)
  }
}

export function openSessionIds(): string[] {
  return [...windows.keys()]
}

// Live popout windows — the extra recipients of the engine event stream (ipc.ts). Only
// these and the main window get it: a popout drives a real session, while the tray
// popover is a passive snapshot renderer that must NOT act on the stream (its store
// would auto-continue a background wake a second time).
export function sessionWindowList(): BrowserWindow[] {
  return [...windows.values()].filter((win) => !win.isDestroyed())
}

// Tell EVERY renderer (main window, other popouts, tray popover) which sessions are
// currently owned by a popout. Sent on open + close so the main window can swap the
// detail pane for its hand-off placeholder and back without polling.
function broadcastSessionWindows(): void {
  const ids = openSessionIds()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(SESSION_WINDOWS_CHANGED, ids)
  }
}

export function openSessionWindow(params: SessionWindowParams): void {
  const { engineId } = params
  assertSessionId(engineId)

  const existing = windows.get(engineId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }

  const step = (opened++ % CASCADE_WRAP) * CASCADE_STEP
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: 520,
    minHeight: 420,
    // Shown immediately as a native frame with the session title, so the window exists
    // while the SPA boots; the page then owns the title (useHead).
    title: params.title || engineId,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  if (step) {
    const [x, y] = win.getPosition()
    win.setPosition(x + step, y + step)
  }
  applyNavigationGuards(win)
  windows.set(engineId, win)
  win.on('closed', () => {
    if (windows.get(engineId) === win) {
      windows.delete(engineId)
      // Hand the session BACK: the main window re-takes ownership (and reloads the
      // transcript it stopped following while the popout was up).
      broadcastSessionWindows()
    }
  })

  const query = new URLSearchParams({ id: engineId })
  loadAppRoute(win, `session?${query.toString()}`)
  broadcastSessionWindows()
  log.info('session window opened', { engineId })
}

// Close a session's popout from ANOTHER window ("bring it back here" in the main
// window). Only ever addresses a window this module created, by session id — the
// renderer can't name an arbitrary window. Returns whether one was closed.
export function closeSessionWindow(engineId: string): boolean {
  assertSessionId(engineId)
  const win = windows.get(engineId)
  if (!win || win.isDestroyed()) {
    windows.delete(engineId)
    return false
  }
  win.close()
  return true
}
