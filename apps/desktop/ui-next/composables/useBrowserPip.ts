import type { AwogBrowserTabList } from '~/types/awog-bridge'
import { useSettingsStore } from '~/stores/settings'
import { useSessionsStore } from '~/stores/sessions'
import { useWorkspacePanel } from '~/composables/useWorkspacePanel'

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
// Thu nhỏ = card sập còn thanh tiêu đề, view native park về holder (trang vẫn
// chạy nền — `backgroundThrottling:false`) chứ KHÔNG phải đóng: `dismissed`
// không bật, chủ khác (panel/popout) được quyền giành view, và bấm restore là
// giành lại. Không persist — mở lại card là muốn thấy ngay.
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
  // "Chủ động mở" xoá cờ dismissed — người dùng đã đổi ý, auto-open lại được
  // phép chạy tiếp cho đợt này nữa.
  dismissed.value = false
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

const toggleMinimize = (): void => {
  minimized.value = !minimized.value
}

// Phán đoán auto-open trên một lần broadcast `browser:changed`.
//
// BROWSER PER-SESSION: card PiP của cửa sổ chính theo phiên ĐANG XEM —
// `mine` chỉ gồm tab thuộc engineId của phiên đó (vắng session ⇒ pool global
// như cũ). Broadcast là danh sách global nên lọc ở đây, cùng cách
// `applyList` của useEmbeddedBrowser lọc cho mặt của nó.
const maybeAutoPip = (list: AwogBrowserTabList): void => {
  const scope = useSessionsStore().active?.engineId
  const mine = scope === undefined ? list.tabs : list.tabs.filter((t) => t.scope === scope)
  // Hết burst CỦA SCOPE NÀY: thu card (nếu đang mở) + trả quyền auto-open cho
  // đợt sau. Đổi sang phiên chưa có browser cũng đi qua đây — card đóng thay vì
  // lơ lửng một khung trống.
  if (mine.length === 0) {
    dismissed.value = false
    open.value = false
    return
  }
  if (!useSettingsStore().sessions.browserAutoPip) return
  if (open.value || dismissed.value) return
  // View Browser đang HIỂN THỊ trong panel của session hiện tại → panel là nhà
  // của nó, card không được nhảy vào giành. `browserActive` (khác openViews —
  // chỉ true khi view là tab ACTIVE của dock và session đang được xem) cover đúng
  // race thật (2026-09-28): `openInApp` của useLinkOpen mở view + tạo tab cùng
  // lúc, event `changed` tới trước khi panel kịp attach (`shown` còn false) →
  // PiP giành view, panel vỡ thành "elsewhere". Tab Browser đang park hay page
  // bị KeepAlive giấu thì cờ false → card vẫn được phép hiện (đúng semantics
  // "không ai đang hiển thị trang").
  if (useWorkspacePanel().browserActive.value) return
  const activeId = scope === undefined ? list.activeTabId : (list.activeByScope?.[scope] ?? null)
  const active = mine.find((t) => t.tabId === activeId)
  // `shown`/`shownElsewhere` đã là per-window của main: cả hai cùng false nghĩa
  // là KHÔNG bề mặt nào — panel, dock mép kia, PiP, popout — đang hiển thị trang.
  if (!active || active.shown || active.shownElsewhere) return
  // Tab trắng không auto-open: `hasPage` của embedded browser cũng từ chối
  // attach about:blank, nên card chỉ hiện empty-state — nháy một khung trống lên
  // mỗi khi agent mở tab là đúng cái phiền mà PiP được sinh ra để xoá.
  const url = active.url.trim()
  if (!url || url === 'about:blank') return
  minimized.value = false
  open.value = true
}

let initialized = false
const init = (): void => {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  loadGeometry()
  window.addEventListener('resize', clampToWindow)
  const { requested, openViews } = useWorkspacePanel()
  // User vừa ĐÓNG view Browser của panel (nút × của chrome hay chip status bar,
  // cả hai đều đi qua `requested`) → coi như "giấu trình duyệt đi": nếu để mặc
  // định, `changed` kế tiếp sẽ thấy view mồ côi và auto-open bật card lên NGAY
  // — đúng cái "tôi vừa đóng nó" gây khó chịu nhất. `requested` chỉ bắn trên
  // cú toggle tường minh nên đổi session (publish openViews mới) không bị cuốn
  // theo. Toggle này mở view thì danh sách chưa chứa 'Browser' → không chạm.
  //
  // DETACHED scope: init() chạy trong setup của component gọi đầu tiên — nếu là
  // WorkspaceBrowser thì đóng view sẽ unmount nó và giết luôn watcher này.
  const scope = effectScope(true)
  scope.run(() => {
    watch(requested, (req) => {
      // `open` đã bật ⇒ cú đóng view này là của chính vụ move trong openPip (hoặc
      // user đóng view khi card đang giữ nó — suppress cũng đúng), không tính.
      if (req?.view !== 'Browser' || open.value) return
      if (openViews.value.includes('Browser')) dismissed.value = true
    })
  })
  // `?` vì browser-dev không có bridge — mở thủ công vẫn được (card hiện trạng
  // thái unavailable), còn auto-open thì không có gì để nghe.
  const api = window.awog?.browser
  api?.onChanged(maybeAutoPip)
  // Seed một lần: `changed` chỉ phát khi có ĐỔI, mà reload renderer (dev) thì
  // tab đang rảnh đã nằm sẵn đó từ trước — không có event nào tới cả.
  void api?.tabs().then(maybeAutoPip)
  // Đổi phiên KHÔNG phát `browser:changed` (list không đổi, chỉ chủ quan sát
  // đổi) → tự hỏi list của scope mới để card theo đúng "browser của phiên này":
  // phiên mới chưa có tab thì thu card, có tab đang trôi thì maybeAutoPip cân
  // nhắc mở. Cùng effectScope detached phía trên để sóng qua unmount.
  const sessions = useSessionsStore()
  scope.run(() => {
    watch(
      () => sessions.active?.engineId,
      async (scope) => {
        const list = await api?.tabs(scope)
        if (list) maybeAutoPip(list)
      },
    )
  })
}

export function useBrowserPip() {
  init()
  return {
    open,
    dismissed,
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
    maybeAutoPip,
  }
}
