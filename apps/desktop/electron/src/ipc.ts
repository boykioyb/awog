import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ipcMain, shell, dialog, type BrowserWindow } from 'electron'
import { engine, type RpcErrorShape } from './engine'
import { isVscodeAvailable, openInVscode } from './vscode'

// IPC router — the Electron counterpart of the old Rust `commands.rs`.
// Renderer reaches these only through the `window.awog` contextBridge (preload).
// One auditable boundary for engine calls + a narrow set of shell/dialog ops
// (security invariant #4).

// shell.openExternal hands a URL to the OS default handler. The renderer opens
// several kinds of URL: OAuth flows (Claude authorize, OpenAI Codex device
// verification), hard-coded help links (git download), and links embedded in
// chat/markdown content or issue/PR badges (L1 — model output or pasted text,
// arbitrary hosts). A per-host allowlist can't cover the L1 case, so we gate on
// scheme instead: only web + mail links are handed off. This rejects schemes
// that could launch local files or other apps from untrusted content —
// file:, javascript:, data:, and custom protocol handlers (security invariant #7).
const OPEN_EXTERNAL_SAFE_SCHEME = /^(?:https?|mailto):/i

// A source's on-disk folder is ~/.awog/sources/<slug>. The renderer only ever
// knows the slug, so "reveal in folder" passes a slug (never a path): main
// derives the absolute path itself so untrusted renderer input can't aim the
// reveal at an arbitrary location (security invariant #2). This charset mirrors
// the sidecar's SOURCE_SLUG_RE and, by forbidding separators + dots, makes path
// traversal impossible; the startsWith check below is defence in depth.
const SOURCE_SLUG_RE = /^[a-z0-9-]+$/

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
    if (typeof url !== 'string' || !OPEN_EXTERNAL_SAFE_SCHEME.test(url)) {
      throw new Error(`URL not allowlisted: ${url}`)
    }
    await shell.openExternal(url)
  })

  ipcMain.handle('shell:revealPath', async (_e, { root, path }: PathPayload) => {
    shell.showItemInFolder(resolveInsideWorkspace(root, path))
  })

  // Reveal a source's folder (~/.awog/sources/<slug>) in the OS file manager.
  // Takes a SLUG ONLY — the path is derived + validated here, never trusted from
  // the renderer. Mirrors the sidecar's awogHome() = resolve(homedir(), '.awog').
  ipcMain.handle('shell:revealSourceFolder', async (_e, slug: string) => {
    if (typeof slug !== 'string' || !SOURCE_SLUG_RE.test(slug)) {
      throw new Error(`invalid source slug: ${String(slug)}`)
    }
    const sourcesDir = join(homedir(), '.awog', 'sources')
    const target = join(sourcesDir, slug)
    if (!target.startsWith(sourcesDir + sep)) {
      throw new Error(`source path escapes sources dir: ${target}`)
    }
    shell.showItemInFolder(target)
  })

  ipcMain.handle('shell:openPath', async (_e, { root, path }: PathPayload) => {
    const target = resolveInsideWorkspace(root, path)
    const err = await shell.openPath(target)
    if (err) throw new Error(err)
  })

  // Open a workspace file in the default browser via a file:// URL. Unlike the
  // generic shell:openExternal (scheme-gated to http/mailto for untrusted L1
  // URLs), this is a user-initiated action on a path we validate inside the
  // workspace first — so building the file:// URL ourselves is safe (invariant
  // #2). pathToFileURL handles encoding (spaces, unicode). Used for HTML/PDF
  // "Show in browser"; for HTML the default handler is the browser, for PDF it's
  // the OS default (best effort — the in-app preview covers in-browser rendering).
  ipcMain.handle('shell:openFileExternal', async (_e, { root, path }: PathPayload) => {
    const target = resolveInsideWorkspace(root, path)
    await shell.openExternal(pathToFileURL(target).href)
  })

  // Whether the VS Code CLI can be located on this machine. Drives whether the
  // file context menu shows "Open in VS Code".
  ipcMain.handle('shell:vscodeAvailable', async (): Promise<boolean> => isVscodeAvailable())

  ipcMain.handle('shell:openInVscode', async (_e, { root, path }: PathPayload) => {
    await openInVscode(resolveInsideWorkspace(root, path))
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

  // Pick one OR MORE folders (multi-select) — used to attach folders as read-only
  // session context. Returns [] on cancel. Separate from pickFolder so the existing
  // single-folder callers keep their `string | null` contract.
  ipcMain.handle('dialog:pickFolders', async (_e, opts: PickFolderOpts = {}): Promise<string[]> => {
    const win = getWindow()
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'multiSelections'],
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.defaultPath ? { defaultPath: opts.defaultPath } : {}),
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })

  // Pick a single existing FILE (e.g. an SSH private key). Returns its absolute
  // path or null on cancel. Optional filters narrow the picker (ADR 0063).
  ipcMain.handle('dialog:pickFile', async (_e, opts: SavePathOpts = {}): Promise<string | null> => {
    const win = getWindow()
    // Expand a leading ~ so callers can point at hidden dirs (e.g. ~/.ssh, where
    // private keys live) and the dialog opens right there rather than treating ~
    // literally. showHiddenFiles surfaces dotfiles inside that dir.
    const defaultPath = opts.defaultPath
      ? opts.defaultPath === '~'
        ? homedir()
        : opts.defaultPath.startsWith('~/')
          ? join(homedir(), opts.defaultPath.slice(2))
          : opts.defaultPath
      : undefined
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'showHiddenFiles'],
      ...(opts.title ? { title: opts.title } : {}),
      ...(defaultPath ? { defaultPath } : {}),
      ...(opts.filters ? { filters: opts.filters } : {}),
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
