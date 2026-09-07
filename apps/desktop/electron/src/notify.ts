import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain, Notification } from 'electron'
import { log } from './logger'

// Thông báo cấp HỆ ĐIỀU HÀNH phát từ TIẾN TRÌNH MAIN.
//
// VÌ SAO CẦN: mọi thông báo của AWOG tới nay đều do RENDERER bắn (Web Notification
// API của Chromium — `composables/useNativeNotify.ts`, `useGhNotifications.ts`).
// Đóng cửa sổ là renderer chết theo, trong khi engine vẫn chạy (macOS giữ app sống
// ở Dock/tray): lệnh nền xong, lượt xong, cổng xin quyền — không còn ai báo. Main
// sống suốt vòng đời app nên đây là kênh DUY NHẤT còn lại trong trạng thái đó.
//
// PHẠM VI CÓ CHỦ Ý: main chỉ báo khi KHÔNG cửa sổ nào nhận được sự kiện (xem
// `wake.ts`). Cửa sổ còn mở thì renderer báo như cũ — hai đường tách rời hẳn, không
// có chuyện một sự kiện sinh hai thông báo.
//
// KHÔNG PHẢI WEB PUSH: không có push service, không VAPID, không endpoint ngoài.
// Đây là API notification của OS trên chính máy này (xem ADR 0084).

// Công tắc của kênh này. Main không đọc được `stores/settings.ts` (localStorage của
// renderer) nên nó tự giữ pref của mình, cạnh state main-process khác (userData) —
// KHÔNG chen vào `~/.awog`, vốn là nhà dữ liệu của sidecar.
export interface NotifyPrefs {
  // Báo khi cửa sổ UI đã đóng (mặc định BẬT: lúc đó đây là kênh duy nhất).
  whenClosed: boolean
}

const DEFAULT_PREFS: NotifyPrefs = { whenClosed: true }
const PREFS_FILE = 'notifications.json'
// Thân thông báo dài quá thì OS tự cắt xấu — cắt sẵn ở đây cho gọn.
const BODY_MAX = 140

let cached: NotifyPrefs | null = null

function prefsPath(): string {
  return join(app.getPath('userData'), PREFS_FILE)
}

export function getNotifyPrefs(): NotifyPrefs {
  if (cached) return cached
  try {
    const raw: unknown = JSON.parse(readFileSync(prefsPath(), 'utf8'))
    const whenClosed = (raw as { whenClosed?: unknown } | null)?.whenClosed
    cached = { whenClosed: typeof whenClosed === 'boolean' ? whenClosed : DEFAULT_PREFS.whenClosed }
  } catch {
    // Chưa có file / file hỏng → mặc định. Không phải lỗi đáng kêu.
    cached = { ...DEFAULT_PREFS }
  }
  return cached
}

// Payload tới từ renderer (L1 — không tin): pick tường minh từng field thay vì
// spread cả object (chống mass-assignment).
export function setNotifyPrefs(next: unknown): NotifyPrefs {
  const whenClosed = (next as { whenClosed?: unknown } | null)?.whenClosed
  const merged: NotifyPrefs = {
    whenClosed: typeof whenClosed === 'boolean' ? whenClosed : getNotifyPrefs().whenClosed,
  }
  cached = merged
  try {
    writeFileSync(prefsPath(), JSON.stringify(merged, null, 2))
  } catch (err) {
    log.warn('notify: could not persist prefs', {
      message: err instanceof Error ? err.message : String(err),
    })
  }
  return merged
}

// Chuỗi hiển thị. Main không có runtime i18n của Nuxt và chỉ cần 5 câu, nên giữ
// bảng nhỏ tại chỗ; ngôn ngữ lấy từ locale của OS (`app.getLocale()`) — pref ngôn
// ngữ trong app nằm ở renderer, main không đọc được.
interface NotifyStrings {
  bgDone: string
  bgFailed: string
  permission: string
  turnDone: string
  turnError: string
}

const STRINGS: Record<'en' | 'vi', NotifyStrings> = {
  en: {
    bgDone: 'Background command finished',
    bgFailed: 'Background command failed',
    permission: 'AWOG needs your permission',
    turnDone: 'Session turn finished',
    turnError: 'Session turn failed',
  },
  vi: {
    bgDone: 'Lệnh nền đã xong',
    bgFailed: 'Lệnh nền thất bại',
    permission: 'AWOG cần bạn cho phép',
    turnDone: 'Lượt trong phiên đã xong',
    turnError: 'Lượt trong phiên bị lỗi',
  },
}

export function notifyStrings(): NotifyStrings {
  return app.getLocale().toLowerCase().startsWith('vi') ? STRINGS.vi : STRINGS.en
}

// Settings → Thông báo đọc/ghi công tắc này (Settings của renderer không nắm được
// pref của main, xem ghi chú ở NotifyPrefs).
export function registerNotifyIpc(): void {
  ipcMain.handle('notify:getPrefs', () => getNotifyPrefs())
  ipcMain.handle('notify:setPrefs', (_e, next: unknown) => setNotifyPrefs(next))
}

export interface OsNotifyInput {
  title: string
  body: string
  // Bấm vào thông báo — nơi gọi tự lo việc đưa app lên và điều hướng.
  onClick?: () => void
}

// Giữ tham chiếu tới notification đang hiện: Electron cảnh báo object bị GC thì
// callback click không bao giờ chạy. Bỏ ra khi nó đóng.
const live = new Set<Notification>()

// Thân thông báo là văn bản thuần của OS (không phải HTML) nên không có sink để
// inject; vẫn ép về MỘT dòng + cắt độ dài để không đổ cả log/trả lời của model ra
// màn hình khoá.
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > BODY_MAX ? `${flat.slice(0, BODY_MAX - 1)}…` : flat
}

// Bắn một thông báo OS. Cổng bật/tắt nằm NGAY TẠI ĐÂY (không phải ở nơi gọi) để
// không thể lỡ tay bỏ qua công tắc của người dùng.
export function notifyOs({ title, body, onClick }: OsNotifyInput): void {
  if (!getNotifyPrefs().whenClosed) return
  if (!Notification.isSupported()) return
  try {
    const n = new Notification({ title, body: oneLine(body) })
    live.add(n)
    n.on('close', () => live.delete(n))
    if (onClick) {
      n.on('click', () => {
        live.delete(n)
        onClick()
      })
    }
    n.show()
  } catch (err) {
    // Notification có thể ném khi OS chặn/thiếu quyền — không để nó hạ main.
    log.warn('notify: show failed', {
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
