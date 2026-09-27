import type { AwogBrowserTabList } from '~/types/awog-bridge'
import { useSettingsStore } from '~/stores/settings'

// Browser Picture-in-Picture — bề mặt THỨ BA của trình duyệt nhúng (ADR 0086),
// cạnh view "Browser" của workspace panel và cửa sổ popout: một card nổi TRONG
// app giữ `WebContentsView` sống (tương tác được, không phải preview), kéo/resize
// được, trả về panel hoặc bật popout bằng một nút.
//
// State ở đây là UI THUẦN ở cấp module (một renderer = một PiP): card có mở
// không, đậu ở đâu, người dùng đã gạt nó chưa. Phần "giữ view native" không nằm
// ở đây — `BrowserPip.vue` tự tạo một instance `useEmbeddedBrowser`, và trọng
// tài `owner` cấp module của composable đó quyết định ai hiển thị, đúng mô hình
// hai-dock / popout sẵn có. Composable này không nói chuyện IPC attach/detach.
//
// AUTO-OPEN: một subscriber `browser.onChanged` duy nhất, đăng ký lazy ở lần
// `useBrowserPip()` đầu tiên — vốn chỉ xảy ra trong layout default, tức cửa sổ
// CHÍNH (popout dùng `layout:false` nên không bao giờ auto-PiP). Nó mở card khi
// agent đang duyệt mà không bề mặt nào hiển thị trang (view Browser đóng, không
// popout). Người dùng bấm × card ⇒ `dismissed` chặn auto-open cho tới khi hết
// đợt tab (list rỗng) hoặc họ tự mở lại — `openPip` xoá cờ.

type PipRect = { x: number; y: number; w: number; h: number }

const STORAGE_KEY = 'awog.browserPip'
const MIN_W = 280
const MIN_H = 180
const DEFAULT_W = 440
const DEFAULT_H = 280
// Card không được chạm sát mép cửa sổ. Đậu mặc định ở góc phải-dưới NHƯNG phía
// trên status bar (26px + 16px khoảng thở) chứ không đè lên nó.
const EDGE = 8
const MARGIN = 16
const STATUSBAR = 26

const open = ref(false)
// Người dùng đã gạt card trong "burst" hiện tại → auto-open im cho tới khi list
// rỗng (hết đợt hoạt động) hoặc họ tự gọi `openPip`/`togglePip`.
const dismissed = ref(false)
const rect = reactive<PipRect>({ x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H })

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

const maxW = (): number => Math.max(MIN_W, window.innerWidth - EDGE * 2)
const maxH = (): number => Math.max(MIN_H, window.innerHeight - EDGE * 2)

// Dời card: giữ ít nhất EDGE px trong viewport ở mọi phía — card kéo ra ngoài
// hẳn là card mất luôn (không còn tay nắm nào để kéo lại).
const setPos = (x: number, y: number): void => {
  rect.x = Math.round(clamp(x, EDGE, Math.max(EDGE, window.innerWidth - rect.w - EDGE)))
  rect.y = Math.round(clamp(y, EDGE, Math.max(EDGE, window.innerHeight - rect.h - EDGE)))
}

const setSize = (w: number, h: number): void => {
  rect.w = Math.round(clamp(w, MIN_W, maxW()))
  rect.h = Math.round(clamp(h, MIN_H, maxH()))
  // Đổi cỡ có thể đẩy cạnh phải/dưới tràn ra ngoài (resize từ góc, hay cửa sổ
  // vừa co lại) — kéo card về trong luôn.
  setPos(rect.x, rect.y)
}

const persistGeometry = (): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rect))
  } catch {
    // Private-mode / quota — vị trí là nice-to-have, mất nó không đáng báo lỗi.
  }
}

// Vị trí đã lưu có thể trỏ ra ngoài màn hình (đổi monitor, cửa sổ co lại) —
// chạy cả ở lần nạp đầu lẫn mọi cú resize cửa sổ.
const clampToWindow = (): void => {
  setSize(rect.w, rect.h)
  persistGeometry()
}

const loadGeometry = (): void => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const p = raw ? (JSON.parse(raw) as Partial<PipRect>) : null
    const w = typeof p?.w === 'number' && Number.isFinite(p.w) ? p.w : DEFAULT_W
    const h = typeof p?.h === 'number' && Number.isFinite(p.h) ? p.h : DEFAULT_H
    setSize(w, h)
    const defaultX = window.innerWidth - rect.w - MARGIN
    const defaultY = window.innerHeight - rect.h - STATUSBAR - MARGIN
    setPos(
      typeof p?.x === 'number' && Number.isFinite(p.x) ? p.x : defaultX,
      typeof p?.y === 'number' && Number.isFinite(p.y) ? p.y : defaultY,
    )
  } catch {
    // JSON hỏng / localStorage lỗi → về góc mặc định, không chặn app.
    setSize(DEFAULT_W, DEFAULT_H)
    setPos(window.innerWidth - rect.w - MARGIN, window.innerHeight - rect.h - STATUSBAR - MARGIN)
  }
}

const openPip = (): void => {
  // "Chủ động mở" xoá cờ dismissed — người dùng đã đổi ý, auto-open lại được
  // phép chạy tiếp cho đợt này nữa.
  dismissed.value = false
  open.value = true
}

// Đóng "theo hệ thống": burst hết, view bị panel/popout giành lại, popout mở.
// KHÔNG đặt dismissed — nếu sau đó view lại rảnh (đóng popout chẳng hạn) thì
// auto-open được phép đưa card quay lại.
const closePip = (): void => {
  open.value = false
}

// Đóng "theo người dùng" (nút ×): im auto-open cho tới hết burst.
const dismissPip = (): void => {
  dismissed.value = true
  open.value = false
}

const togglePip = (): void => {
  if (open.value) dismissPip()
  else openPip()
}

// Phán đoán auto-open trên một lần broadcast `browser:changed`.
const maybeAutoPip = (list: AwogBrowserTabList): void => {
  // Hết burst: thu card (nếu đang mở) + trả quyền auto-open cho đợt sau.
  if (list.tabs.length === 0) {
    dismissed.value = false
    open.value = false
    return
  }
  if (!useSettingsStore().sessions.browserAutoPip) return
  if (open.value || dismissed.value) return
  const active = list.tabs.find((t) => t.tabId === list.activeTabId)
  // `shown`/`shownElsewhere` đã là per-window của main: cả hai cùng false nghĩa
  // là KHÔNG bề mặt nào — panel, dock mép kia, PiP, popout — đang hiển thị trang.
  if (!active || active.shown || active.shownElsewhere) return
  // Tab trắng không auto-open: `hasPage` của embedded browser cũng từ chối
  // attach about:blank, nên card chỉ hiện empty-state — nháy một khung trống lên
  // mỗi khi agent mở tab là đúng cái phiền mà PiP được sinh ra để xoá.
  const url = active.url.trim()
  if (!url || url === 'about:blank') return
  open.value = true
}

let initialized = false
const init = (): void => {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  loadGeometry()
  window.addEventListener('resize', clampToWindow)
  // `?` vì browser-dev không có bridge — mở thủ công vẫn được (card hiện trạng
  // thái unavailable), còn auto-open thì không có gì để nghe.
  const api = window.awog?.browser
  api?.onChanged(maybeAutoPip)
  // Seed một lần: `changed` chỉ phát khi có ĐỔI, mà reload renderer (dev) thì
  // tab đang rảnh đã nằm sẵn đó từ trước — không có event nào tới cả.
  void api?.tabs().then(maybeAutoPip)
}

export function useBrowserPip() {
  init()
  return {
    open,
    dismissed,
    rect,
    setPos,
    setSize,
    persistGeometry,
    clampToWindow,
    openPip,
    closePip,
    dismissPip,
    togglePip,
    maybeAutoPip,
  }
}
