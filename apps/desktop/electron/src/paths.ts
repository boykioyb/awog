import { join } from 'node:path'
import { app } from 'electron'

// Resolve runtime asset locations for both dev and packaged builds.
//
// Dev layout (compiled main lives at apps/desktop/electron/dist/main.js):
//   __dirname = apps/desktop/electron/dist
//   engine    = apps/desktop/sidecar/dist/lib/src/index.js  (tsc output)
//   ui        = served by Nuxt dev server at http://localhost:3030
//
// Packaged layout (electron-builder, engine + UI shipped as extraResources):
//   engine    = <resources>/sidecar/lib/src/index.js
//   ui        = <resources>/ui/index.html

export const DEV_URL = 'http://localhost:3030'

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

// Absolute path to the bundled RTK binary (ADR 0031). Handed to the engine via
// AWOG_RTK_BIN at spawn so the sidecar's Bash tool can compress command output.
// Mirrors enginePath()'s dev/packaged split. The binary is fetched into
// electron/resources/rtk/ by scripts/fetch-rtk.mjs and shipped via extraResources.
export function rtkBinPath(): string {
  const binName = process.platform === 'win32' ? 'rtk.exe' : 'rtk'
  if (app.isPackaged) {
    return join(process.resourcesPath, 'rtk', binName)
  }
  return join(__dirname, '..', 'resources', 'rtk', binName)
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
