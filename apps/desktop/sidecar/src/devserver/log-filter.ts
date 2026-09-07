// Lọc log dev server. ĐÂY là lý do chính tính năng này tồn tại: `BashOutput` trả
// về cả đống (64KB đuôi log, mỗi request HTTP một dòng), nên model phải nuốt hàng
// nghìn dòng vô nghĩa để tìm một stack trace — tốn token, và thường trượt.
//
// Ba phép lọc, cộng dồn theo thứ tự: mức (level) → chuỗi con (contains) → N dòng
// cuối. Cố ý KHÔNG nhận regex từ model: một regex chạy trên 64KB log mỗi lần gọi
// là bề mặt catastrophic-backtracking không cần thiết (cùng lập luận với `monitor`).

// Đuôi log mặc định/tối đa tính theo DÒNG.
export const DEFAULT_LINES = 80
export const MAX_LINES = 400
// Trần ký tự cuối cùng: một dòng log có thể dài vài chục KB (JSON dump), nên trần
// theo dòng thôi chưa đủ để giữ context nhỏ.
const MAX_CHARS = 16_000
const MAX_NEEDLE_LEN = 200

export type LogLevelFilter = 'all' | 'warn' | 'error'

// Dấu hiệu dòng lỗi/cảnh báo. Cố tình rộng vừa phải: bắt được cách các runner phổ
// biến in ra (`ERR!` của npm, `ELIFECYCLE`, `error TS2345`, `UnhandledPromise…`)
// mà không nuốt mọi dòng có chữ "error" trong một URL.
const ERROR_RE =
  /(^|[^a-z])(error|errors|err!|fatal|failed|failure|exception|panic|traceback|unhandled|econnrefused|eaddrinuse|elifecycle)([^a-z]|$)/i
const WARN_RE = /(^|[^a-z])(warn|warning|deprecated)([^a-z]|$)/i

// Escape ANSI: log dev server đầy màu + spinner. Cùng bài toán với
// read-terminal-tool.ts nhưng nhẹ hơn (không có \r-overwrite của PTY ở đây vì log
// là file, tuy vậy vẫn gộp \r cho mấy thanh tiến trình ghi đè).
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const CSI_RE = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g
const ESC_2CHAR_RE = /\x1b[\x40-\x5f]/g
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

export function stripAnsi(raw: string): string {
  return raw
    .replace(OSC_RE, '')
    .replace(CSI_RE, '')
    .replace(ESC_2CHAR_RE, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const last = line.lastIndexOf('\r')
      return (last >= 0 ? line.slice(last + 1) : line).replace(CTRL_RE, '')
    })
    .join('\n')
}

export interface LogFilterOptions {
  lines?: number | undefined
  contains?: string | undefined
  level?: LogLevelFilter | undefined
}

export interface LogFilterResult {
  text: string
  // Số dòng khớp bộ lọc (trước khi cắt đuôi) và tổng số dòng đã quét — người gọi
  // nói được "3/1240 dòng khớp" thay vì để model đoán log có bao nhiêu.
  matched: number
  total: number
  // Có bộ lọc nào thực sự được áp không (để lời văn trả về không nói dối).
  filtered: boolean
  // Đã phải cắt bớt vì vượt trần dòng/ký tự.
  clipped: boolean
}

function clampLines(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LINES
  return Math.min(MAX_LINES, Math.max(1, Math.floor(value)))
}

export function filterLog(raw: string, opts: LogFilterOptions = {}): LogFilterResult {
  const lines = clampLines(opts.lines)
  const level = opts.level ?? 'all'
  const needle = (opts.contains ?? '').trim().slice(0, MAX_NEEDLE_LEN).toLowerCase()
  const all = stripAnsi(raw).split('\n')
  // Dòng trắng cuối file không phải nội dung; bỏ để đếm không nói dối.
  while (all.length > 0 && all[all.length - 1]!.trim() === '') all.pop()

  const kept = all.filter((line) => {
    if (level === 'error' && !ERROR_RE.test(line)) return false
    if (level === 'warn' && !ERROR_RE.test(line) && !WARN_RE.test(line)) return false
    if (needle.length > 0 && !line.toLowerCase().includes(needle)) return false
    return true
  })

  const tail = kept.slice(-lines)
  let text = tail.join('\n')
  let clipped = tail.length < kept.length
  if (text.length > MAX_CHARS) {
    text = text.slice(-MAX_CHARS)
    clipped = true
  }
  return {
    text,
    matched: kept.length,
    total: all.length,
    filtered: level !== 'all' || needle.length > 0,
    clipped,
  }
}
