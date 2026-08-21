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
type AppInfo = {
  version: string
  isPackaged: boolean
  canAutoInstall: boolean
  // Absolute path of the sidecar's config root (os.homedir()/.awog).
  awogHome: string
}
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
type TrayModel = { macTitle: string; tooltip: string; unreadCount: number }
// Desktop pet (docs/features/desktop-pet.md). Same shape as pet-window.ts — this
// preload is sandboxed and cannot import main-process modules, so the types are
// mirrored here (as the tray ones are).
type PetState = 'idle' | 'working' | 'awaiting' | 'done' | 'offline'
type PetSprite = 'girl' | 'shiba' | 'dino' | 'chicken' | 'miku'
type PetItem = {
  kind: 'session' | 'task'
  id: string
  title: string
  hint: 'awaiting' | 'running' | 'unread'
  percent?: number
  preview?: string
}
type PetPermission = { requestId: string; toolName: string; target: string }
type PetModel = {
  state: PetState
  counts: { running: number; attention: number; unread: number }
  items: PetItem[]
  permission: PetPermission | null
  autoPeek: boolean
  sprite: PetSprite
  scale: number
  quips: boolean
  tricks: boolean
  quipLines: string[]
  reminders: string[]
  reminderMs: number
  facing: 'left' | 'right'
}
// The main window pushes everything EXCEPT facing — only main knows where the
// window sits (see pet-window.ts).
type PetStatus = Omit<PetModel, 'facing'>
type PetCommand =
  | { kind: 'open'; target: TrayCommand }
  | { kind: 'permission'; requestId: string; decision: 'allow' | 'deny' }
  | { kind: 'toggle' }
type PetPrefs = { enabled: boolean; scale: number; pos: { x: number; y: number } | null }
// Mobile Remote Control (ADR 0067). Public device metadata only — no tokenHash.
type RemoteDevice = {
  id: string
  label: string
  platform: string
  pairedAt: string
  lastSeenAt?: string
}
type GatewayStatus = {
  enabled: boolean
  tailnet: 'connected' | 'disconnected'
  host: string | null
  port: number
  bound: boolean
}
type PairingInfo = { code: string; expiresAt: number; host: string; port: number }

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
  // Reveal a source's folder (~/.awog/sources/<slug>) — main derives + validates
  // the path from the slug (the renderer never passes a path).
  revealSourceFolder: (slug: string): Promise<void> =>
    ipcRenderer.invoke('shell:revealSourceFolder', slug),
  // Reveal a session's folder (~/.awog/sessions/<engineId>) — main derives +
  // validates the path from the engineId (the renderer never passes a path).
  revealSessionFolder: (engineId: string): Promise<void> =>
    ipcRenderer.invoke('shell:revealSessionFolder', engineId),
  // Absolute path of a session's folder (for "Copy path") — same derive + validate.
  sessionFolderPath: (engineId: string): Promise<string> =>
    ipcRenderer.invoke('shell:sessionFolderPath', engineId),
  openPath: (root: string, path: string): Promise<void> =>
    ipcRenderer.invoke('shell:openPath', { root, path }),
  openFileExternal: (root: string, path: string): Promise<void> =>
    ipcRenderer.invoke('shell:openFileExternal', { root, path }),
  // Open a workspace file in its own OS window (preview popout). Main validates the
  // root/path pair against the workspace before creating the window.
  openPreviewWindow: (root: string, path: string, name: string): Promise<void> =>
    ipcRenderer.invoke('preview:openWindow', { root, path, name }),
  // Open a session in its own OS window (session popout). Main validates the engineId
  // and focuses the window a session already has instead of stacking a duplicate.
  openSessionWindow: (engineId: string, title: string): Promise<void> =>
    ipcRenderer.invoke('session:openWindow', { engineId, title }),
  // Close a session's popout ("bring it back here"). Addresses the window by SESSION
  // id, so a renderer can only close a session popout — never an arbitrary window.
  closeSessionWindow: (engineId: string): Promise<boolean> =>
    ipcRenderer.invoke('session:closeWindow', engineId),
  // Sessions currently owned by a popout window (read once on mount).
  listSessionWindows: (): Promise<string[]> => ipcRenderer.invoke('session:listWindows'),
  // Live changes to that set; returns an unsubscribe function.
  onSessionWindowsChanged(handler: (engineIds: string[]) => void): () => void {
    const listener = (_e: unknown, ids: string[]): void => handler(ids)
    // Channel literal mirrors SESSION_WINDOWS_CHANGED in main's session-window.ts —
    // this preload is sandboxed, so it can't import main-process modules.
    ipcRenderer.on('session:windowsChanged', listener)
    return () => ipcRenderer.removeListener('session:windowsChanged', listener)
  },
  // Close the calling window — used by a preview popout's own ✕ / Esc. Main resolves
  // the target from the sender, so this can never close another window.
  closeSelf: (): Promise<void> => ipcRenderer.invoke('window:closeSelf'),
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
  pickFile: (opts?: SavePathOpts): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickFile', opts ?? {}),
  pickFiles: (opts?: SavePathOpts): Promise<string[]> =>
    ipcRenderer.invoke('dialog:pickFiles', opts ?? {}),
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

  // Desktop pet (desktop-pet). MAIN WINDOW side: push the prefs main acts on
  // (create/resize/move) + the status model, take back the pet's clicks and the
  // resting position after a drag. PET side: receive the model, send commands,
  // report the hit-test + drag phases.
  sendPetPrefs: (prefs: PetPrefs): void => {
    ipcRenderer.send('pet:enabled', prefs)
  },
  sendPetUpdate: (status: PetStatus): void => {
    ipcRenderer.send('pet:update', status)
  },
  onPetModel(handler: (model: PetModel) => void): () => void {
    const listener = (_e: unknown, model: PetModel): void => handler(model)
    ipcRenderer.on('pet:model', listener)
    return () => ipcRenderer.removeListener('pet:model', listener)
  },
  sendPetCommand: (cmd: PetCommand): void => {
    ipcRenderer.send('pet:navigate', cmd)
  },
  onPetCommand(handler: (cmd: PetCommand) => void): () => void {
    const listener = (_e: unknown, cmd: PetCommand): void => handler(cmd)
    ipcRenderer.on('pet:command', listener)
    return () => ipcRenderer.removeListener('pet:command', listener)
  },
  onPetMoved(handler: (pos: { x: number; y: number }) => void): () => void {
    const listener = (_e: unknown, pos: { x: number; y: number }): void => handler(pos)
    ipcRenderer.on('pet:moved', listener)
    return () => ipcRenderer.removeListener('pet:moved', listener)
  },
  setPetInteractive: (on: boolean): void => {
    ipcRenderer.send('pet:interactive', on)
  },
  sendPetDrag: (phase: 'start' | 'end'): void => {
    ipcRenderer.send('pet:drag', phase)
  },

  // Mobile Remote Control (ADR 0067) — Settings → Devices talks to the WS gateway
  // in main. Device tokens never cross this bridge (only public metadata).
  gateway: {
    status: (): Promise<GatewayStatus> => ipcRenderer.invoke('gateway:status'),
    setEnabled: (on: boolean): Promise<GatewayStatus> =>
      ipcRenderer.invoke('gateway:setEnabled', on),
    listDevices: (): Promise<RemoteDevice[]> => ipcRenderer.invoke('gateway:listDevices'),
    createPairing: (): Promise<PairingInfo> => ipcRenderer.invoke('gateway:createPairing'),
    revokeDevice: (id: string): Promise<boolean> => ipcRenderer.invoke('gateway:revokeDevice', id),
    onDevicesChanged(handler: (devices: RemoteDevice[]) => void): () => void {
      const listener = (_e: unknown, devices: RemoteDevice[]): void => handler(devices)
      ipcRenderer.on('gateway:devices-changed', listener)
      return () => ipcRenderer.removeListener('gateway:devices-changed', listener)
    },
    onStatusChanged(handler: (status: GatewayStatus) => void): () => void {
      const listener = (_e: unknown, status: GatewayStatus): void => handler(status)
      ipcRenderer.on('gateway:status-changed', listener)
      return () => ipcRenderer.removeListener('gateway:status-changed', listener)
    },
  },
}

contextBridge.exposeInMainWorld('awog', awog)
