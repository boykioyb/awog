import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { log } from './logger'
import { MEDIA_SCHEME } from './media'
import { DEV_URL, preloadPath, uiDir } from './paths'

// Custom scheme for serving the packaged Nuxt SPA. Registered as privileged so
// it behaves like https (secure context, fetch, standard URL parsing) — needed
// for the SPA's absolute asset paths + client-side history routing.
const APP_SCHEME = 'app'
const APP_ORIGIN = `${APP_SCHEME}://bundle`

export function registerAppProtocolScheme(): void {
  // registerSchemesAsPrivileged accepts a single call with every custom scheme —
  // list the SPA bundle scheme and the media stream scheme together here.
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
    {
      // media:// streams workspace video/audio into the preview (see media.ts).
      // `stream: true` lets the handler return a non-buffered streaming Response
      // body; standard + secure so <video>/<audio> treat it as a normal, seekable,
      // same-privilege source.
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

// Serve files from the packaged UI dir. `nuxt generate` emits a per-route
// DIRECTORY (e.g. sessions/, agents/) each with its own index.html, plus a
// 200.html SPA fallback. So: a real file → serve it; a route directory → serve
// its index.html; anything missing (deep/dynamic route, e.g. /sessions/abc) →
// 200.html so client-side routing resolves it. Fetching a directory directly
// would fail the navigation with ERR_UNEXPECTED (white screen).
let appProtocolHandlerRegistered = false

function registerAppProtocolHandler(): void {
  // protocol.handle throws if called twice for the same scheme. createMainWindow
  // runs again on every macOS dock re-activate, so register only once — else the
  // re-opened window throws before it can show (app "won't reopen" from the dock).
  if (appProtocolHandlerRegistered) return
  appProtocolHandlerRegistered = true
  protocol.handle(APP_SCHEME, (request) => {
    const { pathname } = new URL(request.url)
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '')
    let filePath = rel === '' ? join(uiDir(), 'index.html') : join(uiDir(), rel)
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, 'index.html')
    }
    if (!existsSync(filePath)) filePath = join(uiDir(), '200.html')
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

// Navigation policy for every window that hosts the AWOG SPA (main window, preview
// popouts). Applied per window so a secondary surface can't drift from the rules.
//
//   - External links (target="_blank" / window.open / an off-origin http(s) navigation,
//     e.g. a link inside rendered issue/PR markdown) open in the OS browser, never
//     inside the app shell.
//   - An INTERNAL navigation that changes the path is refused. This is the last-resort
//     net for the "a markdown link nukes the app" class of bug: a plain
//     <a href="backend/app/x.py"> is a REAL document navigation, which throws the
//     running SPA away and lands on the 404 route — every open session, panel and
//     unsaved bit of UI state gone. The renderer intercepts those clicks
//     (utils/file-links + useMdFileLink) and opens the file in the preview instead, but
//     a surface that forgets must not be able to break the whole app. A same-path
//     reload (⌘R, Vite full reload) still passes; a path CHANGE never can, since the
//     SPA router only ever navigates via pushState.
export function applyNavigationGuards(win: BrowserWindow): void {
  const isInternalUrl = (url: string): boolean =>
    url.startsWith(APP_ORIGIN) || url.startsWith(DEV_URL)
  // Path of an in-app URL, for comparing "same document" vs "different route".
  const pathOf = (url: string): string => {
    try {
      return new URL(url).pathname
    } catch {
      return url
    }
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (isInternalUrl(url)) {
      if (pathOf(url) !== pathOf(win.webContents.getURL())) {
        e.preventDefault()
        log.warn('blocked in-app document navigation', { url })
      }
      return
    }
    if (/^https?:\/\//i.test(url)) {
      e.preventDefault()
      void shell.openExternal(url)
    }
  })
}

// Load a SPA route into an arbitrary window (dev URL or packaged app:// scheme).
// Shared by secondary windows (e.g. the tray popover) so they reach the same
// Nuxt app. Dev retries until the Nuxt server is up, mirroring loadDevUrl.
export function loadAppRoute(win: BrowserWindow, route: string): void {
  const rel = route.replace(/^\/+/, '')
  if (app.isPackaged) {
    registerAppProtocolHandler()
    void win.loadURL(`${APP_ORIGIN}/${rel}`)
    return
  }
  const url = `${DEV_URL.replace(/\/+$/, '')}/${rel}`
  win.loadURL(url).catch(() => undefined)
  win.webContents.on('did-fail-load', () => {
    if (win.isDestroyed()) return
    setTimeout(() => {
      if (!win.isDestroyed()) win.loadURL(url).catch(() => undefined)
    }, 500)
  })
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'AWOG',
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Chromium keeps zoom per ORIGIN, shared by every window on it — so a stray
  // setZoomFactor anywhere (an earlier build of the pet window did exactly this)
  // leaves the whole app scaled, and it survives a restart. AWOG never zooms
  // deliberately, so pin the main window back to 1: a no-op normally, a repair for
  // an install that already caught it.
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(1))

  applyNavigationGuards(win)

  // DevTools toggle (F12 / Ctrl+Shift+I / Cmd+Opt+I) — works in the PACKAGED app
  // too, since hiding the menu removed the default shortcut. Needed to diagnose
  // renderer issues (e.g. white screens) on installed builds.
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    const isToggle =
      key === 'f12' ||
      (input.control && input.shift && key === 'i') ||
      (input.meta && input.alt && key === 'i')
    if (isToggle) win.webContents.toggleDevTools()
  })

  // Surface renderer failures into the log file — a packaged GUI has no console,
  // so a white-screen (e.g. a Vue render throw) would otherwise be invisible.
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) log.error(`[renderer] ${message} (${sourceId}:${line})`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error(`[renderer] process gone: ${details.reason} (exitCode ${details.exitCode})`)
  })
  if (app.isPackaged) {
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      if (code !== -3) log.error(`[renderer] did-fail-load ${code} ${desc} ${url}`)
    })
  }

  if (app.isPackaged) {
    registerAppProtocolHandler()
    // Load the ROOT, not /index.html — the SPA router must see path "/" (the
    // home route), else it treats "/index.html" as an unknown route → 404. The
    // protocol handler still serves index.html for "/".
    void win.loadURL(`${APP_ORIGIN}/`)
  } else {
    loadDevUrl(win)
    // Dev: open DevTools so renderer errors (e.g. a white-screen route) are
    // visible immediately — the hidden menu removes the default toggle shortcut.
    win.webContents.openDevTools({ mode: 'detach' })
  }

  return win
}

// In dev the Nuxt server may not be listening yet when Electron boots. Retry the
// load on failure instead of showing a blank window.
function loadDevUrl(win: BrowserWindow): void {
  win.loadURL(DEV_URL).catch(() => undefined)
  win.webContents.on('did-fail-load', () => {
    if (win.isDestroyed()) return
    setTimeout(() => {
      if (!win.isDestroyed()) win.loadURL(DEV_URL).catch(() => undefined)
    }, 500)
  })
}
