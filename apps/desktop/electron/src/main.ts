import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { engine } from './engine'
import { browser, registerBrowserHostHandlers } from './browser'
import { registerIpc } from './ipc'
import { registerLogTailIpc, setupLogging, stopLogTail } from './logger'
import { loadShellEnv } from './shell-env'
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
  })
  ipcMain.on('tray:update', (_e, model: TrayModel) => updateTray(model))
  ipcMain.on('tray:navigate', (_e, cmd: TrayCommand) => {
    trayPopover.hide()
    showWindow()
    getWindow()?.webContents.send('tray:command', cmd)
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
    registerIpc(getWindow)
    setupUpdater(getWindow)
    registerLogTailIpc(getWindow)
    openMainWindow()
    setupTrayBridge()

    app.on('activate', () => {
      // macOS: re-create the window when the dock icon is clicked and none open.
      if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    // macOS apps stay alive until Cmd+Q; other platforms quit on last window.
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    browser.close()
    engine.stop()
  })
}

// Hide the application menu bar. Windows/Linux: remove the in-window
// File/Edit/View/Window/Help bar entirely. macOS: the menu lives in the system
// bar (not the window), so keep a MINIMAL one so ⌘C/⌘V/⌘X/⌘A/⌘Q/⌘W still work —
// dropping it breaks those shortcuts.
function setupAppMenu(): void {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
    )
  } else {
    Menu.setApplicationMenu(null)
  }
}

