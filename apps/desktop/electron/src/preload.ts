import { contextBridge, ipcRenderer, webUtils } from 'electron'

// Preload bridge — runs sandboxed (contextIsolation + sandbox). Exposes a single
// `window.awog` object; the renderer never touches ipcRenderer/Node directly
// (security invariant #4). The shape mirrors the old useSidecar public API so
// the rest of the Nuxt UI is unaffected.

type RpcErrorShape = { code: number; message: string; data?: unknown }
type RequestResult = { ok: true; value: unknown } | { ok: false; error: RpcErrorShape }
type EngineEvent = { type: string; payload: unknown }
type DialogOpts = { title?: string; defaultPath?: string }
type FileFilter = { name: string; extensions: string[] }
type SavePathOpts = DialogOpts & { filters?: FileFilter[] }
type AppInfo = { version: string; isPackaged: boolean; canAutoInstall: boolean }
type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }
type LogTailEvent =
  | { type: 'init'; content: string; path: string }
  | { type: 'data'; chunk: string }
  | { type: 'error'; message: string }
// Live tray status (system-tray-status). The main window pushes a lightweight
// indicator model; the styled popover window forwards item clicks as commands.
type TrayCommand =
  | { kind: 'activity' }
  // Stable sidecar engine id ("ses-…") — the popover renderer's numeric client id
  // never matches the main window's store (separate id counters per renderer).
  | { kind: 'session'; engineId: string }
  | { kind: 'task'; id: string }
type TrayModel = { macTitle: string; tooltip: string }

const awog = {
  // Returns the JSON-RPC result, or rejects with the RpcErrorShape so the
  // renderer can rebuild a typed SidecarError (code/message/data preserved).
  async request(method: string, params?: unknown): Promise<unknown> {
    const res: RequestResult = await ipcRenderer.invoke('engine:request', {
      method,
      params: params ?? null,
    })
    if (res.ok) return res.value
    throw res.error
  },

  // Subscribe to engine events; returns an unsubscribe function.
  onEvent(handler: (event: EngineEvent) => void): () => void {
    const listener = (_e: unknown, event: EngineEvent): void => handler(event)
    ipcRenderer.on('engine:event', listener)
    return () => ipcRenderer.removeListener('engine:event', listener)
  },

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  revealPath: (root: string, path: string): Promise<void> =>
    ipcRenderer.invoke('shell:revealPath', { root, path }),
  openPath: (root: string, path: string): Promise<void> =>
    ipcRenderer.invoke('shell:openPath', { root, path }),
  openFileExternal: (root: string, path: string): Promise<void> =>
    ipcRenderer.invoke('shell:openFileExternal', { root, path }),
  vscodeAvailable: (): Promise<boolean> => ipcRenderer.invoke('shell:vscodeAvailable'),
  openInVscode: (root: string, path: string): Promise<void> =>
    ipcRenderer.invoke('shell:openInVscode', { root, path }),
  pickFolder: (opts?: DialogOpts): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickFolder', opts ?? {}),
  pickFolders: (opts?: DialogOpts): Promise<string[]> =>
    ipcRenderer.invoke('dialog:pickFolders', opts ?? {}),
  // Resolve the absolute on-disk path of a dropped File/folder. Electron ≥32
  // removed the non-standard `File.path`; webUtils.getPathForFile is the
  // supported replacement (runs in the sandboxed preload). Returns '' if the
  // File did not originate from a real filesystem entry.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  savePath: (opts?: SavePathOpts): Promise<string | null> =>
    ipcRenderer.invoke('dialog:savePath', opts ?? {}),

  // Auto-update (ADR 0028). Renderer drives the schedule; main is reactive.
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('updater:check'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('updater:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  openReleasesPage: (): Promise<void> => ipcRenderer.invoke('updater:openReleases'),
  // Reveal the app log file in the OS file manager.
  openLogs: (): Promise<void> => ipcRenderer.invoke('app:openLogs'),
  // Updater events ride a dedicated channel (not engine:event); returns unsubscribe.
  onUpdateEvent(handler: (event: UpdateEvent) => void): () => void {
    const listener = (_e: unknown, event: UpdateEvent): void => handler(event)
    ipcRenderer.on('updater:event', listener)
    return () => ipcRenderer.removeListener('updater:event', listener)
  },
  // Live log tail for the Diagnostics panel. start → init snapshot + appended
  // chunks stream over app:logData; stop ends the watch. onLogData returns an
  // unsubscribe, like onUpdateEvent.
  startLogTail: (): Promise<void> => ipcRenderer.invoke('app:tailLogs:start'),
  stopLogTail: (): Promise<void> => ipcRenderer.invoke('app:tailLogs:stop'),
  onLogData(handler: (event: LogTailEvent) => void): () => void {
    const listener = (_e: unknown, event: LogTailEvent): void => handler(event)
    ipcRenderer.on('app:logData', listener)
    return () => ipcRenderer.removeListener('app:logData', listener)
  },

  // Tray indicator: push the running-count + tooltip to main (fire-and-forget).
  sendTrayUpdate: (model: TrayModel): void => {
    ipcRenderer.send('tray:update', model)
  },
  // Main window subscribes to tray/popover navigation; returns an unsubscribe.
  onTrayCommand(handler: (cmd: TrayCommand) => void): () => void {
    const listener = (_e: unknown, cmd: TrayCommand): void => handler(cmd)
    ipcRenderer.on('tray:command', listener)
    return () => ipcRenderer.removeListener('tray:command', listener)
  },
  // Popover window forwards a clicked item; main relays it to the main window.
  sendTrayCommand: (cmd: TrayCommand): void => {
    ipcRenderer.send('tray:navigate', cmd)
  },
}

contextBridge.exposeInMainWorld('awog', awog)
