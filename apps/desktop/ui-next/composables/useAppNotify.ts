// MỘT đường gửi thông báo cho cả app: toast trong app + thông báo hệ điều hành,
// theo đúng `Settings → Thông báo → Kênh gửi`.
//
// Vì sao tách ra: logic này đã được chép nguyên văn ở `useGhNotifications` và
// `useCicdNotify`, và cảnh báo tài nguyên là nơi thứ BA — đúng ngưỡng
// Rule of Three của repo (.claude/rules/principles.md). Nó không phải đoạn code
// tầm thường: có ba nhánh `delivery`, một cổng focus, và một luật dự phòng tinh
// tế (xem `presentNotification`) mà chép tay lần thứ ba là chắc chắn lệch.
//
// SoC: module này chỉ biết CÁCH hiện. Cái gì sinh ra thông báo là việc của bên gọi.
import { useSettingsStore } from '~/stores/settings'
import { useToast, type ToastColor } from '~/composables/useToast'

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

// Xin quyền MỘT lần, theo yêu cầu — không bao giờ lúc khởi động app: một hộp xin
// quyền chưa ai hỏi ngay khi mở app là hành vi thù địch.
export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

// Đường hệ điều hành có thật sự gửi được lúc này không? Tách riêng vì
// `presentNotification` cần câu trả lời để biết bỏ toast đi có làm thông báo biến
// mất hoàn toàn hay không.
export function osDeliverable(): boolean {
  return notificationsSupported() && Notification.permission === 'granted'
}

export interface AppNotification {
  /** Dòng chính — tiêu đề toast và tiêu đề thông báo hệ điều hành. */
  text: string
  /** Dòng phụ, chỉ dùng cho thông báo hệ điều hành. */
  body?: string
  /**
   * Tiêu đề RIÊNG cho thông báo hệ điều hành. Có thì `text` tụt xuống làm dòng nội
   * dung. Tồn tại vì hộp thư GitHub đặt TÊN REPO làm tiêu đề còn văn bản toast làm
   * nội dung — bỏ đi là đổi hành vi của một tính năng đã ship.
   */
  nativeTitle?: string
  /** Khoá gộp của hệ điều hành: cùng tag thì bản mới thay bản cũ thay vì xếp chồng. */
  tag: string
  color?: ToastColor
  icon?: string
  onClick?: () => void
}

/**
 * Thông báo hệ điều hành. `delivery` quyết định KHI NÀO: 'native' bắn luôn (toast
 * đã bị bỏ nên phải có gì đó hiện ra), 'both' giữ luật gốc — chỉ khi cửa sổ không
 * ở trước mặt, chỗ mà một mình toast là vô hình. KHÔNG xin quyền ở đây; chỗ xin
 * là Settings.
 */
function nativeNotify(n: AppNotification): void {
  const delivery = useSettingsStore().notifications.delivery
  if (delivery === 'toast') return
  if (delivery === 'both' && !document.hidden && document.hasFocus()) return
  if (!osDeliverable()) return
  try {
    const title = n.nativeTitle ?? n.text
    const body = n.body ?? (n.nativeTitle ? n.text : undefined)
    const note = new Notification(title, {
      ...(body ? { body } : {}),
      tag: n.tag,
    })
    note.onclick = () => {
      try {
        window.focus()
      } catch {
        /* hệ điều hành có thể từ chối; đường mở bên dưới vẫn chạy */
      }
      n.onClick?.()
    }
  } catch {
    // Webview khoá cứng có thể ném khi dựng Notification.
  }
}

/**
 * Đường hiện DUY NHẤT. `delivery === 'native'` nghĩa là người dùng muốn thông báo
 * hệ điều hành THAY CHO toast — nhưng chỉ khi hệ điều hành thật sự gửi được: nếu
 * quyền chưa từng được cấp (hoặc webview không có Notification API) mà vẫn bỏ
 * toast thì thông báo rơi mất hoàn toàn, và đó đúng là cách tính năng này từng
 * trông như hỏng.
 */
export function presentNotification(n: AppNotification): void {
  const nativeOnly = useSettingsStore().notifications.delivery === 'native' && osDeliverable()
  if (!nativeOnly) {
    useToast().add({
      title: n.text,
      color: n.color ?? 'info',
      ...(n.icon ? { icon: n.icon } : {}),
      ...(n.onClick ? { onClick: n.onClick } : {}),
    })
  }
  nativeNotify(n)
}
