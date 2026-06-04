import { realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import { ipcMain, shell, dialog, type BrowserWindow } from 'electron'
import { engine, type RpcErrorShape } from './engine'

// IPC router — the Electron counterpart of the old Rust `commands.rs`.
// Renderer reaches these only through the `window.awog` contextBridge (preload).
// One auditable boundary for engine calls + a narrow set of shell/dialog ops
// (security invariant #4).

// OAuth authorize is the one URL the renderer may open externally today.
const OPEN_EXTERNAL_ALLOWLIST = /^https:\/\/claude\.ai\/oauth\/authorize\?/

type RequestPayload = { method: string; params?: unknown }
type PathPayload = { root: string; path: string }
type PickFolderOpts = { title?: string; defaultPath?: string }
type FileFilter = { name: string; extensions: string[] }
type SavePathOpts = { title?: string; defaultPath?: string; filters?: FileFilter[] }

// Renderer-facing envelope: errors are returned as data (never thrown across
// IPC) so JSON-RPC `code`/`message`/`data` survive Electron's error mangling.
type RequestResult =
  | { ok: true; value: unknown }
  | { ok: false; error: RpcErrorShape }

function normalizeError(err: unknown): RpcErrorShape {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    return err as RpcErrorShape
  }
  return { code: -32603, message: err instanceof Error ? err.message : String(err) }
}

// Validate that `relPath` resolves to a real path inside `root`. Canonicalize
// both sides (realpath resolves `..` + symlinks) and require descendant-ship —
// mirrors the sidecar's assertInsideWorkspace + the old Rust
// resolve_inside_workspace (security invariant #2).
function resolveInsideWorkspace(root: string, relPath: string): string {
  if (!root) throw new Error('workspace root is empty')
  if (!relPath) throw new Error('path is empty')
  const rootCanon = realpathSync(root)
  const targetCanon = realpathSync(join(rootCanon, relPath))
  if (targetCanon !== rootCanon && !targetCanon.startsWith(rootCanon + sep)) {
    throw new Error(`path escapes workspace: ${targetCanon}`)
  }
  return targetCanon
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  // Forward engine events to the renderer verbatim ({ type, payload }).
  engine.onEvent((event) => {
    getWindow()?.webContents.send('engine:event', event)
  })

  ipcMain.handle('engine:request', async (_e, payload: RequestPayload): Promise<RequestResult> => {
    try {
      const value = await engine.request(payload.method, payload.params ?? null)
      return { ok: true, value }
    } catch (err) {
      return { ok: false, error: normalizeError(err) }
    }
  })

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (typeof url !== 'string' || !OPEN_EXTERNAL_ALLOWLIST.test(url)) {
      throw new Error(`URL not allowlisted: ${url}`)
    }
    await shell.openExternal(url)
  })

  ipcMain.handle('shell:revealPath', async (_e, { root, path }: PathPayload) => {
    shell.showItemInFolder(resolveInsideWorkspace(root, path))
  })

  ipcMain.handle('shell:openPath', async (_e, { root, path }: PathPayload) => {
    const target = resolveInsideWorkspace(root, path)
    const err = await shell.openPath(target)
    if (err) throw new Error(err)
  })

  ipcMain.handle('dialog:pickFolder', async (_e, opts: PickFolderOpts = {}): Promise<string | null> => {
    const win = getWindow()
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.defaultPath ? { defaultPath: opts.defaultPath } : {}),
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Pick a save location only — the engine writes the file (e.g. git format-patch
  // stays inside the workspace, invariant #3). Mirrors Tauri's plugin-dialog save.
  ipcMain.handle('dialog:savePath', async (_e, opts: SavePathOpts = {}): Promise<string | null> => {
    const win = getWindow()
    const options: Electron.SaveDialogOptions = {
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.defaultPath ? { defaultPath: opts.defaultPath } : {}),
      ...(opts.filters ? { filters: opts.filters } : {}),
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })
}
