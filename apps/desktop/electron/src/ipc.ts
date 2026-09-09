import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, ipcMain, shell, dialog, BrowserWindow } from 'electron'
import { browser, type Rect, type TabInfo } from './browser'
import {
  clearImportedData,
  importProfile,
  listBrowsers,
  type BrowserEntry,
  type ImportReport,
} from './browser-import'
import { engine, type RpcErrorShape } from './engine'
import { openPreviewWindow } from './preview-window'
import {
  closeSessionWindow,
  openSessionIds,
  openSessionWindow,
  sessionWindowList,
} from './session-window'
import { isVscodeAvailable, openInVscode } from './vscode'
import { resolveInsideWorkspace } from './workspace-scope'

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

// A session's on-disk folder is ~/.awog/sessions/<engineId> (mirror the sidecar's
// sessionDir(id) in sessions/jsonl.ts — keep both in sync if the layout changes).
// engineId is a slug ("ses-…", charset [a-z0-9-] from utils/session-slug.ts), so we
// reuse SOURCE_SLUG_RE: forbidding separators + dots makes traversal impossible, and
// the startsWith check is defence in depth. The renderer only ever passes the
// engineId — main derives the absolute path so untrusted input can't aim it
// elsewhere (security invariants #2 + #4).
function sessionDirFromId(engineId: string): string {
  if (typeof engineId !== 'string' || !SOURCE_SLUG_RE.test(engineId)) {
    throw new Error(`invalid session id: ${String(engineId)}`)
  }
  const sessionsDir = join(homedir(), '.awog', 'sessions')
  const target = join(sessionsDir, engineId)
  if (!target.startsWith(sessionsDir + sep)) {
    throw new Error(`session path escapes sessions dir: ${target}`)
  }
  return target
}

type RequestPayload = { method: string; params?: unknown }
type PathPayload = { root: string; path: string }
type PreviewWindowPayload = { root: string; path: string; name: string }
type BrowserViewPayload = { tabId?: string; rect: Rect }
type ImportPayload = {
  browserId?: string
  profileDir?: string
  parts?: { cookies?: boolean; localStorage?: boolean; indexedDb?: boolean }
}
type BrowserOpenPayload = { url: string; tabId?: string }
type SessionWindowPayload = { engineId: string; title?: string }
type PickFolderOpts = { title?: string; defaultPath?: string }
type FileFilter = { name: string; extensions: string[] }
type SavePathOpts = {
  title?: string
  defaultPath?: string
  filters?: FileFilter[]
}

// Renderer-facing envelope: errors are returned as data (never thrown across
// IPC) so JSON-RPC `code`/`message`/`data` survive Electron's error mangling.
type RequestResult = { ok: true; value: unknown } | { ok: false; error: RpcErrorShape }

function normalizeError(err: unknown): RpcErrorShape {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    return err as RpcErrorShape
  }
  return {
    code: -32603,
    message: err instanceof Error ? err.message : String(err),
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  // Forward engine events verbatim ({ type, payload }) to the main window AND every
  // session popout (session-window.ts): a popout is its own renderer driving a real
  // session, so without the stream its transcript would freeze mid-turn. Each renderer
  // applies only the sessions it owns (store `ownsSession`), so exactly one acts.
  //
  // Deliberately NOT every window: the tray popover is a passive snapshot renderer, and
  // acting on this stream would make it a second driver (e.g. auto-continuing a
  // background wake that the main window is already continuing).
  engine.onEvent((event) => {
    for (const win of [getWindow(), ...sessionWindowList()]) {
      if (win && !win.isDestroyed()) win.webContents.send('engine:event', event)
    }
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

  // Reveal a session's folder (~/.awog/sessions/<engineId>) in the OS file manager.
  // Like revealSourceFolder, takes an ID (slug) ONLY — main derives + validates the
  // path via sessionDirFromId (never trusts a path from the renderer). We do NOT stat
  // the dir here (extra I/O + race); the renderer gates on engineId != null (spec AC5).
  ipcMain.handle('shell:revealSessionFolder', async (_e, engineId: string) => {
    shell.showItemInFolder(sessionDirFromId(engineId))
  })

  // Absolute on-disk path of a session's folder, for the renderer to copy to the
  // clipboard. Same derive + validate as revealSessionFolder — the renderer never
  // builds the path itself (invariant #4); it must be absolute (~ doesn't expand in
  // terminals/file managers), which is the whole point of "Copy path".
  ipcMain.handle(
    'shell:sessionFolderPath',
    async (_e, engineId: string): Promise<string> => sessionDirFromId(engineId),
  )

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

  // Pop a workspace file out of the shared PreviewModal into its own OS window
  // (docs/features/preview-popout-window.md). openPreviewWindow validates the
  // root/path pair against the workspace before creating anything, so an escaping
  // path rejects here instead of opening a window.
  ipcMain.handle('preview:openWindow', async (_e, payload: PreviewWindowPayload) => {
    const { root, path, name } = payload ?? {}
    if (typeof root !== 'string' || typeof path !== 'string' || typeof name !== 'string') {
      throw new Error('preview window needs { root, path, name }')
    }
    openPreviewWindow({ workspaceRoot: root, path, name })
  })

  // Pop a session out of the main window into its own OS window
  // (docs/features/session-popout-window.md). The engineId is charset-validated in
  // openSessionWindow before anything is created; re-opening the same session focuses
  // the window it already has.
  ipcMain.handle('session:openWindow', async (_e, payload: SessionWindowPayload) => {
    const { engineId, title } = payload ?? {}
    if (typeof engineId !== 'string') throw new Error('session window needs { engineId }')
    openSessionWindow({
      engineId,
      title: typeof title === 'string' ? title : '',
    })
  })

  // "Bring it back here" — close a session's popout from the main window. Addresses a
  // window this app opened BY SESSION ID (never a window handle), so a renderer can
  // only ever close a session popout, not an arbitrary window.
  ipcMain.handle(
    'session:closeWindow',
    async (_e, engineId: string): Promise<boolean> => closeSessionWindow(engineId),
  )

  // Sessions currently owned by a popout window. Polled once per renderer on mount
  // (a window that opens later still learns the current set); live changes ride the
  // SESSION_WINDOWS_CHANGED broadcast.
  ipcMain.handle('session:listWindows', async (): Promise<string[]> => openSessionIds())

  // Close the window that made the call (a preview popout closing itself from its
  // in-page ✕ / Esc). Derived from the sender — the renderer can't name a window,
  // so it can never close another one.
  ipcMain.handle('window:closeSelf', async (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })

  // Whether the VS Code CLI can be located on this machine. Drives whether the
  // file context menu shows "Open in VS Code".
  ipcMain.handle('shell:vscodeAvailable', async (): Promise<boolean> => isVscodeAvailable())

  ipcMain.handle('shell:openInVscode', async (_e, { root, path }: PathPayload) => {
    await openInVscode(resolveInsideWorkspace(root, path))
  })

  ipcMain.handle(
    'dialog:pickFolder',
    async (_e, opts: PickFolderOpts = {}): Promise<string | null> => {
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
    },
  )

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

  // Pick one OR MORE existing files (multi-select) — used to import Markdown into
  // the wiki (ADR 0073). Returns [] on cancel. Separate from pickFile so the
  // existing single-file callers keep their `string | null` contract.
  ipcMain.handle('dialog:pickFiles', async (_e, opts: SavePathOpts = {}): Promise<string[]> => {
    const win = getWindow()
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections', 'showHiddenFiles'],
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.defaultPath ? { defaultPath: opts.defaultPath } : {}),
      ...(opts.filters ? { filters: opts.filters } : {}),
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
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

  registerBrowserViewIpc()
}

// ─── Embedded browser (ADR 0086) ─────────────────────────────────────────────
//
// The agent's browser tabs are `WebContentsView`s owned by main (browser.ts). This
// is how a renderer borrows the ACTIVE one into a rectangle of its own window —
// the "Browser" view of the session workspace panel.
//
// Two rules make this narrow. The host window is resolved from `event.sender`, so
// a renderer can only ever fill its own window and can never address another
// (invariant #4) — no window id crosses IPC. And the rect is clamped in browser.ts
// before it reaches the native layer.
//
// What does NOT live here: every page-reading action (snapshot/extract/console/
// network/screenshot) stays on the sidecar's host-request channel, where the nonce
// fence and the redactor are. The renderer gets navigation and geometry only, so
// page content still has exactly one door into the app.
function registerBrowserViewIpc(): void {
  const senderWindow = (e: Electron.IpcMainInvokeEvent): BrowserWindow => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('browser view: no window for sender')
    return win
  }

  // Tab list + per-tab url/title/loading/nav state, pushed on every change the
  // AGENT makes too — that stream is what makes the panel a live view of what the
  // agent is doing rather than a thing the user has to refresh.
  browser.setChangeListener(() => {
    // Per-recipient: `shown` has to mean "in YOUR window", so each window gets its
    // own view of the same tab list.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('browser:changed', browser.listTabs(win))
    }
  })

  ipcMain.handle(
    'browser:attach',
    async (e, payload: BrowserViewPayload): Promise<TabInfo> =>
      browser.attachTo(senderWindow(e), payload?.tabId, payload?.rect),
  )
  ipcMain.handle('browser:bounds', async (e, payload: BrowserViewPayload): Promise<void> => {
    browser.setViewBounds(senderWindow(e), payload?.tabId, payload?.rect)
  })
  ipcMain.handle('browser:detach', async (e): Promise<void> => {
    browser.detachFrom(senderWindow(e))
  })
  ipcMain.handle('browser:tabs', async (e) => browser.listTabs(senderWindow(e)))
  ipcMain.handle(
    'browser:open',
    async (_e, payload: BrowserOpenPayload): Promise<TabInfo> =>
      browser.openFromUser(String(payload?.url ?? ''), payload?.tabId),
  )
  // `wait: false` = mở tab rồi trả về ngay (đường người dùng bấm link); mặc định
  // vẫn chờ tải xong để đường của model không đổi hành vi.
  ipcMain.handle('browser:newTab', async (_e, payload: unknown) => {
    const url = typeof payload === 'string' ? payload : (asString(payload, 'url') ?? undefined)
    const wait =
      typeof payload === 'object' && payload !== null && 'wait' in payload
        ? (payload as { wait?: unknown }).wait !== false
        : true
    return browser.newTab(url, wait)
  })
  ipcMain.handle(
    'browser:selectTab',
    async (_e, tabId: string): Promise<TabInfo> => browser.selectTab(String(tabId)),
  )
  ipcMain.handle('browser:closeTab', async (_e, tabId: string) => browser.closeTab(String(tabId)))
  ipcMain.handle('browser:back', async (_e, tabId?: string) => {
    browser.goBack(typeof tabId === 'string' ? tabId : undefined)
  })
  ipcMain.handle('browser:forward', async (_e, tabId?: string) => {
    browser.goForward(typeof tabId === 'string' ? tabId : undefined)
  })
  ipcMain.handle('browser:reload', async (_e, tabId?: string) => {
    browser.reload(typeof tabId === 'string' ? tabId : undefined)
  })
  // "Open it in its own window" — the panel hands the tab to the popout, which is
  // the same window the tray item toggles.
  ipcMain.handle('browser:popout', async (): Promise<void> => {
    browser.show()
  })

  // ── Profile import (ADR 0086 phần B) ──────────────────────────────────────
  //
  // Reads the user's real browser profile, so every call is behind an explicit
  // click and the payload is an ID from the enumerated list — browser-import.ts
  // resolves it back to a path itself and never joins renderer input (invariant #2).
  ipcMain.handle('browser:listBrowsers', async (): Promise<BrowserEntry[]> => listBrowsers())
  ipcMain.handle(
    'browser:importProfile',
    async (_e, payload: ImportPayload): Promise<ImportReport> =>
      importProfile(String(payload?.browserId ?? ''), String(payload?.profileDir ?? ''), {
        cookies: payload?.parts?.cookies !== false,
        localStorage: payload?.parts?.localStorage !== false,
        indexedDb: payload?.parts?.indexedDb !== false,
      }),
  )
  // The undo for an import: wipe everything the agent's browser holds.
  ipcMain.handle('browser:clearData', async (): Promise<void> => {
    browser.close()
    await clearImportedData()
  })
  // Staged LevelDB stores only land at boot (see applyPendingImport), so the user
  // needs a restart to finish an import. The renderer confirms first — this kills
  // running turns.
  ipcMain.handle('browser:relaunch', async (): Promise<void> => {
    app.relaunch()
    app.exit(0)
  })

  // ── phần E: read + point ──────────────────────────────────────────────────
  //
  // These return PAGE CONTENT to the renderer, which the rest of this feature
  // deliberately does not: everything the MODEL reads goes through the sidecar's
  // browser_tool, where the nonce fence and the redactor are. The difference is
  // who asked — each of these fires from a click in the browser chrome, and the
  // text lands in the user's own UI (a translation popover, the composer), never
  // straight into a prompt. Anything that does reach a prompt gets there because
  // the user pressed send, which is the same trust path as typing it.
  const optTab = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
  const asString = (p: unknown, key: string): string | null => {
    const v = p && typeof p === 'object' ? (p as Record<string, unknown>)[key] : undefined
    return typeof v === 'string' && v ? v : null
  }

  ipcMain.handle('browser:selection', async (_e, tabId?: string) =>
    browser.readSelection(optTab(tabId)),
  )
  ipcMain.handle('browser:pickElement', async (_e, tabId?: string) =>
    browser.pickElement(optTab(tabId)),
  )
  ipcMain.handle('browser:cancelPick', async (_e, tabId?: string) => {
    browser.cancelPick(optTab(tabId))
  })
  ipcMain.handle('browser:pageContext', async (_e, tabId?: string) =>
    browser.pageContext(optTab(tabId)),
  )
  // The screenshot path is built from the renderer's workspace root, so it goes
  // through the same resolver every other write-into-workspace op uses.
  ipcMain.handle(
    'browser:saveScreenshot',
    async (_e, payload: { root?: string; tabId?: string }): Promise<{ path: string }> => {
      const root = String(payload?.root ?? '')
      if (!root) throw new Error('saveScreenshot needs a workspace root')
      return browser.saveScreenshot(root, optTab(payload?.tabId))
    },
  )
  ipcMain.handle('browser:sites', async () => browser.sites())
  ipcMain.handle('browser:setSites', async (_e, sites: unknown) => {
    browser.setSites(sites)
  })
}
