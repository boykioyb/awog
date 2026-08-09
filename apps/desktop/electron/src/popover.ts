import { BrowserWindow, screen, type Rectangle } from 'electron'
import { applyNavigationGuards, loadAppRoute } from './window'
import { preloadPath } from './paths'

// Frameless popover window anchored under the tray icon — the styled tray UI
// (docs/features/system-tray-status.md). Native Tray menus can't render CSS /
// progress bars, so the rich view lives in this Nuxt route (`/tray-popover`).
// One reused, hidden-by-default window: left-click the tray toggles it, blur
// hides it. SoC: this only manages the window; the page owns the content.

const WIDTH = 380
const HEIGHT = 540
const GAP = 6 // px between the menu bar / taskbar and the popover
const REOPEN_GUARD_MS = 250 // ignore the click that follows a blur-hide

class TrayPopover {
  private win: BrowserWindow | null = null
  private hiddenAt = 0

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // Opaque, themed by the page itself — robust vs. a transparent window
      // (rounded corners need transparency, which flickers across platforms).
      backgroundColor: '#1a1a1a',
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    // This window carries the same preload as the main one, so it needs the same
    // guards: a `window.open` child would inherit the preload, and a plain link
    // would navigate the popover itself off-origin while keeping it.
    applyNavigationGuards(win)
    win.on('blur', () => {
      if (win.webContents.isDevToolsFocused()) return
      this.hide()
    })
    win.on('closed', () => {
      if (this.win === win) this.win = null
    })
    loadAppRoute(win, 'tray-popover')
    this.win = win
    return win
  }

  // Toggle from a tray click. `bounds` is the icon rectangle Electron passes.
  toggle(bounds: Rectangle): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.hide()
      return
    }
    // The blur that fired when the user clicked the icon already hid us; ignore
    // the immediately-following click so the icon acts as a real toggle.
    if (Date.now() - this.hiddenAt < REOPEN_GUARD_MS) return
    const win = this.ensure()
    this.positionAt(win, bounds)
    win.show()
    win.focus()
  }

  hide(): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.win.hide()
      this.hiddenAt = Date.now()
    }
  }

  private positionAt(win: BrowserWindow, bounds: Rectangle): void {
    const { width: w, height: h } = win.getBounds()
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
    const area = display.workArea
    // Center horizontally on the icon, clamped inside the work area.
    let x = Math.round(bounds.x + bounds.width / 2 - w / 2)
    x = Math.max(area.x + GAP, Math.min(x, area.x + area.width - w - GAP))
    // macOS: menu bar is at top → drop below the icon. Win/Linux: taskbar is
    // usually at the bottom → place above it.
    const below = bounds.y <= area.y + 40
    const y = below ? Math.round(bounds.y + bounds.height + GAP) : Math.round(area.y + area.height - h - GAP)
    win.setPosition(x, y, false)
  }
}

export const trayPopover = new TrayPopover()
