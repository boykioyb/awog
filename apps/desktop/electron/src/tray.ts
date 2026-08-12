import { app, Menu, nativeImage, Tray, type Rectangle } from 'electron'
import { trayIconPath } from './paths'

// System tray (docs/features/system-tray-status.md). The rich, STYLED status
// view lives in a frameless popover window (popover.ts) — native menus can't
// render bars/colours. So: left-click toggles the popover; right-click shows a
// minimal native fallback menu. This module also applies the lightweight
// indicator the renderer pushes: the macOS title (running count) + tooltip.

export type TrayCommand =
  | { kind: 'activity' }
  // Stable sidecar engine id ("ses-…"), NOT the per-window numeric client id: the
  // popover is a separate renderer with its own Pinia store + id counter, so a
  // numeric id never matches the main window's session list.
  | { kind: 'session'; engineId: string }
  | { kind: 'task'; id: string }

// Pushed from the renderer (useTrayStatus). Only the glanceable indicator —
// the popover computes its own detailed view. `unreadCount` drives the Dock/taskbar
// badge (Telegram-style red bubble) — the number of finished-but-unread sessions.
export type TrayModel = { macTitle: string; tooltip: string; unreadCount: number }

type TrayDeps = {
  // Show + focus the main window (creating it if it was closed).
  showWindow: () => void
  // Toggle the embedded browser window.
  toggleBrowser: () => void
  // Toggle the styled popover at the clicked icon bounds.
  togglePopover: (bounds: Rectangle) => void
  // Toggle the desktop pet (feature: desktop-pet) — the fallback way back when the
  // pet was dragged somewhere unreachable or turned off and Settings feels far away.
  togglePet: () => void
}

let tray: Tray | null = null
let deps: TrayDeps | null = null

export function setupTray(d: TrayDeps): void {
  deps = d
  const icon = nativeImage.createFromPath(trayIconPath())
  if (icon.isEmpty()) return // no icon available — skip tray rather than crash
  // macOS: template image → menu bar renders it black/white with no background.
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('AWOG')
  // Left-click → styled popover (no setContextMenu, or it would hijack the click).
  tray.on('click', (_e, bounds) => deps?.togglePopover(bounds))
  // Right-click → minimal native fallback menu.
  tray.on('right-click', () => tray?.popUpContextMenu(buildMenu()))
}

// Apply the renderer's indicator: Dock badge + tooltip + (macOS) the running-count title.
export function updateTray(next: TrayModel): void {
  // Dock/taskbar badge = unread-session count (Telegram-style red bubble). Set BEFORE
  // the tray guard so it shows even if the tray icon failed to create. setBadgeCount(0)
  // clears it; macOS shows the number, Linux/Unity too, Windows is a no-op.
  app.setBadgeCount(Math.max(0, next.unreadCount ?? 0))
  if (!tray) return
  tray.setToolTip(next.tooltip || 'AWOG')
  // macOS-only text beside the menu-bar icon. Guard — undefined elsewhere.
  if (process.platform === 'darwin') tray.setTitle(next.macTitle ?? '')
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: 'Show AWOG', click: () => deps?.showWindow() },
    { label: 'Toggle browser window', click: () => deps?.toggleBrowser() },
    { label: 'Toggle desktop pet', click: () => deps?.togglePet() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ])
}
