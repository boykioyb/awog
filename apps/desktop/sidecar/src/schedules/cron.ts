// Tính mốc chạy kế tiếp cho một biểu thức lịch (ADR 0082). Thuần tuý, không I/O,
// không phụ thuộc — nên test được trực tiếp.
//
// GIỜ ĐỊA PHƯƠNG là hệ quy chiếu: người dùng đặt "8:30 sáng" thì phải là 8:30
// sáng theo đồng hồ của họ, kể cả sau khi đổi giờ mùa. Vì vậy `daily`/`weekly`
// KHÔNG cộng 86_400_000 ms mà dựng lại Date từ (năm, tháng, ngày+n, giờ, phút):
// constructor local-time của JS tự giải quyết DST theo đúng luật của máy.
//
//   • Nhảy tiến (2:00 → 3:00): mốc 2:30 không tồn tại; `new Date(y,m,d,2,30)`
//     trả 3:30 — chạy trễ 1 tiếng thay vì mất luôn một ngày.
//   • Lùi lại (2:30 xảy ra hai lần): constructor chọn lần ĐẦU, và vì kết quả
//     luôn phải > `fromMs` nên lần thứ hai bị bỏ qua ⇒ không chạy đúp.
//
// `interval` thì ngược lại: "mỗi 30 phút" là 30 phút đồng hồ vật lý, nên nó là
// phép cộng ms thuần — miễn nhiễm DST theo đúng nghĩa của nó.

import type { ScheduleTrigger } from './schema.js'

const MS_PER_MINUTE = 60_000

// Quét tối đa 14 ngày: `daily` cần ≤ 2, `weekly` cần ≤ 8. Trần này biến một
// trigger hỏng thành `null` thay vì vòng lặp vô hạn.
const MAX_DAY_SCAN = 14

export type TimeOfDay = { hours: number; minutes: number }

// Tách "HH:MM". Trả null khi sai dạng (schema đã chặn, đây là lớp phòng thủ thứ
// hai cho file bị sửa tay).
export function parseTimeOfDay(time: string): TimeOfDay | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!m || m[1] === undefined || m[2] === undefined) return null
  return { hours: Number(m[1]), minutes: Number(m[2]) }
}

// Mốc epoch của (ngày của `base` + `dayOffset`) lúc HH:MM giờ địa phương.
// Constructor Date nhận số ngày tràn (32/2/…) và tự chuẩn hoá sang tháng sau.
function localDayAt(base: Date, dayOffset: number, time: TimeOfDay): number {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + dayOffset,
    time.hours,
    time.minutes,
    0,
    0,
  ).getTime()
}

// Mốc chạy kế tiếp, LUÔN LUÔN > `fromMs` (không bao giờ trả lại chính mốc vừa
// chạy — đó là cái chặn "chạy hai lần trong một giờ lặp của DST"). `null` khi
// trigger không hợp lệ.
export function computeNextRun(trigger: ScheduleTrigger, fromMs: number): number | null {
  if (!Number.isFinite(fromMs)) return null

  if (trigger.kind === 'interval') {
    if (trigger.everyMinutes < 1) return null
    return fromMs + trigger.everyMinutes * MS_PER_MINUTE
  }

  const time = parseTimeOfDay(trigger.time)
  if (!time) return null
  const weekdays = trigger.kind === 'weekly' ? new Set(trigger.weekdays) : null
  if (weekdays && weekdays.size === 0) return null

  const base = new Date(fromMs)
  for (let offset = 0; offset <= MAX_DAY_SCAN; offset += 1) {
    const ts = localDayAt(base, offset, time)
    if (ts <= fromMs) continue
    // Kiểm thứ trên NGÀY KẾT QUẢ, không phải ngày ứng viên: sau khi DST chuẩn
    // hoá, mốc có thể rơi sang ngày khác.
    if (weekdays && !weekdays.has(new Date(ts).getDay())) continue
    return ts
  }
  return null
}

// Mốc chạy đầu tiên của một lịch vừa tạo/vừa sửa. Cùng công thức, chỉ khác cách
// gọi tên để chỗ dùng đọc ra ý.
export function firstRunAfter(trigger: ScheduleTrigger, fromMs: number): number | null {
  return computeNextRun(trigger, fromMs)
}

// Trễ hơn ngưỡng này thì lần chạy được đánh dấu là "chạy bù" (máy vừa ngủ dậy
// hoặc app vừa mở lại). Rộng hơn một nhịp tick để nhịp trễ bình thường không bị
// gắn nhãn oan.
export const CATCH_UP_THRESHOLD_MS = 5 * 60_000

// Đã tới hạn chưa. Không có `nextRunAt` ⇒ chưa bao giờ tới hạn (lịch phải được
// tính mốc trước, ở upsert).
export function isDue(nextRunAtMs: number | null, nowMs: number): boolean {
  return nextRunAtMs !== null && nowMs >= nextRunAtMs
}

// Chính sách chạy bù: bỏ lỡ bao nhiêu nhịp cũng chỉ chạy ĐÚNG MỘT LẦN, rồi neo
// lại mốc kế tiếp từ THỜI ĐIỂM HIỆN TẠI (không phải từ mốc đã lỡ) — nếu neo từ
// mốc lỡ thì một đêm ngủ máy sẽ dồn thành N lần chạy liên tiếp.
export function reanchorAfterRun(trigger: ScheduleTrigger, nowMs: number): number | null {
  return computeNextRun(trigger, nowMs)
}
