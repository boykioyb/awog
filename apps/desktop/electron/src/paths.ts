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

// Tray icon. Dev: the package's build/ assets. Packaged: shipped to
// <resources>/tray.png via electron-builder extraResources.
export function trayIconPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'tray.png')
  return join(__dirname, '..', 'build', 'tray.png')
}
