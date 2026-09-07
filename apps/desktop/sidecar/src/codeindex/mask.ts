// Che (mask) chuỗi, chú thích và regex literal — bước tiền xử lý bắt buộc trước
// khi cho regex khai báo/tham chiếu chạy trên mã nguồn.
//
// Vì sao phải có: repo này chứa các prompt dài viết bằng template literal, bên
// trong có ví dụ mã ("call function foo(...)"). Nếu quét thẳng, mỗi ví dụ đó đẻ
// ra một khai báo ma. Che chuỗi trước là ranh giới đúng: mọi thứ còn lại CHẮC
// CHẮN là mã.
//
// Hợp đồng: chuỗi trả về có ĐỘ DÀI Y HỆT đầu vào và giữ nguyên mọi '\n', nên mọi
// offset khớp được đều quy ra đúng số dòng của file gốc. Phần bị che thay bằng
// dấu cách.
//
// Biểu thức trong template (`${...}`) KHÔNG bị che — nó là mã thật, và lời gọi
// hàm nằm trong đó là tham chiếu thật.

export interface MaskResult {
  masked: string
  // offset của dấu nháy MỞ → nội dung chuỗi (đã bỏ nháy). Chỉ giữ chuỗi một dòng
  // ngắn, vì thứ duy nhất cần đọc lại nguyên văn là module specifier.
  strings: Map<number, string>
}

// Specifier dài hơn thế này không tồn tại trong thực tế; chặn để Map không phình.
const MAX_RECORDED_STRING = 256

// Ký tự đứng ngay trước dấu '/' quyết định đó là regex hay phép chia. Danh sách
// này là heuristic cổ điển; thiệt hại khi đoán sai được chặn bằng cách CHỈ quét
// regex trong PHẠM VI MỘT DÒNG (xem scanRegex).
const REGEX_PREV_CHARS = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%',
  '~', '^', '<', '>', '\n',
])
const REGEX_PREV_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case',
  'do', 'else', 'yield', 'await', 'throw',
])

type Frame = { kind: 'code'; depth: number } | { kind: 'template'; segStart: number }

// Trả về true nếu dấu '/' ở vị trí i mở một regex literal (thay vì phép chia).
function isRegexStart(src: string, i: number): boolean {
  let j = i - 1
  while (j >= 0 && (src[j] === ' ' || src[j] === '\t')) j--
  if (j < 0) return true
  const ch = src[j]
  if (REGEX_PREV_CHARS.has(ch)) return true
  if (/[\w$)\]]/.test(ch)) {
    // Có thể là từ khoá (`return /re/`) chứ không phải định danh (`a / b`).
    let k = j
    while (k >= 0 && /[\w$]/.test(src[k])) k--
    return REGEX_PREV_WORDS.has(src.slice(k + 1, j + 1))
  }
  return true
}

// Quét regex literal bắt đầu tại i. Trả offset SAU dấu '/' đóng, hoặc -1 nếu
// không đóng trên cùng dòng — khi đó ta coi như đã đoán sai và để nguyên là phép
// chia. Giới hạn một dòng là hàng rào: đoán sai cũng không nuốt mất khối mã.
function scanRegex(src: string, i: number): number {
  let j = i + 1
  let inClass = false
  while (j < src.length) {
    const c = src[j]
    if (c === '\n') return -1
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) return j + 1
    j++
  }
  return -1
}

// Quét chuỗi nháy đơn/kép bắt đầu tại i. Trả offset SAU nháy đóng; chuỗi không
// đóng trên cùng dòng bị coi là hỏng và chỉ che tới cuối dòng (fail-soft: một
// file hỏng cú pháp không được làm hỏng cả phần sau).
function scanQuoted(src: string, i: number): number {
  const quote = src[i]
  let j = i + 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === '\n') return j
    if (c === quote) return j + 1
    j++
  }
  return src.length
}

function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ')
}

export function maskCode(src: string): MaskResult {
  const ranges: [number, number][] = []
  const strings = new Map<number, string>()
  const frames: Frame[] = [{ kind: 'code', depth: 0 }]
  const n = src.length
  let i = 0

  while (i < n) {
    const frame = frames[frames.length - 1]

    if (frame.kind === 'template') {
      const c = src[i]
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === '`') {
        ranges.push([frame.segStart, i])
        frames.pop()
        i++
        continue
      }
      if (c === '$' && src[i + 1] === '{') {
        ranges.push([frame.segStart, i])
        frames.push({ kind: 'code', depth: 0 })
        i += 2
        continue
      }
      i++
      continue
    }

    const c = src[i]
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      const end = nl === -1 ? n : nl
      ranges.push([i, end])
      i = end
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2)
      const end = close === -1 ? n : close + 2
      ranges.push([i, end])
      i = end
      continue
    }
    if (c === '"' || c === "'") {
      const end = scanQuoted(src, i)
      const value = src.slice(i + 1, Math.max(i + 1, end - 1))
      if (value.length <= MAX_RECORDED_STRING && !value.includes('\n')) {
        strings.set(i, value)
      }
      ranges.push([i + 1, Math.max(i + 1, end - 1)])
      i = end
      continue
    }
    if (c === '`') {
      frames.push({ kind: 'template', segStart: i + 1 })
      i++
      continue
    }
    if (c === '/' && isRegexStart(src, i)) {
      const end = scanRegex(src, i)
      if (end !== -1) {
        ranges.push([i + 1, end - 1])
        i = end
        continue
      }
    }
    if (c === '{') {
      frame.depth++
      i++
      continue
    }
    if (c === '}') {
      if (frame.depth === 0 && frames.length > 1) {
        frames.pop()
        const parent = frames[frames.length - 1]
        if (parent.kind === 'template') parent.segStart = i + 1
        i++
        continue
      }
      if (frame.depth > 0) frame.depth--
      i++
      continue
    }
    i++
  }

  // Template chưa đóng ở cuối file (cú pháp hỏng) — che nốt phần đuôi.
  const last = frames[frames.length - 1]
  if (last.kind === 'template' && last.segStart < n) ranges.push([last.segStart, n])

  let masked = ''
  let pos = 0
  for (const [start, end] of ranges) {
    if (start < pos) continue // phòng thủ: range chồng nhau thì bỏ cái sau
    masked += src.slice(pos, start)
    masked += blank(src.slice(start, end))
    pos = end
  }
  masked += src.slice(pos)
  return { masked, strings }
}

// Bảng offset đầu mỗi dòng, để quy offset → số dòng bằng tìm kiếm nhị phân.
export function lineStarts(src: string): number[] {
  const starts = [0]
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') starts.push(i + 1)
  }
  return starts
}

// 1-based. `starts` phải là kết quả của lineStarts trên CÙNG chuỗi.
export function lineAt(starts: number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}
