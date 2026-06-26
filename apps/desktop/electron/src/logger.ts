import { unwatchFile, watchFile } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { ipcMain, shell, type BrowserWindow } from 'electron'
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

// ── Live log tail (Diagnostics panel) ───────────────────────────────────────
// The Settings → Diagnostics panel streams the tail of the log file into an
// in-app terminal view instead of only revealing it in the file manager. The
// path is still derived internally (logFilePath) — the renderer never supplies
// it — so this widens no allowlist (invariant #7). One tailer is active at a
// time: the panel opens → start, closes/unmounts → stop.

const INITIAL_TAIL_BYTES = 64 * 1024 // last 64 KB shown when the panel opens

export type LogTailEvent =
  | { type: 'init'; content: string; path: string }
  | { type: 'data'; chunk: string }
  | { type: 'error'; message: string }

let tailFile: string | null = null
let tailPosition = 0
let tailReading = false

// Read everything appended since tailPosition and forward it. Guarded against
// re-entrancy (watchFile can fire while a read is in flight) and resets to 0 if
// the file shrank — electron-log rotates the file at maxSize.
async function readLogDelta(send: (event: LogTailEvent) => void): Promise<void> {
  if (tailReading || !tailFile) return
  tailReading = true
  let handle: FileHandle | null = null
  try {
    handle = await open(tailFile, 'r')
    const { size } = await handle.stat()
    if (size < tailPosition) tailPosition = 0 // rotated / truncated → re-read from start
    if (size > tailPosition) {
      const length = size - tailPosition
      const buf = Buffer.alloc(length)
      await handle.read(buf, 0, length, tailPosition)
      tailPosition = size
      send({ type: 'data', chunk: buf.toString('utf8') })
    }
  } catch {
    // Transient (file mid-rotation) — the next watchFile tick re-reads.
  } finally {
    await handle?.close()
    tailReading = false
  }
}

export async function startLogTail(send: (event: LogTailEvent) => void): Promise<void> {
  stopLogTail()
  const file = logFilePath()
  tailFile = file
  try {
    const handle = await open(file, 'r')
    try {
      const { size } = await handle.stat()
      const start = Math.max(0, size - INITIAL_TAIL_BYTES)
      const length = size - start
      const buf = Buffer.alloc(length)
      if (length > 0) await handle.read(buf, 0, length, start)
      tailPosition = size
      send({ type: 'init', content: buf.toString('utf8'), path: file })
    } finally {
      await handle.close()
    }
  } catch (err) {
    tailFile = null
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    return
  }
  // Poll-based watch survives log rotation (a rename leaves fs.watch on the old
  // inode silent). 1 s latency is fine for a diagnostics view.
  watchFile(file, { interval: 1000 }, () => {
    void readLogDelta(send)
  })
}

export function stopLogTail(): void {
  if (tailFile) unwatchFile(tailFile)
  tailFile = null
  tailPosition = 0
  tailReading = false
}

// IPC for the live log tail. Events ride a dedicated `app:logData` channel
// (mirrors updater:event), so they never mix with engine:event traffic.
export function registerLogTailIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('app:tailLogs:start', async () => {
    await startLogTail((event) => {
      getWindow()?.webContents.send('app:logData', event)
    })
  })
  ipcMain.handle('app:tailLogs:stop', () => {
    stopLogTail()
  })
}
