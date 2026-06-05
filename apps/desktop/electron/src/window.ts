import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, net, protocol } from 'electron'
import { DEV_URL, preloadPath, uiDir } from './paths'

// Custom scheme for serving the packaged Nuxt SPA. Registered as privileged so
// it behaves like https (secure context, fetch, standard URL parsing) — needed
// for the SPA's absolute asset paths + client-side history routing.
const APP_SCHEME = 'app'
const APP_ORIGIN = `${APP_SCHEME}://bundle`

export function registerAppProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ])
}

// Serve files from the packaged UI dir. `nuxt generate` emits a per-route
// DIRECTORY (e.g. sessions/, agents/) each with its own index.html, plus a
// 200.html SPA fallback. So: a real file → serve it; a route directory → serve
// its index.html; anything missing (deep/dynamic route, e.g. /sessions/abc) →
// 200.html so client-side routing resolves it. Fetching a directory directly
// would fail the navigation with ERR_UNEXPECTED (white screen).
function registerAppProtocolHandler(): void {
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

  if (app.isPackaged) {
    registerAppProtocolHandler()
    // Load the ROOT, not /index.html — the SPA router must see path "/" (the
    // home route), else it treats "/index.html" as an unknown route → 404. The
    // protocol handler still serves index.html for "/".
    void win.loadURL(`${APP_ORIGIN}/`)
  } else {
    loadDevUrl(win)
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
