// Ambient type for the Electron preload bridge exposed as `window.awog`
// (apps/desktop/electron/src/preload.ts). The renderer talks to the engine + a
// narrow set of shell/dialog ops ONLY through this object — never Node directly.

export type AwogEngineEvent = { type: string; payload: unknown }
export type AwogFileFilter = { name: string; extensions: string[] }
export type AwogDialogOpts = { title?: string; defaultPath?: string }
export type AwogSavePathOpts = AwogDialogOpts & { filters?: AwogFileFilter[] }

// Auto-update (ADR 0028).
export type AwogAppInfo = {
  version: string
  isPackaged: boolean
  canAutoInstall: boolean
  // Absolute path of the sidecar's config root (os.homedir()/.awog).
  awogHome: string
}
export type AwogUpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

// Embedded browser (ADR 0086) — mirrors Rect / TabInfo in electron/src/browser.ts.
export type AwogBrowserRect = { x: number; y: number; width: number; height: number }
export type AwogBrowserTab = {
  tabId: string
  url: string
  title: string
  active: boolean
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  // On screen in THIS window's rect. One webContents cannot be in two rects, so a
  // panel that does not hold it renders a placeholder instead of fighting for it.
  shown: boolean
  // On screen somewhere else — the popout window, or another app window.
  shownElsewhere: boolean
}
export type AwogBrowserTabList = { tabs: AwogBrowserTab[]; activeTabId: string | null }

// ADR 0086 phần E — reading and pointing at the page the user is looking at.
// Everything here is USER-initiated (a click in the chrome), which is why it may
// return page text to the renderer at all: the model-facing path stays inside the
// sidecar's browser_tool, where the nonce fence and the redactor live.
export type AwogBrowserSelection = { text: string; url: string; title: string }
// One element the user picked with the element picker.
export type AwogBrowserPick = {
  // A CSS path good enough to hand back to the agent ("main > form > input:nth-of-type(2)").
  selector: string
  // Accessible-ish label + visible text, trimmed.
  text: string
  // outerHTML, capped by main.
  html: string
  url: string
  title: string
}
// The current page as chat context (`@page`).
export type AwogBrowserPageContext = { url: string; title: string; text: string }
// Host policy for the agent's browser. 'off' = only the built-in private/loopback
// guard applies; 'allowlist' = additionally, only these hosts may load.
export type AwogBrowserSites = { mode: 'off' | 'allowlist'; hosts: string[] }

// Profile import (ADR 0086 phần B) — mirrors browser-import.ts.
export type AwogBrowserProfile = {
  dir: string
  name: string
  email: string
  hasCookies: boolean
}
export type AwogBrowserImportSource = {
  id: string
  label: string
  profiles: AwogBrowserProfile[]
}
export type AwogBrowserImportParts = {
  cookies: boolean
  localStorage: boolean
  indexedDb: boolean
}
export type AwogBrowserImportReport = {
  browser: string
  profile: string
  // null when that part was not requested.
  cookies: {
    total: number
    imported: number
    // Written with app-bound encryption (Chrome 127+): undecryptable by design.
    appBound: number
    undecryptable: number
    rejected: number
    expired: number
    // The macOS keychain prompt was denied, or the item is missing.
    keyUnavailable: boolean
  } | null
  localStorage: { staged: boolean; bytes: number } | null
  indexedDb: { staged: boolean; bytes: number } | null
  // LevelDB stores only land at the next boot — see applyPendingImport.
  needsRestart: boolean
}

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
export type AwogTrayModel = { macTitle: string; tooltip: string; unreadCount: number }

// ── Desktop pet (docs/features/desktop-pet.md) ───────────────────────────────
// Ambient status sprite in its own transparent always-on-top window. The MAIN
// WINDOW computes the model (it owns the sessions/tasks stores) and pushes it; the
// pet renderer only draws and sends commands back — never a second driver of the
// engine event stream.
export type AwogPetState = 'idle' | 'working' | 'awaiting' | 'done' | 'offline'
// Which built-in spritesheet to draw (public/pet/<sprite>.png).
export type AwogPetSprite = 'girl' | 'shiba' | 'dino' | 'chicken' | 'miku'
export type AwogPetItem = {
  kind: 'session' | 'task'
  // session → stable engine id; task → task id.
  id: string
  title: string
  hint: 'awaiting' | 'running' | 'unread'
  percent?: number
  // One-line preview of what it is doing right now (last message / current step).
  preview?: string
}
// Summary only — the pet floats above every app, so no tool input, ever.
export type AwogPetPermission = { requestId: string; toolName: string; target: string }
export type AwogPetModel = {
  state: AwogPetState
  counts: { running: number; attention: number; unread: number }
  // At most 3, ordered attention → running → unread.
  items: AwogPetItem[]
  permission: AwogPetPermission | null
  // Prefs the PET renders with. They ride the model rather than a channel of their
  // own: the main window computes both from the same store, in the same tick.
  autoPeek: boolean
  sprite: AwogPetSprite
  // Cỡ SPRITE (text does not scale with it). CSS transform, NOT
  // webContents.setZoomFactor — Chromium zoom is per-ORIGIN, so that would scale every
  // window of the app, not just this one.
  scale: number
  // Let the pet say something now and then (Settings → Pet).
  quips: boolean
  // Let the pet perform its pack's own skill — the sheet's `special` row. Packs cut
  // before that row existed (girl, chicken) have nothing to play and stay still.
  tricks: boolean
  // Lines for the CURRENT state, already resolved by the main window (user edits ??
  // localised defaults). The pet only picks one at random.
  quipLines: string[]
  reminders: string[]
  // Milliseconds between periodic nudges; 0 = off.
  reminderMs: number
  // Temporary dismiss (Desktop pet). Main-driven like the rest of this group: the
  // pet hides its whole draw region while true, and a new prompt (any session) flips
  // it back. NOT `facing` — it is state the main window resolves, not window geometry.
  dismissed: boolean
  // Which way the pet looks. Set by MAIN (only it knows where the window sits): a pet
  // parked at the right edge faces INTO the screen.
  facing: 'left' | 'right'
}
// What the main window pushes — everything but `facing`.
export type AwogPetStatus = Omit<AwogPetModel, 'facing'>
export type AwogPetCommand =
  | { kind: 'open'; target: AwogTrayCommand }
  | { kind: 'permission'; requestId: string; decision: 'allow' | 'deny' }
  | { kind: 'toggle' }
  // Pet's X button — hide until the next reset trigger. Does NOT touch the enabled
  // pref, so main keeps the window alive and the model keeps flowing.
  | { kind: 'dismiss' }
export type AwogPetPrefs = {
  enabled: boolean
  scale: number
  pos: { x: number; y: number } | null
}

// ── Mobile Remote Control gateway (Electron main; Wave 2) ────────────────────
// Device pairing + revoke for the Tailscale-bound HTTP gateway. The gateway
// itself (binding, HTTP server, token store) lives entirely in the main process;
// the renderer only manages pairing sessions and the paired-device list.
export type AwogRemoteDevice = {
  id: string
  label: string
  platform: string
  pairedAt: string
  lastSeenAt?: string
}
export type AwogGatewayStatus = {
  // User opt-in for remote control. False → main binds no port at all, however
  // the tailnet reads below.
  enabled: boolean
  tailnet: 'connected' | 'disconnected'
  host: string | null
  port: number
  bound: boolean
}
export type AwogPairingInfo = {
  code: string
  expiresAt: number
  host: string
  port: number
}
export interface AwogGatewayBridge {
  status(): Promise<AwogGatewayStatus>
  // Turn remote control on/off; off closes every live connection at once.
  // Resolves with the resulting status.
  setEnabled(on: boolean): Promise<AwogGatewayStatus>
  listDevices(): Promise<AwogRemoteDevice[]>
  // Rejects when the tailnet is not connected — there is no reachable host to
  // pair against, so the UI must gate this behind a connected status.
  createPairing(): Promise<AwogPairingInfo>
  revokeDevice(id: string): Promise<boolean>
  // Subscribe to live changes; each returns an unsubscribe function.
  onDevicesChanged(cb: (devices: AwogRemoteDevice[]) => void): () => void
  onStatusChanged(cb: (status: AwogGatewayStatus) => void): () => void
}

export interface AwogBridge {
  // Resolves with the JSON-RPC result, or rejects with { code, message, data }.
  request(method: string, params?: unknown): Promise<unknown>
  // Subscribe to engine events; returns an unsubscribe function.
  onEvent(handler: (event: AwogEngineEvent) => void): () => void
  // Host platform ('darwin' | 'win32' | 'linux' | …). Optional so a shell packaged
  // before native-macos-polish degrades to the plain, un-inset chrome.
  platform?: string
  // Fullscreen state of the window hosting this renderer (macOS hides the traffic
  // lights there, so the shell drops their inset). Returns an unsubscribe function.
  onFullscreen?(handler: (fullscreen: boolean) => void): () => void
  openExternal(url: string): Promise<void>
  revealPath(root: string, path: string): Promise<void>
  // Reveal a source's folder (~/.awog/sources/<slug>) in the OS file manager.
  // Takes a SLUG only — main derives + validates the path (never renderer input).
  revealSourceFolder(slug: string): Promise<void>
  // Reveal a session's folder (~/.awog/sessions/<engineId>) — takes the engineId
  // only; main derives + validates the path (never renderer input).
  revealSessionFolder(engineId: string): Promise<void>
  // Absolute on-disk path of a session's folder (for "Copy path" → clipboard).
  // Same derive + validate as revealSessionFolder.
  sessionFolderPath(engineId: string): Promise<string>
  openPath(root: string, path: string): Promise<void>
  // Open a workspace file in the default browser (file:// URL, path validated).
  openFileExternal(root: string, path: string): Promise<void>
  // Open a workspace file in its own OS window (preview popout). Main validates the
  // root/path pair against the workspace and focuses an already-open window for the
  // same file instead of stacking a duplicate.
  openPreviewWindow(root: string, path: string, name: string): Promise<void>
  // Open a session in its own OS window (session popout). Main validates the engineId
  // and focuses the window a session already has instead of stacking a duplicate.
  openSessionWindow(engineId: string, title: string): Promise<void>
  // Close a session's popout ("bring it back here"). Addressed BY SESSION ID, so a
  // renderer can only ever close a session popout — never an arbitrary window.
  closeSessionWindow(engineId: string): Promise<boolean>
  // Sessions currently owned by a popout window (read once per renderer on mount).
  listSessionWindows(): Promise<string[]>
  // Live changes to that set; returns an unsubscribe function.
  onSessionWindowsChanged(handler: (engineIds: string[]) => void): () => void
  // Embedded browser (ADR 0086). The workspace panel's "Browser" view borrows the
  // agent's Chromium tab into a rect of this window; main resolves the host window
  // from the IPC sender, so a renderer can only fill its OWN window.
  browser: {
    attach(rect: AwogBrowserRect, tabId?: string): Promise<AwogBrowserTab>
    setBounds(rect: AwogBrowserRect, tabId?: string): Promise<void>
    detach(): Promise<void>
    tabs(): Promise<AwogBrowserTabList>
    open(url: string, tabId?: string): Promise<AwogBrowserTab>
    // `wait: false` trả về ngay khi tab đã tạo + điều hướng đã bắt đầu (đường
    // người dùng bấm link, để UI không đứng chờ trang tải). Mặc định chờ tải xong.
    newTab(
      url?: string,
      opts?: { wait?: boolean },
    ): Promise<{ tabId: string; url: string; title: string }>
    selectTab(tabId: string): Promise<AwogBrowserTab>
    closeTab(tabId: string): Promise<{ closed: string; remaining: number }>
    back(tabId?: string): Promise<void>
    forward(tabId?: string): Promise<void>
    reload(tabId?: string): Promise<void>
    popout(): Promise<void>
    onChanged(handler: (list: AwogBrowserTabList) => void): () => void
    // Installed Chromium browsers + their profiles. Ids only travel over IPC;
    // main resolves them to paths itself (invariant #2).
    listBrowsers(): Promise<AwogBrowserImportSource[]>
    importProfile(
      browserId: string,
      profileDir: string,
      parts: AwogBrowserImportParts,
    ): Promise<AwogBrowserImportReport>
    // Wipe everything the agent's browser holds (the undo for an import).
    clearData(): Promise<void>
    // Restart the app so a staged import lands. Confirm first — it kills running turns.
    relaunch(): Promise<void>

    // ── phần E: read + point (all user-initiated) ─────────────────────────
    // Text the user highlighted IN the page — feeds Translate and "quote to chat".
    selection(tabId?: string): Promise<AwogBrowserSelection>
    // Arm the element picker: the page highlights on hover, and the promise
    // resolves with the element the user clicks — or null if they cancel (Esc) or
    // navigate away. At most one picker at a time.
    pickElement(tabId?: string): Promise<AwogBrowserPick | null>
    cancelPick(tabId?: string): Promise<void>
    // The page as chat context (`@page`): url + title + visible text, capped.
    pageContext(tabId?: string): Promise<AwogBrowserPageContext>
    // Save a PNG of the page into the workspace. `root` is the workspace root the
    // renderer resolved; main re-validates the write stays inside it (invariant #2).
    saveScreenshot(root: string, tabId?: string): Promise<{ path: string }>
    // Host policy (⋮ → Manage allowed sites).
    sites(): Promise<AwogBrowserSites>
    setSites(sites: AwogBrowserSites): Promise<void>
  }
  // Close the calling window (a preview popout closing itself). Main resolves the
  // target from the IPC sender, so a renderer can never close another window.
  closeSelf(): Promise<void>
  // Whether VS Code's `code` CLI is available on this machine.
  vscodeAvailable(): Promise<boolean>
  openInVscode(root: string, path: string): Promise<void>
  pickFolder(opts?: AwogDialogOpts): Promise<string | null>
  // Pick one or more folders (multi-select) → their absolute paths ([] on cancel).
  pickFolders(opts?: AwogDialogOpts): Promise<string[]>
  // Absolute on-disk path of a dropped File/folder (Electron webUtils). '' when
  // the File has no real filesystem origin (e.g. synthetic/clipboard blob).
  getPathForFile(file: File): string
  pickFile(opts?: AwogSavePathOpts): Promise<string | null>
  // Multi-select file picker (wiki Markdown import, ADR 0073). [] on cancel.
  pickFiles(opts?: AwogSavePathOpts): Promise<string[]>
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
  // Desktop pet (desktop-pet). Main-window side: prefs + model out, commands and
  // the post-drag position in. Pet side: model in, commands + hit-test + drag out.
  // Optional so an older shell (packaged before the pet shipped) degrades to no pet
  // instead of throwing — the composable guards on `sendPetPrefs`.
  sendPetPrefs?(prefs: AwogPetPrefs): void
  sendPetUpdate?(status: AwogPetStatus): void
  onPetModel?(handler: (model: AwogPetModel) => void): () => void
  sendPetCommand?(cmd: AwogPetCommand): void
  onPetCommand?(handler: (cmd: AwogPetCommand) => void): () => void
  onPetMoved?(handler: (pos: { x: number; y: number }) => void): () => void
  setPetInteractive?(on: boolean): void
  sendPetDrag?(phase: 'start' | 'end'): void
  // Mobile Remote Control gateway (Wave 2). Optional so an older shell without
  // the gateway degrades gracefully — the renderer guards on `window.awog?.gateway`.
  gateway?: AwogGatewayBridge
}

declare global {
  interface Window {
    awog?: AwogBridge
  }
}
