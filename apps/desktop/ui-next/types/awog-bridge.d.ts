// Ambient type for the Electron preload bridge exposed as `window.awog`
// (apps/desktop/electron/src/preload.ts). The renderer talks to the engine + a
// narrow set of shell/dialog ops ONLY through this object — never Node directly.

export type AwogEngineEvent = { type: string; payload: unknown }
export type AwogFileFilter = { name: string; extensions: string[] }
export type AwogDialogOpts = { title?: string; defaultPath?: string }
export type AwogSavePathOpts = AwogDialogOpts & { filters?: AwogFileFilter[] }

// Auto-update (ADR 0028).
export type AwogAppInfo = { version: string; isPackaged: boolean; canAutoInstall: boolean }
export type AwogUpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

// Live log tail (Diagnostics panel).
export type AwogLogTailEvent =
  | { type: 'init'; content: string; path: string }
  | { type: 'data'; chunk: string }
  | { type: 'error'; message: string }

// Live tray status (system-tray-status). The main window pushes a lightweight
// indicator; the styled popover window forwards clicked items as commands.
export type AwogTrayCommand =
  | { kind: 'activity' }
  // Stable sidecar engine id ("ses-…"), NOT the per-window numeric client id: the
  // popover renderer has its own Pinia store + id counter, so a numeric id would
  // resolve to the wrong session (or none) in the main window.
  | { kind: 'session'; engineId: string }
  | { kind: 'task'; id: string }
export type AwogTrayModel = { macTitle: string; tooltip: string }

export interface AwogBridge {
  // Resolves with the JSON-RPC result, or rejects with { code, message, data }.
  request(method: string, params?: unknown): Promise<unknown>
  // Subscribe to engine events; returns an unsubscribe function.
  onEvent(handler: (event: AwogEngineEvent) => void): () => void
  openExternal(url: string): Promise<void>
  revealPath(root: string, path: string): Promise<void>
  // Reveal a source's folder (~/.awog/sources/<slug>) in the OS file manager.
  // Takes a SLUG only — main derives + validates the path (never renderer input).
  revealSourceFolder(slug: string): Promise<void>
  openPath(root: string, path: string): Promise<void>
  // Open a workspace file in the default browser (file:// URL, path validated).
  openFileExternal(root: string, path: string): Promise<void>
  // Whether VS Code's `code` CLI is available on this machine.
  vscodeAvailable(): Promise<boolean>
  openInVscode(root: string, path: string): Promise<void>
  pickFolder(opts?: AwogDialogOpts): Promise<string | null>
  // Pick one or more folders (multi-select) → their absolute paths ([] on cancel).
  pickFolders(opts?: AwogDialogOpts): Promise<string[]>
  // Absolute on-disk path of a dropped File/folder (Electron webUtils). '' when
  // the File has no real filesystem origin (e.g. synthetic/clipboard blob).
  getPathForFile(file: File): string
  savePath(opts?: AwogSavePathOpts): Promise<string | null>
  // Auto-update (ADR 0028).
  getAppInfo(): Promise<AwogAppInfo>
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  openReleasesPage(): Promise<void>
  onUpdateEvent(handler: (event: AwogUpdateEvent) => void): () => void
  openLogs(): Promise<void>
  // Live log tail for the Diagnostics panel (streams over app:logData).
  startLogTail(): Promise<void>
  stopLogTail(): Promise<void>
  onLogData(handler: (event: AwogLogTailEvent) => void): () => void
  // Live tray status (system-tray-status).
  sendTrayUpdate(model: AwogTrayModel): void
  onTrayCommand(handler: (cmd: AwogTrayCommand) => void): () => void
  sendTrayCommand(cmd: AwogTrayCommand): void
}

declare global {
  interface Window {
    awog?: AwogBridge
  }
}
