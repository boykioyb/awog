// Engine client — thin wrapper over the Electron preload bridge (`window.awog`).
// Keeps the same public surface the rest of the UI already imports
// (available/request/onEvent/openExternal/revealPath/openPath) so the migration
// from the Tauri shell stays contained to this file. See
// docs/features/electron-migration.md §3-4.

export class SidecarError extends Error {
  code: number

  data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'SidecarError'
    this.code = code
    this.data = data
  }
}

export class SidecarUnavailableError extends Error {
  constructor() {
    super('Engine unavailable: app is not running inside the Electron shell')
    this.name = 'SidecarUnavailableError'
  }
}

export type SidecarEvent = { type: string; payload: unknown }
export type SidecarEventHandler = (event: SidecarEvent) => void
export type UnlistenFn = () => void

// Auto-update (ADR 0028).
export type AppInfo = { version: string; isPackaged: boolean; canAutoInstall: boolean }
export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }
export type UpdateEventHandler = (event: UpdateEvent) => void

const bridge = () => (typeof window !== 'undefined' ? window.awog : undefined)

const toSidecarError = (raw: unknown): SidecarError => {
  if (raw && typeof raw === 'object' && 'code' in raw && 'message' in raw) {
    const e = raw as { code: number; message: string; data?: unknown }
    return new SidecarError(e.code, e.message, e.data)
  }
  if (raw instanceof Error) return new SidecarError(-32603, raw.message)
  return new SidecarError(-32603, 'Unknown engine error', raw)
}

export function useSidecar() {
  const api = bridge()

  const request = async <T = unknown>(method: string, params?: unknown): Promise<T> => {
    if (!api) throw new SidecarUnavailableError()
    // Electron's contextBridge/IPC uses structured clone, which cannot clone Vue
    // reactive proxies, refs, functions or class instances ("An object could not
    // be cloned"). RPC params are always JSON-bound (they reach the engine as
    // JSON anyway), so normalize to a plain JSON value here — this mirrors what
    // the old Tauri `invoke` JSON channel did implicitly.
    const plain = params == null ? null : JSON.parse(JSON.stringify(params))
    try {
      return (await api.request(method, plain)) as T
    } catch (err) {
      throw toSidecarError(err)
    }
  }

  // onEvent stays async (call sites `await` it) even though the bridge resolves
  // the unsubscribe synchronously.
  const onEvent = async (handler: SidecarEventHandler): Promise<UnlistenFn> => {
    if (!api) throw new SidecarUnavailableError()
    return api.onEvent((e) => handler(e))
  }

  const openExternal = async (url: string): Promise<void> => {
    if (!api) throw new SidecarUnavailableError()
    await api.openExternal(url)
  }

  // Reveal a workspace-relative file/dir in the OS file manager. Validated in
  // the main process against `workspaceRoot` (path outside → rejects).
  const revealPath = async (workspaceRoot: string, path: string): Promise<void> => {
    if (!api) throw new SidecarUnavailableError()
    await api.revealPath(workspaceRoot, path)
  }

  // Open a workspace-relative file with the OS default handler (dir → file
  // manager). Same workspace validation as revealPath.
  const openPath = async (workspaceRoot: string, path: string): Promise<void> => {
    if (!api) throw new SidecarUnavailableError()
    await api.openPath(workspaceRoot, path)
  }

  // Whether VS Code's `code` CLI is available — gates the "Open in VS Code"
  // file action. Returns false when running outside the Electron shell.
  const isVscodeAvailable = async (): Promise<boolean> => {
    if (!api) return false
    return api.vscodeAvailable()
  }

  // Open a workspace-relative file/dir in VS Code. Same workspace validation as
  // revealPath (path outside → rejects in the main process).
  const openInVscode = async (workspaceRoot: string, path: string): Promise<void> => {
    if (!api) throw new SidecarUnavailableError()
    await api.openInVscode(workspaceRoot, path)
  }

  // Auto-update bridge (ADR 0028). The renderer talks to the main-process updater
  // only through here, on a channel separate from engine events.
  const getAppInfo = async (): Promise<AppInfo> => {
    if (!api) throw new SidecarUnavailableError()
    return api.getAppInfo()
  }
  const checkForUpdates = async (): Promise<void> => {
    if (!api) throw new SidecarUnavailableError()
    await api.checkForUpdates()
  }
  const downloadUpdate = async (): Promise<void> => {
    if (!api) throw new SidecarUnavailableError()
    await api.downloadUpdate()
  }
  const installUpdate = async (): Promise<void> => {
    if (!api) throw new SidecarUnavailableError()
    await api.installUpdate()
  }
  const openReleasesPage = async (): Promise<void> => {
    if (!api) throw new SidecarUnavailableError()
    await api.openReleasesPage()
  }
  const onUpdateEvent = async (handler: UpdateEventHandler): Promise<UnlistenFn> => {
    if (!api) throw new SidecarUnavailableError()
    return api.onUpdateEvent((e) => handler(e))
  }
  const openLogs = async (): Promise<void> => {
    if (!api) throw new SidecarUnavailableError()
    await api.openLogs()
  }

  return {
    available: !!api,
    request,
    onEvent,
    openExternal,
    revealPath,
    openPath,
    isVscodeAvailable,
    openInVscode,
    getAppInfo,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    openReleasesPage,
    onUpdateEvent,
    openLogs,
  }
}
