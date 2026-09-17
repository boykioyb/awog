// Đọc MỘT dòng log thô thành hai thứ lọc được: nó xảy ra LÚC NÀO và nó nặng tới
// đâu. Hàm thuần, không Vue — phần tính toán của bộ lọc nâng cao trong khung log
// pod (`InfraKubeOutPane.vue`).
//
// VÌ SAO LỌC Ở NHÀ chứ không nhờ kubectl: `kubectl logs` KHÔNG có cờ lọc nội dung.
// Nó chỉ cắt được theo số dòng (`--tail`) và theo thời gian (`--since`) — không có
// `--level`, không có grep. Mọi thứ tinh hơn thế phải làm trên chữ đã tải về, và
// đây là chỗ làm việc đó.
//
// ⚠ LUẬT QUAN TRỌNG NHẤT CỦA FILE: DÒNG NỐI THỪA KẾ DÒNG TRÊN. Một stack trace là
// một dòng có mức + mười dòng thụt lề KHÔNG có mức và KHÔNG có timestamp. Lọc theo
// mức mà bỏ mười dòng kia thì người dùng bấm "chỉ hiện Lỗi" và nhận về đúng một
// dòng `[ERROR] Unhandled exception:` — phần nói lỗi ở đâu biến mất. Vì vậy dòng
// không tự khai gì sẽ mang mức và mốc thời gian của dòng có khai gần nhất phía trên.

import { logLevelOf } from '~/utils/log-errors'

/** Năm nhóm để lọc. Gộp về năm vì người đọc bấm theo NHÓM, không theo tên mức:
 *  `FATAL`/`CRITICAL`/`SEVERE`/`ERR` cùng là một cú bấm. */
export type LogSeverity = 'error' | 'warn' | 'info' | 'debug' | 'other'

export const LOG_SEVERITIES: readonly LogSeverity[] = ['error', 'warn', 'info', 'debug', 'other']

const ERROR_LEVELS = new Set([
  'ERROR',
  'ERR',
  'FATAL',
  'CRITICAL',
  'CRIT',
  'SEVERE',
  'EMERG',
  'ALERT',
  'PANIC',
])
const WARN_LEVELS = new Set(['WARN', 'WARNING'])
const INFO_LEVELS = new Set(['INFO', 'INFORMATION', 'NOTICE', 'LOG'])
const DEBUG_LEVELS = new Set(['DEBUG', 'TRACE', 'VERBOSE', 'FINE', 'FINER', 'FINEST'])

/** Mốc thời gian ở ĐẦU dòng. Ba hình dạng phủ gần hết log thật:
 *  `2026-09-17T16:46:01.123Z` (ISO/RFC3339, cũng là thứ `kubectl --timestamps` in),
 *  `2026-09-17 16:46:01` (đa số logger của Python/Java),
 *  `2026/09/17 16:46:01` (nginx, Go). */
const TIME_RE =
  /^\s*(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?\s*(Z|[+-]\d{2}:?\d{2})?/

/** Mức log viết trong ngoặc vuông hoặc đứng riêng SAU mốc thời gian: `[INFO]`,
 *  `INFO`, `level=error`, `"severity":"WARNING"`. */
const BRACKET_LEVEL_RE = /^\[([A-Za-z]{3,9})\]/
const BARE_LEVEL_RE = /^([A-Za-z]{3,9})\b/
const KV_LEVEL_RE = /\b(?:level|severity|lvl|loglevel)\s*[=:]\s*"?([A-Za-z]{3,9})"?/i

/** Một dòng đã đọc xong. `own` = dòng TỰ khai (không phải thừa kế dòng trên) —
 *  chỉ dòng tự khai mới được tính vào bảng đếm, nếu không một stack trace 40 dòng
 *  sẽ hiện ra thành "40 lỗi". */
export type LogLine = {
  i: number
  text: string
  sev: LogSeverity
  ms: number | null
  own: boolean
}

/** Khoá mang mốc thời gian trong một dòng log JSON. `@timestamp` là của họ Elastic. */
const TIME_KEYS = ['ts', 'time', 'timestamp', '@timestamp', 'eventTime'] as const

/** Epoch ms của mốc thời gian dòng, `null` khi dòng không có mốc nào.
 *
 *  Hai đường: mốc đứng ĐẦU dòng (log chữ), và trường thời gian trong dòng JSON —
 *  dòng JSON bắt đầu bằng `{` nên đường thứ nhất không bao giờ khớp, và nếu chỉ có
 *  đường thứ nhất thì toàn bộ log JSON không lọc được theo thời gian. */
export function parseLogTime(line: string): number | null {
  const trimmed = line.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') {
        const bag = parsed as Record<string, unknown>
        for (const key of TIME_KEYS) {
          const value = bag[key]
          if (typeof value === 'string') {
            const ms = Date.parse(value)
            if (Number.isFinite(ms)) return ms
          }
          // Epoch dạng số: giây (10 chữ số) hay mili-giây (13) — phân biệt bằng độ
          // lớn, vì cả hai đều là `number` và đoán sai lệch đi 50 năm.
          if (typeof value === 'number' && Number.isFinite(value)) {
            return value > 1e11 ? value : value * 1000
          }
        }
      }
    } catch {
      // JSON hỏng (dòng bị cắt) ⇒ rơi xuống đường mốc-đầu-dòng bên dưới.
    }
  }
  const m = TIME_RE.exec(line)
  if (!m) return null
  const [, y, mo, d, hh, mm, ss, frac, zone] = m
  const ms = frac ? Number(`0.${frac}`) * 1000 : 0
  // Không có vùng giờ trong dòng ⇒ đọc theo giờ MÁY người dùng. Đó là cách họ đọc
  // con số đó bằng mắt, nên bộ lọc phải khớp với cái họ nhìn thấy.
  if (!zone) {
    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(hh),
      Number(mm),
      Number(ss),
      Math.round(ms),
    ).getTime()
  }
  const iso = `${y}-${mo}-${d}T${hh}:${mm}:${ss}${frac ? `.${frac.slice(0, 3)}` : ''}${
    zone === 'Z' ? 'Z' : zone.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')
  }`
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Mức log của một dòng, hoặc `null` khi dòng không tự khai.
 *
 * Thứ tự dò có ý nghĩa: cắt mốc thời gian TRƯỚC, vì `logLevelOf()` (dùng chung với
 * màn Giám sát) chỉ nhìn đầu chuỗi — với `2026-09-17T16:46:01 [INFO] …` nó thấy một
 * chuỗi bắt đầu bằng chữ số và trả `null`, tức mọi dòng của log kiểu này sẽ rơi hết
 * vào nhóm "khác".
 */
export function logLevelIn(line: string): string | null {
  const rest = line.replace(TIME_RE, '').trim()
  const bracket = BRACKET_LEVEL_RE.exec(rest)
  if (bracket?.[1]) return bracket[1].toUpperCase()
  // JSON và `INFO:` / `WARN -` do hàm dùng chung lo (nó cũng đọc được `level` trong
  // JSON, thứ regex bên dưới không làm được).
  const shared = logLevelOf(rest)
  if (shared) return shared
  const kv = KV_LEVEL_RE.exec(rest)
  if (kv?.[1]) return kv[1].toUpperCase()
  // `INFO 2026-…` hoặc `ERROR something` — mức đứng trần ở đầu phần còn lại. Chỉ
  // nhận khi nó THẬT SỰ là một mức đã biết: không có ràng buộc đó thì
  // `Traceback (most recent call last)` được đọc thành mức `Traceback`.
  const bare = BARE_LEVEL_RE.exec(rest)
  const word = bare?.[1]?.toUpperCase()
  if (word && severityOfLevel(word) !== 'other') return word
  return null
}

/** Mức (chữ) → nhóm (để bấm). Mức lạ → `other`, KHÔNG phải `error`: đoán bừa theo
 *  hướng "lỗi" làm dải cảnh báo kêu vì những dòng bình thường. */
export function severityOfLevel(level: string): LogSeverity {
  const up = level.toUpperCase()
  if (ERROR_LEVELS.has(up)) return 'error'
  if (WARN_LEVELS.has(up)) return 'warn'
  if (INFO_LEVELS.has(up)) return 'info'
  if (DEBUG_LEVELS.has(up)) return 'debug'
  return 'other'
}

/**
 * Cả khối log → từng dòng đã gắn mức + mốc thời gian, dòng nối thừa kế dòng trên
 * (xem ghi chú đầu file — đây là chỗ luật đó được thi hành).
 */
export function annotateLogLines(lines: readonly string[]): LogLine[] {
  const out: LogLine[] = []
  let lastSev: LogSeverity = 'other'
  let lastMs: number | null = null
  lines.forEach((text, i) => {
    const level = logLevelIn(text)
    const ms = parseLogTime(text)
    const own = level !== null
    if (own) lastSev = severityOfLevel(level)
    if (ms !== null) lastMs = ms
    out.push({ i, text, sev: own ? severityOfLevel(level) : lastSev, ms: ms ?? lastMs, own })
  })
  return out
}

/** Bảng đếm theo nhóm. CHỈ đếm dòng tự khai mức: một stack trace 40 dòng là MỘT
 *  lỗi, không phải 40. */
export function severityCounts(lines: readonly LogLine[]): Record<LogSeverity, number> {
  const out: Record<LogSeverity, number> = { error: 0, warn: 0, info: 0, debug: 0, other: 0 }
  for (const line of lines) if (line.own) out[line.sev] += 1
  return out
}

/** Mốc mới nhất đọc được trong khối — gốc của các khoảng "N phút cuối".
 *
 *  Vì sao neo vào DÒNG CUỐI chứ không vào đồng hồ máy: log có thể đã cũ (pod dừng
 *  từ hôm qua, hoặc `--since` lấy một khoảng đã qua). Neo vào `Date.now()` thì
 *  "5 phút cuối" trả về rỗng và trông y như một bộ lọc hỏng. */
export function newestStamp(lines: readonly LogLine[]): number | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const ms = lines[i]?.ms
    if (ms !== null && ms !== undefined) return ms
  }
  return null
}

/**
 * `16:46` / `16:46:01` → epoch ms, đặt vào NGÀY của `anchor`.
 *
 * Người dùng gõ giờ chứ không gõ ngày: khung log của một pod gần như luôn nằm gọn
 * trong một ngày, và bắt gõ `2026-09-17T16:46` cho một bộ lọc tạm là quá nhiều.
 */
export function timeOfDayMs(value: string, anchor: number): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  const ss = Number(m[3] ?? '0')
  if (hh > 23 || mm > 59 || ss > 59) return null
  const d = new Date(anchor)
  d.setHours(hh, mm, ss, 0)
  return d.getTime()
}
