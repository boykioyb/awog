import { BrowserWindow, screen } from 'electron'
import { log } from './logger'
import { preloadPath } from './paths'
import type { TrayCommand } from './tray'
import { applyNavigationGuards, loadAppRoute } from './window'

// Desktop pet (docs/features/desktop-pet.md) — a small transparent, always-on-top,
// click-through window carrying an ambient status sprite + mini-HUD. "Glance at the
// corner of your eye" instead of opening the app to see whether AWOG is busy, stuck
// on an approval, or done.
//
// PASSIVE RENDERER, exactly like the tray popover: the MAIN WINDOW already owns the
// sessions/tasks stores, so it computes the whole PetModel and pushes it here; the
// pet only renders and sends commands back. It is deliberately NOT added to the
// engine:event fan-out (ipc.ts) — a second renderer acting on that stream would
// drive the same turn twice.
//
// Security: same preload + contextIsolation + sandbox + navigation guards as every
// other AWOG surface (invariant #4). Commands coming back are L1 — the MAIN WINDOW
// validates them (a permission decision must still match its pending request).

export type PetState = 'idle' | 'working' | 'awaiting' | 'done' | 'offline'
export type PetSprite = 'girl' | 'shiba' | 'dino' | 'chicken' | 'miku'

export type PetItem = {
  kind: 'session' | 'task'
  // session → stable engine id; task → task id. Only ever travels back as a
  // TrayCommand the main window resolves through its normal open path.
  id: string
  title: string
  hint: 'awaiting' | 'running' | 'unread'
  percent?: number
  // One-line preview of what this session/task is actually doing right now (last
  // message text / current step). Absent when there is nothing loaded to show.
  preview?: string
}

// Summary only. This window floats above every other app, so it carries the tool
// name + a short target and never the tool input itself (invariant #1).
export type PetPermission = { requestId: string; toolName: string; target: string }

// What the MAIN WINDOW computes and pushes. It knows the status; it does NOT know
// where the pet window sits, so `facing` is not its to send.
export type PetStatus = Omit<PetModel, 'facing'>

export type PetModel = {
  state: PetState
  counts: { running: number; attention: number; unread: number }
  items: PetItem[]
  permission: PetPermission | null
  // Prefs the PET renders with — pushed along the model rather than on their own
  // channel, since the main window computes both from the same place.
  autoPeek: boolean
  sprite: PetSprite
  // Applies to the SPRITE only — the HUD, the speech bubble and the badge stay at
  // design size, so text never changes size with it. The pet does it in CSS: it must
  // NOT be done with webContents.setZoomFactor, whose zoom is per-ORIGIN, so zooming
  // the pet would zoom every window on the same origin — i.e. the whole app.
  scale: number
  // Let the pet say something now and then (Settings → Pet).
  quips: boolean
  // Let the pet perform its pack's skill (sheet row `special`) — see pet.vue.
  tricks: boolean
  // Lines for the CURRENT state, already resolved (user edits ?? localised default) —
  // the pet only picks one at random, it never reads settings or i18n itself.
  quipLines: string[]
  // Time-based nudges + how often, 0 = off. Independent of state.
  reminders: string[]
  reminderMs: number
  // Which way the pet looks. Owned by MAIN because only it knows where the window
  // sits: a pet parked at the right edge should face INTO the screen, not off it.
  facing: 'left' | 'right'
}

export type PetCommand =
  | { kind: 'open'; target: TrayCommand }
  | { kind: 'permission'; requestId: string; decision: 'allow' | 'deny' }
  | { kind: 'toggle' }

// Prefs the MAIN process acts on: whether the window exists at all, how big it is,
// and where it sits. The renderer's settings store stays the single source of truth.
export type PetPrefs = {
  enabled: boolean
  scale: number
  pos: { x: number; y: number } | null
}

const BASE_WIDTH = 320
// Tall enough for the sprite + three two-line HUD rows + the permission card. The
// surplus is transparent and click-through, so an over-tall window costs nothing.
const BASE_HEIGHT = 280
const EDGE_GAP = 12
const SCALE_MIN = 1
const SCALE_MAX = 1.5
// Drag is driven from MAIN off the cursor position, not from renderer mouse deltas:
// the window moves under the cursor while dragging, so per-frame renderer coords
// would fight the move. ~60fps.
const DRAG_TICK_MS = 16

// `setIgnoreMouseEvents(true, { forward: true })` — the click-through mode that
// still delivers mousemove, which is what the renderer hit-test runs on — is macOS
// + Windows only. On Linux a click-through pet would never receive the move events
// that make it interactive again, i.e. a pet you can't click. So there it stays a
// normal (interactive) window; the cost is that its 320×200 frame swallows clicks
// in that corner. See the edge-case table in docs/features/desktop-pet.md.
const SUPPORTS_CLICK_THROUGH = process.platform !== 'linux'

const OFFLINE_STATUS: PetStatus = {
  state: 'offline',
  counts: { running: 0, attention: 0, unread: 0 },
  items: [],
  permission: null,
  autoPeek: true,
  quips: true,
  tricks: true,
  quipLines: [],
  reminders: [],
  reminderMs: 0,
  sprite: 'girl',
  scale: SCALE_MIN,
}

const clampScale = (n: number): number =>
  Number.isFinite(n) ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, n)) : SCALE_MIN

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

class PetWindow {
  private win: BrowserWindow | null = null
  private scale = SCALE_MIN
  // Replayed on (re)create: the window may be born after the main window computed
  // its first status, and an empty pet for one debounce window looks broken.
  private lastStatus: PetStatus = OFFLINE_STATUS
  // A pet parked on the right half of the screen should look INTO the screen, not
  // off the edge. Recomputed whenever the window moves.
  private facing: PetModel['facing'] = 'left'
  private dragTimer: ReturnType<typeof setInterval> | null = null
  private dragOffset = { x: 0, y: 0 }

  // Single entry point for the renderer's prefs — create / resize / move / destroy.
  apply(prefs: PetPrefs): void {
    if (!prefs?.enabled) {
      this.close()
      return
    }
    this.scale = clampScale(prefs.scale)
    const win = this.ensure()
    // A non-resizable window pins its min/max size to the current one, so setSize is
    // ignored — briefly allow resizing to apply the new scale. The frame grows by the
    // full factor while the renderer only scales the SPRITE inside it (PetModel.scale):
    // that headroom is what keeps the taller pet from pushing the HUD out of frame.
    win.setResizable(true)
    win.setSize(Math.round(BASE_WIDTH * this.scale), Math.round(BASE_HEIGHT * this.scale))
    win.setResizable(false)
    this.place(win, prefs.pos)
    // showInactive: a status ornament must never steal focus from what the user types in.
    if (!win.isVisible()) win.showInactive()
  }

  push(status: PetStatus): void {
    this.lastStatus = status
    this.send()
  }

  private send(): void {
    if (!this.win || this.win.isDestroyed()) return
    this.win.webContents.send('pet:model', { ...this.lastStatus, facing: this.facing })
  }

  // The main window is gone (macOS keeps the app alive) → nobody computes the status
  // anymore, so say so instead of freezing on the last known state. Keep the render
  // prefs: the pet should not change species on its way to sleep.
  markOffline(): void {
    this.push({
      ...OFFLINE_STATUS,
      autoPeek: this.lastStatus.autoPeek,
      quips: this.lastStatus.quips,
      tricks: this.lastStatus.tricks,
      quipLines: this.lastStatus.quipLines,
      reminders: this.lastStatus.reminders,
      reminderMs: this.lastStatus.reminderMs,
      sprite: this.lastStatus.sprite,
      scale: this.lastStatus.scale,
    })
  }

  // Face into the screen, not off its edge. Cheap enough to run on every drag tick;
  // it only re-sends when the answer actually flips.
  private refreshFacing(): void {
    if (!this.win || this.win.isDestroyed()) return
    const [x, y] = this.win.getPosition()
    const [w, h] = this.win.getSize()
    const centre = { x: x + w / 2, y: y + h / 2 }
    const area = screen.getDisplayNearestPoint(centre).workArea
    const next: PetModel['facing'] = centre.x > area.x + area.width / 2 ? 'left' : 'right'
    if (next === this.facing) return
    this.facing = next
    this.send()
  }

  // Renderer hit-test result: the window is click-through everywhere except over the
  // sprite / open HUD. `forward` keeps mousemove flowing while transparent to clicks,
  // which is what makes the hit-test possible in the first place.
  setInteractive(on: boolean): void {
    if (!this.win || this.win.isDestroyed() || !SUPPORTS_CLICK_THROUGH) return
    this.win.setIgnoreMouseEvents(!on, { forward: true })
  }

  startDrag(): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    this.stopDragTimer()
    const cursor = screen.getCursorScreenPoint()
    const [x, y] = win.getPosition()
    this.dragOffset = { x: cursor.x - x, y: cursor.y - y }
    this.dragTimer = setInterval(() => {
      if (!this.win || this.win.isDestroyed()) {
        this.stopDragTimer()
        return
      }
      const p = screen.getCursorScreenPoint()
      this.win.setPosition(p.x - this.dragOffset.x, p.y - this.dragOffset.y, false)
      this.refreshFacing()
    }, DRAG_TICK_MS)
  }

  // Returns the resting position so the caller can persist it in the renderer (the
  // prefs live there, not in a main-process file).
  endDrag(): { x: number; y: number } | null {
    this.stopDragTimer()
    if (!this.win || this.win.isDestroyed()) return null
    const [x, y] = this.win.getPosition()
    return { x, y }
  }

  close(): void {
    this.stopDragTimer()
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  private stopDragTimer(): void {
    if (this.dragTimer) clearInterval(this.dragTimer)
    this.dragTimer = null
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      width: Math.round(BASE_WIDTH * this.scale),
      height: Math.round(BASE_HEIGHT * this.scale),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      // Never takes keyboard focus — it is an ornament, not a place you work.
      focusable: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    // 'screen-saver' is the level that stays above other apps' fullscreen windows;
    // plain alwaysOnTop drops behind them.
    win.setAlwaysOnTop(true, 'screen-saver')
    // `skipTransformProcessType` is NOT an optimisation here — it is what keeps AWOG
    // in the Dock. By default this call transforms the whole PROCESS to a
    // UIElementApplication (Electron does it so NSWindows may float over fullscreen
    // apps), and a UIElement app has no Dock icon: enabling the pet would silently
    // remove AWOG from the Dock, and app.dock.show() does not bring it back.
    // Trade-off: skipping the transform can also cost the float-over-fullscreen
    // behaviour. Dock icon wins — it is the app's front door.
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    })
    // Click-through by default; the renderer flips this on while the cursor is over
    // the sprite or the open HUD.
    if (SUPPORTS_CLICK_THROUGH) win.setIgnoreMouseEvents(true, { forward: true })
    // Same preload as every other window → same guards (a link must not navigate the
    // pet off-origin while keeping the bridge).
    applyNavigationGuards(win)
    win.webContents.on('did-finish-load', () => this.send())
    // The pet has no devtools anyone would sensibly open (it is a 320px transparent
    // ornament), so without this its errors vanish. The main window does the same.
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) log.error(`[pet-renderer] ${message} (${sourceId}:${line})`)
    })
    win.on('closed', () => {
      if (this.win === win) this.win = null
      this.stopDragTimer()
    })
    loadAppRoute(win, 'pet')
    this.win = win
    log.info('pet window opened')
    return win
  }

  // Restore the saved position, defending against the display it was saved on being
  // gone (undocked laptop) and against sitting under the Dock/taskbar.
  private place(win: BrowserWindow, pos: PetPrefs['pos']): void {
    const [w, h] = win.getSize()
    const fallback = (): void => {
      const area = screen.getPrimaryDisplay().workArea
      win.setPosition(area.x + area.width - w - EDGE_GAP, area.y + area.height - h - EDGE_GAP, false)
      this.refreshFacing()
    }
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      fallback()
      return
    }
    const center = { x: pos.x + w / 2, y: pos.y + h / 2 }
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return (
        center.x >= a.x && center.x <= a.x + a.width && center.y >= a.y && center.y <= a.y + a.height
      )
    })
    if (!onScreen) {
      fallback()
      return
    }
    const area = screen.getDisplayNearestPoint(center).workArea
    win.setPosition(
      Math.round(clamp(pos.x, area.x, area.x + area.width - w)),
      Math.round(clamp(pos.y, area.y, area.y + area.height - h)),
      false,
    )
    this.refreshFacing()
  }
}

export const petWindow = new PetWindow()
