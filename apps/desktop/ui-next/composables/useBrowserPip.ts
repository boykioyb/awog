import type { AwogBrowserTabList } from '~/types/awog-bridge'
import { useSessionsStore } from '~/stores/sessions'
import { useWorkspacePanel } from '~/composables/useWorkspacePanel'

// Browser Picture-in-Picture — bề mặt THỨ BA của trình duyệt nhúng (ADR 0086),
// cạnh view "Browser" của workspace panel và cửa sổ popout: một card nổi TRONG
// app giữ `WebContentsView` sống (tương tác được, không phải preview), kéo/resize
// được, trả về panel hoặc bật popout bằng một nút.
//
// State ở đây là UI THUẦN ở cấp module (một renderer = một PiP): card có mở
// không, đậu ở đâu. Phần "giữ view native" không nằm ở đây — `BrowserPip.vue`
// tự tạo một instance `useEmbeddedBrowser`, và trọng tài `owner` cấp module của
// composable đó quyết định ai hiển thị, đúng mô hình hai-dock / popout sẵn có.
// Composable này không nói chuyện IPC attach/detach.
//
// CHỈ MỞ THỦ CÔNG (session-main-tabs): cơ chế auto-PiP "agent duyệt mà không ai
// hiển thị trang ⇒ card tự hiện" đã bị gỡ — tab web mới của agent giờ hiện lên
// main strip (không giật focus), còn card nổi chỉ xuất hiện khi người dùng chủ
// động gọi `openPip`/`togglePip` (menu ⋯ trên navbar, ⇧⌘B, status bar). Một
// subscriber `browser.onChanged` duy nhất còn tồn tại chỉ để DỌN DẸP: scope
// đang xem hết tab thì card tự thu, đổi session cũng vậy — và nó chỉ đăng ký
// trong layout default tức cửa sổ CHÍNH (popout dùng `layout:false`).

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
// Thu nhỏ = card sập còn thanh tiêu đề, view native park về holder (trang vẫn
// chạy nền — `backgroundThrottling:false`) chứ KHÔNG phải đóng: chủ khác
// (panel/popout/main tab) được quyền giành view, và bấm restore là giành lại.
// Không persist — mở lại card là muốn thấy ngay.
const minimized = ref(false)
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
  minimized.value = false
  open.value = true
  // MỞ PiP = "chuyển browser ra card nổi": một trang chỉ sống ở MỘT bề mặt, nên
  // view Browser đang mở trong panel thì đóng luôn — để nó lại thì cả cửa sổ
  // thấy card trang + placeholder "elsewhere" trông như render trùng (lỗi thật
  // 2026-09-28). "Trả về panel" mở lại đúng view này. Cú đóng-view này KHÔNG
  // tính là dismiss — watcher `requested` bên dưới skip khi `open` đã bật.
  const { openViews, toggleView } = useWorkspacePanel()
  if (openViews.value.includes('Browser')) toggleView('Browser')
}

// Đóng card. `closePip`/`dismissPip` giờ cùng nghĩa — auto-open không còn nên
// không cần phân biệt "hệ thống đóng" vs "người dùng gạt" nữa; giữ cả hai tên
// cho các caller hiện có (nút × trên card, "trả về panel", shortcut).
const closePip = (): void => {
  open.value = false
}

const dismissPip = closePip

const togglePip = (): void => {
  if (open.value) dismissPip()
  else openPip()
}

const toggleMinimize = (): void => {
  minimized.value = !minimized.value
}

// Dọn dẹp trên một lần broadcast `browser:changed` — KHÔNG mở gì cả (PiP chỉ
// mở thủ công). Duy nhất một việc: scope đang xem hết sạch tab thì thu card —
// để card lơ lửng một khung trống (hoặc giữ view của tab không còn tồn tại) là
// bug. `mine` lọc theo engineId của phiên đang xem, cùng cách `applyList` của
// useEmbeddedBrowser lọc cho mặt của nó.
const onListChanged = (list: AwogBrowserTabList): void => {
  const scope = useSessionsStore().active?.engineId
  const mine = scope === undefined ? list.tabs : list.tabs.filter((t) => t.scope === scope)
  if (mine.length === 0) open.value = false
}

let initialized = false
const init = (): void => {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  loadGeometry()
  window.addEventListener('resize', clampToWindow)
  // `?` vì browser-dev không có bridge — mở thủ công vẫn được (card hiện trạng
  // thái unavailable), còn subscriber dọn dẹp thì không có gì để nghe.
  const api = window.awog?.browser
  api?.onChanged(onListChanged)
  // Đổi phiên KHÔNG phát `browser:changed` (list không đổi, chỉ chủ quan sát
  // đổi) → tự hỏi list của scope mới: phiên mới chưa có tab thì thu card. Scope
  // detached để watcher sóng qua unmount của component gọi đầu tiên.
  const sessions = useSessionsStore()
  effectScope(true).run(() => {
    watch(
      () => sessions.active?.engineId,
      async (scope) => {
        const list = await api?.tabs(scope)
        if (list) onListChanged(list)
      },
    )
  })
}

export function useBrowserPip() {
  init()
  return {
    open,
    minimized,
    rect,
    setPos,
    setSize,
    persistGeometry,
    clampToWindow,
    openPip,
    closePip,
    dismissPip,
    togglePip,
    toggleMinimize,
  }
}
