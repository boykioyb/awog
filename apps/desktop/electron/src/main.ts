import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { engine } from './engine'
import { registerIpc } from './ipc'
import { trayIconPath } from './paths'
import { createMainWindow, registerAppProtocolScheme } from './window'

// AWOG Electron entry — the host process. Replaces the Tauri Rust shell:
// owns the window + app lifecycle, spawns the Node engine as a utility process,
// and bridges renderer ⇄ engine through the IPC router (ipc.ts).

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

const getWindow = (): BrowserWindow | null => mainWindow

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
    engine.start()
    registerIpc(getWindow)
    mainWindow = createMainWindow()
    setupTray()

    app.on('activate', () => {
      // macOS: re-create the window when the dock icon is clicked and none open.
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    // macOS apps stay alive until Cmd+Q; other platforms quit on last window.
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
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

function setupTray(): void {
  const icon = nativeImage.createFromPath(trayIconPath())
  if (icon.isEmpty()) return // no icon available — skip tray rather than crash
  // macOS: template image → menu bar renders it black/white with no background.
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('AWOG')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show AWOG',
        click: () => {
          if (!mainWindow) mainWindow = createMainWindow()
          else mainWindow.show()
          mainWindow.focus()
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}
