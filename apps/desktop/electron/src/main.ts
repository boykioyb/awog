import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { engine } from './engine'
import { browser, registerBrowserHostHandlers } from './browser'
import { registerIpc } from './ipc'
import { registerLogTailIpc, setupLogging, stopLogTail } from './logger'
import { loadShellEnv } from './shell-env'
import { registerMediaProtocol } from './media'
import { startRemoteGateway, stopRemoteGateway } from './remote-gateway'
import { petWindow, type PetCommand, type PetPrefs, type PetStatus } from './pet-window'
import { trayPopover } from './popover'
import { setupTray, updateTray, type TrayCommand, type TrayModel } from './tray'
import { setupUpdater } from './updater'
import { createMainWindow, registerAppProtocolScheme } from './window'

// File logging first — so anything that fails during startup leaves a trace
// (a packaged GUI app has no terminal for stderr).
setupLogging()

// AWOG Electron entry — the host process. Replaces the Tauri Rust shell:
// owns the window + app lifecycle, spawns the Node engine as a utility process,
// and bridges renderer ⇄ engine through the IPC router (ipc.ts).

let mainWindow: BrowserWindow | null = null

const getWindow = (): BrowserWindow | null => mainWindow

// Create the main window and drop the reference when it closes, so the dock
// re-activate + tray re-open work from a clean (null) state instead of poking a
// destroyed window.
function openMainWindow(): void {
  mainWindow = createMainWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
    // A hard window close skips the renderer's onBeforeUnmount, so end any
    // active log-tail poll here rather than leaving watchFile running.
    stopLogTail()
    // Nobody computes the pet model anymore. macOS keeps the app alive, so the pet
    // stays up (greyed) and its click re-opens the window; elsewhere the app quits
    // on last window, so the pet must go too — an open pet would keep
    // `window-all-closed` from ever firing and the app would hang in the tray.
    if (process.platform === 'darwin') petWindow.markOffline()
    else petWindow.close()
  })
}

// Show + focus the main window, re-creating it if it was closed. Shared by the
// tray click, the tray menu, and tray command handling.
function showWindow(): void {
  if (!mainWindow) openMainWindow()
  else {
    mainWindow.show()
    mainWindow.focus()
  }
}

// Live tray status (feature: system-tray-status). Left-click toggles the styled
// popover window; the renderer pushes a lightweight indicator (running count +
// tooltip). The popover forwards item clicks over `tray:navigate` → we hide it,
// show the main window, and relay the command so the main renderer routes there.
function setupTrayBridge(): void {
  setupTray({
    showWindow,
    toggleBrowser: () => (browser.isVisible() ? browser.hide() : browser.show()),
    togglePopover: (bounds) => trayPopover.toggle(bounds),
    togglePet: () => {
      // The pref lives in the renderer, so the tray asks it to flip rather than
      // creating/destroying the window behind its back. With no main window there is
      // nobody to ask — just bring the app back; the pet follows its saved pref.
      if (!mainWindow) {
        showWindow()
        return
      }
      mainWindow.webContents.send('pet:command', { kind: 'toggle' } satisfies PetCommand)
    },
  })
  ipcMain.on('tray:update', (_e, model: TrayModel) => updateTray(model))
  ipcMain.on('tray:navigate', (_e, cmd: TrayCommand) => {
    trayPopover.hide()
    showWindow()
    getWindow()?.webContents.send('tray:command', cmd)
  })
}

// Desktop pet (feature: desktop-pet). The main window owns the state, so it pushes
// prefs (create/resize/move) + the status model; the pet window sends back clicks,
// its hit-test result, and drag phases. Only an `open` command raises the app — an
// approval must resolve without yanking the user out of what they are doing.
function setupPetBridge(): void {
  ipcMain.on('pet:enabled', (_e, prefs: PetPrefs) => petWindow.apply(prefs))
  ipcMain.on('pet:update', (_e, status: PetStatus) => petWindow.push(status))
  ipcMain.on('pet:interactive', (_e, on: boolean) => petWindow.setInteractive(!!on))
  ipcMain.on('pet:drag', (_e, phase: 'start' | 'end') => {
    if (phase === 'start') {
      petWindow.startDrag()
      return
    }
    const pos = petWindow.endDrag()
    if (pos) getWindow()?.webContents.send('pet:moved', pos)
  })
  ipcMain.on('pet:navigate', (_e, cmd: PetCommand) => {
    if (cmd?.kind === 'open') showWindow()
    getWindow()?.webContents.send('pet:command', cmd)
  })
}

// Single-instance: a second launch focuses the existing window instead of
// starting a rival engine that would fight over the workspace files.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  // registerSchemesAsPrivileged must run before the app is ready.
  registerAppProtocolScheme()

  app.whenReady().then(() => {
    setupAppMenu()
    // macOS: keep the app in the Dock. Secondary windows (tray popover) must not
    // turn this into a background/accessory app — show the Dock icon explicitly.
    if (process.platform === 'darwin') app.dock?.show()
    // Recover the user's real PATH (Homebrew/nvm/…) before spawning the engine,
    // so the agent's Bash tool / PTY / git runner can find tools under a GUI
    // (Finder/Dock) launch that strips the environment. No-op in dev + Windows.
    loadShellEnv()
    engine.start()
    // Expose the browser.* reverse-channel handlers so the sidecar's browser_tool
    // can drive the embedded Chromium (ADR 0043). The window itself is lazy.
    registerBrowserHostHandlers()
    // media:// stream protocol for in-app video/audio preview (must run post-ready).
    registerMediaProtocol()
    registerIpc(getWindow)
    // Mobile Remote Control (ADR 0067): WS gateway bound to the tailnet only.
    // Fail-closed — a no-op when Tailscale isn't up.
    startRemoteGateway(getWindow)
    setupUpdater(getWindow)
    registerLogTailIpc(getWindow)
    openMainWindow()
    setupTrayBridge()
    setupPetBridge()

    app.on('activate', () => {
      // macOS: re-create the MAIN window when the dock icon is clicked and it's gone.
      // Keyed on `mainWindow`, not the window count — a popout left open (preview or
      // session) would otherwise make the dock click a no-op with no way back in.
      if (!mainWindow) openMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    // macOS apps stay alive until Cmd+Q; other platforms quit on last window.
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    browser.close()
    petWindow.close()
    stopRemoteGateway()
    engine.stop()
  })
}

// Hide the application menu bar. Windows/Linux: remove the in-window
// File/Edit/View/Window/Help bar entirely. macOS: the menu lives in the system
// bar (not the window), so keep a MINIMAL one so ⌘C/⌘V/⌘X/⌘A/⌘Q/⌘W still work —
// dropping it breaks those shortcuts.
//
// The default `role: 'appMenu'` binds ⌘H to "Hide", and on macOS a menu
// accelerator is consumed before the key event reaches the web view — so the
// renderer could never see ⌘H. AWOG's global shortcuts use ⌘H to open the
// session Files view, so we rebuild the app submenu with a Hide item that has NO
// accelerator (Hide stays in the menu, just loses its shortcut). Every other
// standard item keeps its role + default accelerator.
function setupAppMenu(): void {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            // Hide without ⌘H — freed for the renderer's Files shortcut.
            { label: `Hide ${app.name}`, click: () => app.hide() },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        { role: 'editMenu' },
        { role: 'windowMenu' },
      ]),
    )
  } else {
    Menu.setApplicationMenu(null)
  }
}

