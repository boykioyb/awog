import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { log, revealLogs } from './logger'

// Auto-update (ADR 0028). electron-updater + GitHub provider; the owner/repo is
// baked into app-update.yml by electron-builder's publish config, so the feed
// host is fixed and never comes from the renderer. The renderer drives the
// SCHEDULE (so the user's auto-update toggle is respected); the main process is
// purely reactive — it checks on request and forwards updater events.

// Releases page for notify-only platforms (macOS unsigned + Linux .deb). A
// FIXED URL — never built from renderer input — so shell:openExternal's
// allowlist in ipc.ts stays untouched (security invariant #7).
const RELEASES_URL = 'https://github.com/boykioyb/awog/releases/latest'

// Where electron-updater can replace the running app in place. macOS is excluded
// until the build is code-signed (Squirrel.Mac rejects unsigned updates); .deb
// is managed by apt, so on Linux only the AppImage updates itself.
const canAutoInstall =
  process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE)

type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

export function setupUpdater(getWindow: () => BrowserWindow | null): void {
  const send = (event: UpdateEvent): void => {
    getWindow()?.webContents.send('updater:event', event)
  }

  // App info is always available — the renderer needs the version + capability
  // even in dev (to show "dev mode" and skip scheduling).
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    canAutoInstall,
  }))

  // Opening the releases page is harmless in dev too (notify-only fallback).
  ipcMain.handle('updater:openReleases', () => shell.openExternal(RELEASES_URL))

  // Reveal the log file in the OS file manager (path derived internally).
  ipcMain.handle('app:openLogs', () => revealLogs())

  // electron-updater throws when the app isn't packaged. Keep the remaining
  // updater IPC as no-ops in dev so "Check now" degrades cleanly, not crashes.
  if (!app.isPackaged) {
    ipcMain.handle('updater:check', () => {})
    ipcMain.handle('updater:download', () => {})
    ipcMain.handle('updater:install', () => {})
    return
  }

  autoUpdater.logger = log // persist all updater activity to the log file
  autoUpdater.autoDownload = false // ask the user before pulling the bytes (ADR 0028)
  autoUpdater.autoInstallOnAppQuit = true // a downloaded update still installs on next quit

  autoUpdater.on('checking-for-update', () => send({ type: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ type: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send({ type: 'not-available' }))
  autoUpdater.on('download-progress', (p) => send({ type: 'progress', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => send({ type: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) =>
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
  )

  ipcMain.handle('updater:check', async () => {
    // Errors surface via the 'error' event above; swallow the rejection so it
    // doesn't become an unhandled promise.
    await autoUpdater.checkForUpdates().catch(() => {})
  })
  ipcMain.handle('updater:download', async () => {
    await autoUpdater.downloadUpdate().catch(() => {})
  })
  ipcMain.handle('updater:install', () => {
    // Quits the app then installs. before-quit (main.ts) stops the engine first,
    // so no orphaned child process survives the relaunch (restart-safe).
    autoUpdater.quitAndInstall()
  })
}
