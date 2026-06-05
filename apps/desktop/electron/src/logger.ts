import { shell } from 'electron'
import log from 'electron-log/main'

// Centralized file logging for the packaged app. A GUI build has no terminal
// attached, so main-process stderr/stdout is invisible — electron-log writes to
// a file at the OS-standard logs dir (app.getPath('logs')):
//   macOS   ~/Library/Logs/AWOG/main.log
//   Windows %AppData%/AWOG/logs/main.log
//   Linux   ~/.config/AWOG/logs/main.log
// This is where updater failures, uncaught exceptions and engine output land so
// they can be inspected (or sent to support) after a release.

export { log }

export function setupLogging(): void {
  // Keep ~5 days of logs by rotating at 5 MB. Console transport stays on for dev.
  log.transports.file.level = 'info'
  log.transports.file.maxSize = 5 * 1024 * 1024

  // Capture renderer console too (best-effort under sandbox/contextIsolation).
  log.initialize()

  // Last-resort handlers so a crash leaves a trace instead of a silent quit.
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException', err)
  })
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', reason)
  })

  log.info('app starting', { version: process.env.npm_package_version ?? 'unknown' })
}

// Absolute path of the current log file — derived internally (never from the
// renderer), so revealing it doesn't widen any allowlist (invariant #7).
export function logFilePath(): string {
  return log.transports.file.getFile().path
}

export function revealLogs(): void {
  shell.showItemInFolder(logFilePath())
}
