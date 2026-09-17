// Mô hình CỬA SỔ THỜI GIAN dùng chung cho cả khu `/infra` (Logs · Giám sát ·
// Dashboard). Thay cho enum preset cũ (`LogsWindowPreset`): một cửa sổ hoặc là
// TƯƠNG ĐỐI ("N giây gần đây") hoặc TUYỆT ĐỐI (từ mốc A đến mốc B). Nhờ vậy control
// kiểu AWS CloudWatch (lưới đơn vị + Duration/Unit + Absolute) biểu diễn được MỌI
// khoảng, không bị kẹt trong danh sách preset cố định.
//
// Thuần (không state, không Vue) để test được bằng bảng và dùng chung không vòng phụ.

export type InfraWindow =
  | { mode: 'relative'; seconds: number }
  | { mode: 'absolute'; startMs: number; endMs: number }

/** Mặc định toàn khu: 1 giờ gần đây. Từng màn có thể chọn mặc định riêng. */
export const DEFAULT_WINDOW_SECONDS = 3600

export function relativeWindow(seconds: number): InfraWindow {
  return { mode: 'relative', seconds }
}

export function absoluteWindow(startMs: number, endMs: number): InfraWindow {
  return { mode: 'absolute', startMs, endMs }
}

/** Số giây của cửa sổ (0 nếu absolute không hợp lệ) — cơ sở của period/bin/nhãn. */
export function windowSecondsOf(w: InfraWindow): number {
  if (w.mode === 'relative') return w.seconds > 0 ? w.seconds : 0
  const s = Math.round((w.endMs - w.startMs) / 1000)
  return s > 0 ? s : 0
}

/** Quy về hai mốc mili-giây tại thời điểm `now`. `null` = cửa sổ không hợp lệ. */
export function windowToMs(
  w: InfraWindow,
  now: number = Date.now(),
): { startMs: number; endMs: number } | null {
  if (w.mode === 'absolute') {
    if (!Number.isFinite(w.startMs) || !Number.isFinite(w.endMs) || w.endMs <= w.startMs)
      return null
    return { startMs: w.startMs, endMs: w.endMs }
  }
  if (!(w.seconds > 0)) return null
  return { startMs: now - w.seconds * 1000, endMs: now }
}

export function isWindowValid(w: InfraWindow): boolean {
  return windowToMs(w) !== null
}

/** Hai cửa sổ có cùng nghĩa không (dùng để sáng nút quick preset). */
export function windowEquals(a: InfraWindow, b: InfraWindow): boolean {
  if (a.mode === 'relative' && b.mode === 'relative') return a.seconds === b.seconds
  if (a.mode === 'absolute' && b.mode === 'absolute')
    return a.startMs === b.startMs && a.endMs === b.endMs
  return false
}

// ── datetime-local <-> ms (tab Absolute) ─────────────────────────────────────
// `<input type="datetime-local">` nhận/đưa chuỗi GIỜ ĐỊA PHƯƠNG `YYYY-MM-DDTHH:mm`.

/**
 * ms → chuỗi cho `datetime-local` (giờ địa phương, tới phút).
 *
 * `toISOString()` trả giờ UTC, nên phép dịch trước một khoảng bằng ĐÚNG offset tại
 * thời điểm `ms` là thứ khử lệch — bỏ phép dịch đi thì chuỗi lệch đúng bằng múi giờ
 * của người dùng. Lấy offset tại `ms` (không phải tại `Date.now()`) nên mốc nằm bên
 * kia một lần đổi giờ DST vẫn đúng.
 */
export function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

/** Chuỗi `datetime-local` → ms (NaN nếu rỗng/không hợp lệ — caller phải kiểm). */
export function parseLocalInput(value: string): number {
  return Date.parse(value)
}

// ── Đơn vị tương đối (dùng cho lưới + Duration/Unit của popover) ──────────────

export type RelativeUnit = 'minutes' | 'hours' | 'days' | 'weeks'

export const UNIT_SECONDS: Record<RelativeUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86_400,
  weeks: 7 * 86_400,
}

/** Các nút nhanh trong lưới của tab Relative (khớp AWS CloudWatch). */
export const RELATIVE_GRID: Record<RelativeUnit, readonly number[]> = {
  minutes: [5, 10, 15, 30, 45],
  hours: [1, 2, 3, 6, 8, 12],
  days: [1, 2, 3, 4, 5, 6],
  weeks: [1, 2, 3, 4],
}

/** `N` + đơn vị → cửa sổ tương đối. */
export function relativeFromUnit(amount: number, unit: RelativeUnit): InfraWindow {
  return relativeWindow(Math.max(1, Math.round(amount)) * UNIT_SECONDS[unit])
}
