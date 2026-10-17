import { BrowserWindow } from 'electron'
import { log } from './logger'
import { preloadPath } from './paths'
import { isValidThreadId } from './slack-files'
import { applyNavigationGuards, loadAppRoute, WINDOW_BACKGROUND } from './window'

// Cửa sổ Slack riêng (docs/features/slack-threads.md — "Cửa sổ riêng có ghim
// luôn-nằm-trên"). Một BrowserWindow thật nạp route SPA `/slack?window=1`, để người
// dùng kéo danh sách thread sang màn hình thứ hai và ghim nó nổi trên mọi cửa sổ
// khác trong lúc làm việc ở cửa sổ chính.
//
// CHỈ MỘT cửa sổ (singleton), khác session popout (mỗi phiên một cửa sổ): đây là một
// màn hình duyệt thread, không phải tài liệu — mở thêm một thread chỉ cần điều hướng
// cửa sổ đang có tới đó (event SLACK_NAVIGATE) thay vì chồng cửa sổ thứ hai.
//
// Bảo mật: threadId do renderer gửi (L1) và rơi vào URL query, nên kiểm regex TRƯỚC
// khi tạo cửa sổ. Nó không bao giờ thành đường dẫn ở main — renderer mới đọc thread
// qua sidecar, nơi tự kiểm lại tham số bằng zod. Cửa sổ có preload chuẩn +
// contextIsolation + sandbox + navigation guard chung (bất biến #4).

// Kênh renderer: điều hướng cửa sổ Slack đang mở tới một thread (payload threadId).
// Preload lặp lại literal này vì preload sandbox không import được module main.
export const SLACK_NAVIGATE = 'slack:navigate'

const WIDTH = 1100
const HEIGHT = 760

let win: BrowserWindow | null = null

// Cửa sổ Slack đang sống (hoặc null) — ipc.ts dùng để chuyển riêng event `slack.*`
// của engine sang đây. CHỈ event `slack.*`: renderer này cũng có store sessions, và
// nhận cả luồng `session.*` sẽ biến nó thành người lái phiên thứ hai (store coi mọi
// phiên không popout là của mình).
export function slackWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

export function openSlackWindow(threadId?: string): void {
  if (threadId !== undefined && !isValidThreadId(threadId)) {
    throw new Error(`invalid slack thread id: ${String(threadId)}`)
  }

  const existing = slackWindow()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    // Renderer đã chạy ⇒ đổi thread tại chỗ, giữ nguyên trạng thái (cuộn, bản nháp).
    // Gửi trong khoảnh khắc SPA còn đang boot thì có thể rơi mất (chưa ai subscribe) —
    // chấp nhận: người dùng chỉ phải bấm lại, không có gì hỏng.
    if (threadId) existing.webContents.send(SLACK_NAVIGATE, threadId)
    return
  }

  const created = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: 520,
    minHeight: 420,
    // Khung NATIVE như session popout (docs/features/native-macos-polish.md §4 W1):
    // cửa sổ phụ giữ thanh tiêu đề thật của OS, nên trang không cần vùng kéo
    // `-webkit-app-region`. Tiêu đề ban đầu tạm là "Slack"; sau đó trang làm chủ
    // tiêu đề qua `document.title` (useHead) — BrowserWindow tự theo `<title>` vì ta
    // không chặn `page-title-updated`.
    title: 'Slack',
    backgroundColor: WINDOW_BACKGROUND,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Như main window — tránh log NSSpellServer timeout của macOS.
      spellcheck: false,
    },
  })
  applyNavigationGuards(created)
  win = created
  created.on('closed', () => {
    if (win === created) win = null
  })

  const query = new URLSearchParams({ window: '1' })
  if (threadId) query.set('thread', threadId)
  loadAppRoute(created, `slack?${query.toString()}`)
  log.info('slack window opened', { threadId: threadId ?? null })
}
