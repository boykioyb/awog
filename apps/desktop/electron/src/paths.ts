import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// Resolve runtime asset locations for both dev and packaged builds.
//
// Dev layout (compiled main lives at apps/desktop/electron/dist/main.js):
//   __dirname = apps/desktop/electron/dist
//   engine    = apps/desktop/sidecar/dist/lib/src/index.js  (tsc output)
//   ui        = served by Nuxt dev server (ui-next on :3031 by default)
//
// Packaged layout (electron-builder, engine + UI shipped as extraResources):
//   engine    = <resources>/sidecar/lib/src/index.js
//   ui        = <resources>/ui/index.html

// Dev UI dev-server URL. Defaults to the ui-next rebuild (:3031); override with
// AWOG_DEV_URL to point at the legacy ui (http://localhost:3030) or another host.
// See tasks/session-screen-checklist.md §10 (Electron → ui-next).
export const DEV_URL = process.env.AWOG_DEV_URL ?? 'http://localhost:3031'

export function enginePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'sidecar', 'lib', 'src', 'index.js')
  }
  return join(__dirname, '..', '..', 'sidecar', 'dist', 'lib', 'src', 'index.js')
}

// Directory that holds the generated Nuxt SPA (index.html + _nuxt assets).
// Only used in packaged builds; dev loads DEV_URL instead.
export function uiDir(): string {
  return join(process.resourcesPath, 'ui')
}

export function preloadPath(): string {
  return join(__dirname, 'preload.js')
}

// Bundled openvpn binary shipped as an extraResource so users don't have to install
// it themselves (VPN Manager, ADR 0065). Populated per platform+arch by
// scripts/vendor-openvpn.mjs into vendor/openvpn/<platform>-<arch>/. Returns the
// path only when it actually exists — otherwise the sidecar falls back to a system
// install. Bundling removes the *install* step; the tunnel still needs an admin
// prompt (openvpn must be root to create the tun device).
export function openvpnBinPath(): string | null {
  const slot = `${process.platform}-${process.arch}`
  const exe = process.platform === 'win32' ? 'openvpn.exe' : 'openvpn'
  const base = app.isPackaged
    ? join(process.resourcesPath, 'openvpn', slot, exe)
    : join(__dirname, '..', 'vendor', 'openvpn', slot, exe)
  return existsSync(base) ? base : null
}

// Tray icon. macOS uses a monochrome TEMPLATE image (transparent bg, auto
// black/white per menu-bar appearance — no background tile); Windows/Linux use
// the colored icon. createFromPath auto-loads the @2x variant alongside.
// Dev: the package's build/ assets. Packaged: shipped via extraResources.
export function trayIconPath(): string {
  const name = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'
  if (app.isPackaged) return join(process.resourcesPath, name)
  return join(__dirname, '..', 'build', name)
}
