// Hàm thuần định dạng cho UI lịch chạy (ADR 0082). Không state, không store —
// nhận `t` / `locale` từ chỗ gọi, nên cả trang lẫn pane chi tiết dùng chung một
// cách diễn đạt (đọc lịch ở hai chỗ mà ra hai câu khác nhau là lỗi).
//
// Sống trong components/schedule/ và được import tường minh: nó là helper của
// đúng một feature, không phải composable dùng chung toàn app.
import type { Schedule, ScheduleTrigger } from '~/stores/schedules'

type Translate = (key: string, params?: Record<string, string | number>) => string

// Thứ tự hiển thị bắt đầu từ thứ Hai (thói quen VN/EU), dù mã số vẫn theo
// Date.getDay() với 0 = Chủ nhật.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

// Câu mô tả biểu thức lịch: "Mỗi 30 phút", "Hằng ngày lúc 09:00", "T2, T4 lúc 18:00".
export function describeTrigger(trigger: ScheduleTrigger, t: Translate): string {
  if (trigger.kind === 'interval') {
    const m = trigger.everyMinutes
    return m % 60 === 0 && m >= 60
      ? t('schedules.desc.interval.hours', { n: m / 60 })
      : t('schedules.desc.interval.minutes', { n: m })
  }
  if (trigger.kind === 'daily') return t('schedules.desc.daily', { time: trigger.time })
  const days = WEEKDAY_ORDER.filter((d) => trigger.weekdays.includes(d))
    .map((d) => t(`schedules.day.${d}`))
    .join(', ')
  return t('schedules.desc.weekly', { days, time: trigger.time })
}

// Mốc thời gian ở dạng người đọc được, theo múi giờ + locale của máy. Chuỗi ISO
// hỏng thì trả về nguyên bản thay vì "Invalid Date".
export function formatWhen(iso: string, locale: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  return new Date(ms).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Text mà ô tìm kiếm của LibraryView quét.
export function searchTextOf(s: Schedule): string {
  const job =
    s.job.kind === 'session-prompt'
      ? `${s.job.prompt} ${s.job.title ?? ''}`
      : `${s.job.title} ${s.job.workflowId}`
  return `${s.name} ${s.id} ${job}`
}
