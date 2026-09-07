// Rút text từ PDF THEO KHOẢNG TRANG — không phụ thuộc thư viện ngoài.
//
// Vì sao tự viết: đính kèm một PDF hiện gửi nguyên file cho model (nhánh Claude
// SDK) hoặc chỉ còn một dòng tham chiếu (nhánh Pi). Cả hai đều không cho phép
// "đọc trang 40–50": một PDF 300 trang hoặc đốt sạch cửa sổ ngữ cảnh, hoặc
// không đọc được gì. Thêm dependency PDF cần ADR, nên module này làm phần tối
// thiểu: đủ để lấy lớp text của một khoảng trang, và nói thẳng khi không lấy
// được thay vì trả rác.
//
// Phạm vi có ý thức:
//   - Stream FlateDecode + stream không nén. Filter ảnh/LZW/ASCII85 → bỏ qua.
//   - Object stream (PDF ≥ 1.5) được giải nén để tìm được page object.
//   - Font có `ToUnicode` được giải mã đúng; font Identity-H KHÔNG có ToUnicode
//     trả về mã glyph vô nghĩa nên bị lọc bỏ và báo là không có lớp text.
//   - PDF scan (chỉ ảnh) không có text để lấy — trả về ghi chú, không OCR.
// Không dùng cho render, không dùng để trích form/annotation.
import { inflateRawSync, inflateSync } from 'node:zlib'

// Trần kích thước file đem parse. Trên mức này việc nạp cả buffer vào heap để
// quét object là không đáng.
export const PDF_MAX_BYTES = 32 * 1024 * 1024
// Trần số object quét — chặn file dị dạng bắt vòng lặp chạy mãi.
const MAX_OBJECTS = 60_000
// Trần ký tự mỗi trang trả về.
const MAX_PAGE_CHARS = 40_000
// Trần độ sâu cây trang.
const MAX_TREE_DEPTH = 64

export interface PdfPageText {
  // Số trang 1-based.
  page: number
  text: string
}

export interface PdfTextResult {
  totalPages: number
  pages: PdfPageText[]
  // Khác null khi không rút được chữ nào — lý do để nói lại cho model.
  note: string | null
}

interface PdfObject {
  // Phần dictionary (trước từ khoá `stream`) dạng latin1.
  dict: string
  // Vị trí byte của dữ liệu stream trong buffer gốc; -1 khi object không có stream.
  dataStart: number
  dataEnd: number
  // Object nằm trong ObjStm đã giải nén → nội dung đầy đủ nằm ở `dict`.
  inline: boolean
}

// ─── Đọc token trong dictionary ────────────────────────────────────────────
// PDF dict là chuỗi lồng nhau, không phải JSON — cần một scanner nhỏ thay vì
// regex, nếu không `/Font << /F1 << … >> >>` sẽ cắt sai chỗ.

const DELIMS = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%'])

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\0'
}

// Đọc một token bắt đầu tại `i`. Trả về [token, vị trí kế tiếp].
function readToken(s: string, i: number): [string, number] {
  let p = i
  while (p < s.length && isWhitespace(s[p] as string)) p += 1
  if (p >= s.length) return ['', p]
  const ch = s[p] as string

  if (ch === '<' && s[p + 1] === '<') {
    let depth = 0
    let q = p
    while (q < s.length) {
      if (s[q] === '<' && s[q + 1] === '<') {
        depth += 1
        q += 2
        continue
      }
      if (s[q] === '>' && s[q + 1] === '>') {
        depth -= 1
        q += 2
        if (depth === 0) return [s.slice(p, q), q]
        continue
      }
      q += 1
    }
    return [s.slice(p), s.length]
  }

  if (ch === '[') {
    let depth = 0
    let q = p
    while (q < s.length) {
      if (s[q] === '[') depth += 1
      else if (s[q] === ']') {
        depth -= 1
        if (depth === 0) return [s.slice(p, q + 1), q + 1]
      }
      q += 1
    }
    return [s.slice(p), s.length]
  }

  if (ch === '<') {
    const end = s.indexOf('>', p)
    if (end === -1) return [s.slice(p), s.length]
    return [s.slice(p, end + 1), end + 1]
  }

  if (ch === '/') {
    let q = p + 1
    while (q < s.length && !isWhitespace(s[q] as string) && !DELIMS.has(s[q] as string)) q += 1
    return [s.slice(p, q), q]
  }

  let q = p
  while (q < s.length && !isWhitespace(s[q] as string) && !DELIMS.has(s[q] as string)) q += 1
  if (q === p) q += 1 // ký tự phân cách đơn lẻ
  return [s.slice(p, q), q]
}

// Lấy giá trị của một key trong dict. Tham chiếu gián tiếp trả về dạng chuẩn
// "N 0 R" để `resolve` xử lý tiếp.
function dictValue(dict: string, key: string): string | null {
  const needle = `/${key}`
  let from = 0
  for (;;) {
    const at = dict.indexOf(needle, from)
    if (at === -1) return null
    const after = dict[at + needle.length]
    // `/Type` không được khớp nhầm vào `/Types`.
    if (after !== undefined && !isWhitespace(after) && !DELIMS.has(after)) {
      from = at + needle.length
      continue
    }
    let [tok, next] = readToken(dict, at + needle.length)
    if (/^\d+$/.test(tok)) {
      // Có thể là tham chiếu "N G R".
      const [gen, afterGen] = readToken(dict, next)
      if (/^\d+$/.test(gen)) {
        const [r, afterR] = readToken(dict, afterGen)
        if (r === 'R') return `${tok} 0 R`
        void afterR
      }
    }
    return tok
  }
}

function refNumber(value: string | null): number | null {
  if (!value) return null
  const m = /^(\d+)\s+\d+\s+R$/.exec(value.trim())
  return m?.[1] ? Number(m[1]) : null
}

// ─── Quét object ───────────────────────────────────────────────────────────

function parseObjects(raw: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>()
  const re = /(?<![0-9])(\d{1,10})\s+(\d{1,5})\s+obj\b/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw)) !== null) {
    if (objects.size >= MAX_OBJECTS) break
    const num = Number(match[1])
    const bodyStart = re.lastIndex
    const bodyEnd = raw.indexOf('endobj', bodyStart)
    const body = raw.slice(bodyStart, bodyEnd === -1 ? raw.length : bodyEnd)

    const streamAt = /stream\r?\n/.exec(body)
    if (!streamAt) {
      objects.set(num, { dict: body, dataStart: -1, dataEnd: -1, inline: false })
      continue
    }
    const dict = body.slice(0, streamAt.index)
    const dataStart = bodyStart + streamAt.index + streamAt[0].length
    // `/Length` trực tiếp là nguồn đáng tin nhất; nếu nó gián tiếp hoặc sai thì
    // rơi về vị trí `endstream`.
    const lengthTok = dictValue(dict, 'Length')
    let dataEnd = -1
    if (lengthTok && /^\d+$/.test(lengthTok)) {
      const end = dataStart + Number(lengthTok)
      if (end <= raw.length) dataEnd = end
    }
    if (dataEnd === -1) {
      const endAt = raw.indexOf('endstream', dataStart)
      dataEnd = endAt === -1 ? raw.length : endAt
    }
    objects.set(num, { dict, dataStart, dataEnd, inline: false })
  }
  return objects
}

function decodeStream(buf: Buffer, obj: PdfObject): Buffer | null {
  if (obj.dataStart < 0 || obj.dataEnd <= obj.dataStart) return null
  const raw = buf.subarray(obj.dataStart, obj.dataEnd)
  const filter = dictValue(obj.dict, 'Filter') ?? ''
  if (filter === '') return raw
  if (!filter.includes('FlateDecode')) return null // ảnh / LZW / ASCII85 → ngoài phạm vi
  try {
    return inflateSync(raw)
  } catch {
    try {
      return inflateRawSync(raw)
    } catch {
      return null
    }
  }
}

// Giải nén object stream (PDF ≥ 1.5) và nạp các object bên trong vào map. Không
// làm bước này thì trên PDF hiện đại không tìm thấy page object nào.
function expandObjectStreams(buf: Buffer, objects: Map<number, PdfObject>): void {
  const containers = [...objects.entries()].filter(([, o]) => (dictValue(o.dict, 'Type') ?? '') === '/ObjStm')
  for (const [, container] of containers) {
    const data = decodeStream(buf, container)
    if (!data) continue
    const text = data.toString('latin1')
    const n = Number(dictValue(container.dict, 'N') ?? '0')
    const first = Number(dictValue(container.dict, 'First') ?? '0')
    if (!Number.isFinite(n) || !Number.isFinite(first) || n <= 0) continue
    const header = text.slice(0, first).trim().split(/\s+/)
    const offsets: { num: number; off: number }[] = []
    for (let i = 0; i < n && i * 2 + 1 < header.length; i++) {
      const num = Number(header[i * 2])
      const off = Number(header[i * 2 + 1])
      if (Number.isFinite(num) && Number.isFinite(off)) offsets.push({ num, off })
    }
    for (let i = 0; i < offsets.length; i++) {
      const cur = offsets[i]
      if (!cur) continue
      const nextOff = offsets[i + 1]?.off ?? text.length - first
      const body = text.slice(first + cur.off, first + nextOff)
      if (!objects.has(cur.num)) {
        objects.set(cur.num, { dict: body, dataStart: -1, dataEnd: -1, inline: true })
      }
    }
  }
}

// ─── Cây trang ─────────────────────────────────────────────────────────────

function typeOf(obj: PdfObject | undefined): string {
  return obj ? (dictValue(obj.dict, 'Type') ?? '') : ''
}

function kidsOf(obj: PdfObject): number[] {
  const kids = dictValue(obj.dict, 'Kids')
  if (!kids) return []
  const out: number[] = []
  const re = /(\d+)\s+\d+\s+R/g
  let m: RegExpExecArray | null
  while ((m = re.exec(kids)) !== null) {
    if (m[1]) out.push(Number(m[1]))
  }
  return out
}

// Danh sách object-number của các trang, ĐÚNG THỨ TỰ tài liệu. Đi cây /Pages
// khi tìm được gốc; nếu không thì rơi về mọi object `/Type /Page` theo số hiệu
// (không chuẩn tuyệt đối nhưng gần đúng với phần lớn file sinh tuần tự).
function collectPages(objects: Map<number, PdfObject>): number[] {
  let root: number | null = null
  for (const [num, obj] of objects) {
    if (typeOf(obj) === '/Pages' && dictValue(obj.dict, 'Parent') === null) {
      root = num
      break
    }
  }

  const pages: number[] = []
  if (root !== null) {
    const visited = new Set<number>()
    const walk = (num: number, depth: number): void => {
      if (depth > MAX_TREE_DEPTH || visited.has(num)) return
      visited.add(num)
      const obj = objects.get(num)
      if (!obj) return
      const type = typeOf(obj)
      if (type === '/Page') {
        pages.push(num)
        return
      }
      for (const kid of kidsOf(obj)) walk(kid, depth + 1)
    }
    walk(root, 0)
  }

  if (pages.length > 0) return pages
  return [...objects.entries()]
    .filter(([, o]) => typeOf(o) === '/Page')
    .map(([num]) => num)
    .sort((a, b) => a - b)
}

// ─── Font + ToUnicode ──────────────────────────────────────────────────────

interface FontInfo {
  cmap: Map<number, string> | null
  twoByte: boolean
}

function hexToText(hex: string): string {
  const clean = hex.length % 4 === 0 ? hex : hex.padEnd(Math.ceil(hex.length / 4) * 4, '0')
  let out = ''
  for (let i = 0; i + 3 < clean.length; i += 4) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16))
  }
  return out
}

function parseCMap(text: string): { map: Map<number, string>; twoByte: boolean } {
  const map = new Map<number, string>()
  let maxSrcBytes = 1

  const charBlocks = text.match(/beginbfchar[\s\S]*?endbfchar/g) ?? []
  for (const block of charBlocks) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(block)) !== null) {
      const src = m[1]
      const dst = m[2]
      if (!src) continue
      maxSrcBytes = Math.max(maxSrcBytes, Math.ceil(src.length / 2))
      map.set(parseInt(src, 16), hexToText(dst ?? ''))
    }
  }

  const rangeBlocks = text.match(/beginbfrange[\s\S]*?endbfrange/g) ?? []
  for (const block of rangeBlocks) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[([\s\S]*?)\])/g
    let m: RegExpExecArray | null
    while ((m = re.exec(block)) !== null) {
      const loHex = m[1]
      const hiHex = m[2]
      if (!loHex || !hiHex) continue
      maxSrcBytes = Math.max(maxSrcBytes, Math.ceil(loHex.length / 2))
      const lo = parseInt(loHex, 16)
      const hi = parseInt(hiHex, 16)
      if (hi < lo || hi - lo > 65_535) continue
      if (m[4] !== undefined) {
        const items = m[4].match(/<([0-9A-Fa-f]*)>/g) ?? []
        for (let i = 0; i <= hi - lo && i < items.length; i++) {
          map.set(lo + i, hexToText((items[i] as string).slice(1, -1)))
        }
        continue
      }
      const base = hexToText(m[3] ?? '')
      if (base.length === 0) continue
      const lastUnit = base.charCodeAt(base.length - 1)
      const prefix = base.slice(0, -1)
      for (let i = 0; i <= hi - lo; i++) {
        map.set(lo + i, prefix + String.fromCharCode(lastUnit + i))
      }
    }
  }

  return { map, twoByte: maxSrcBytes >= 2 }
}

// Bảng font của một trang: tên tài nguyên (`/F1`) → cách giải mã byte thành chữ.
function pageFonts(
  buf: Buffer,
  objects: Map<number, PdfObject>,
  pageObj: PdfObject,
): Map<string, FontInfo> {
  const fonts = new Map<string, FontInfo>()

  const resolveDict = (value: string | null): string | null => {
    if (!value) return null
    const ref = refNumber(value)
    if (ref !== null) return objects.get(ref)?.dict ?? null
    return value.startsWith('<<') ? value : null
  }

  const resources = resolveDict(dictValue(pageObj.dict, 'Resources'))
  const fontDict = resolveDict(resources ? dictValue(resources, 'Font') : null)
  if (!fontDict) return fonts

  const re = /\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g
  let m: RegExpExecArray | null
  while ((m = re.exec(fontDict)) !== null) {
    const name = m[1]
    const objNum = m[2]
    if (!name || !objNum) continue
    const font = objects.get(Number(objNum))
    if (!font) continue
    const subtype = dictValue(font.dict, 'Subtype') ?? ''
    const toUniRef = refNumber(dictValue(font.dict, 'ToUnicode'))
    let info: FontInfo = { cmap: null, twoByte: subtype === '/Type0' }
    if (toUniRef !== null) {
      const toUniObj = objects.get(toUniRef)
      const data = toUniObj ? decodeStream(buf, toUniObj) : null
      if (data) {
        const parsed = parseCMap(data.toString('latin1'))
        info = { cmap: parsed.map, twoByte: parsed.twoByte || subtype === '/Type0' }
      }
    }
    fonts.set(name, info)
  }
  return fonts
}

// ─── Đọc content stream ────────────────────────────────────────────────────

// Chuỗi literal `( … )` với escape và ngoặc lồng. Trả về mảng byte + vị trí kế.
function readLiteralString(s: string, i: number): [number[], number] {
  const out: number[] = []
  let depth = 1
  let p = i + 1
  while (p < s.length) {
    const ch = s[p] as string
    if (ch === '\\') {
      const next = s[p + 1] as string | undefined
      if (next === undefined) break
      if (next >= '0' && next <= '7') {
        let oct = ''
        let q = p + 1
        while (q < s.length && oct.length < 3 && (s[q] as string) >= '0' && (s[q] as string) <= '7') {
          oct += s[q]
          q += 1
        }
        out.push(parseInt(oct, 8) & 0xff)
        p = q
        continue
      }
      const ESCAPES: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 }
      const mapped = ESCAPES[next]
      if (mapped !== undefined) out.push(mapped)
      else if (next !== '\n' && next !== '\r') out.push(next.charCodeAt(0))
      p += 2
      continue
    }
    if (ch === '(') depth += 1
    if (ch === ')') {
      depth -= 1
      if (depth === 0) return [out, p + 1]
    }
    out.push(ch.charCodeAt(0))
    p += 1
  }
  return [out, p]
}

function readHexString(s: string, i: number): [number[], number] {
  const end = s.indexOf('>', i)
  const body = (end === -1 ? s.slice(i + 1) : s.slice(i + 1, end)).replace(/[^0-9A-Fa-f]/g, '')
  const padded = body.length % 2 === 0 ? body : `${body}0`
  const out: number[] = []
  for (let p = 0; p + 1 < padded.length; p += 2) out.push(parseInt(padded.slice(p, p + 2), 16))
  return [out, end === -1 ? s.length : end + 1]
}

function decodeBytes(bytes: number[], font: FontInfo | undefined): string {
  if (font?.cmap && font.twoByte) {
    let out = ''
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = ((bytes[i] as number) << 8) | (bytes[i + 1] as number)
      out += font.cmap.get(code) ?? ''
    }
    return out
  }
  if (font?.cmap) {
    let out = ''
    for (const b of bytes) out += font.cmap.get(b) ?? String.fromCharCode(b)
    return out
  }
  if (font?.twoByte) {
    // Type0 không ToUnicode → byte là glyph id, giải mã ra sẽ là rác. Bỏ hẳn.
    return ''
  }
  return bytes.map((b) => String.fromCharCode(b)).join('')
}

// Duyệt content stream, chỉ quan tâm toán tử hiện chữ. Vị trí/kerning chỉ dùng
// ở mức thô: xuống dòng khi Td/TD/T*/'/" và chèn khoảng trắng khi TJ lùi nhiều.
function extractTextFromContent(content: string, fonts: Map<string, FontInfo>): string {
  let out = ''
  let font: FontInfo | undefined
  // Toạ độ dòng hiện tại. `Td`/`Tm` được dùng cho CẢ xuống dòng LẪN dịch ngang
  // giữa các mảnh của cùng một dòng (kerning, đổi font giữa chữ). Xuống dòng vô
  // điều kiện theo toán tử sẽ cắt "Java" thành "J\nava"; chỉ khi toạ độ Y đổi
  // mới thực sự là dòng mới.
  let lastY: number | null = null
  const operands: { kind: 'name' | 'number' | 'string'; name?: string; num?: number; bytes?: number[] }[] = []
  let i = 0

  const show = (bytes: number[]): void => {
    out += decodeBytes(bytes, font)
  }

  while (i < content.length) {
    const ch = content[i] as string
    if (isWhitespace(ch)) {
      i += 1
      continue
    }
    if (ch === '(') {
      const [bytes, next] = readLiteralString(content, i)
      operands.push({ kind: 'string', bytes })
      i = next
      continue
    }
    if (ch === '<' && content[i + 1] === '<') {
      const [, next] = readToken(content, i)
      i = next
      continue
    }
    if (ch === '<') {
      const [bytes, next] = readHexString(content, i)
      operands.push({ kind: 'string', bytes })
      i = next
      continue
    }
    if (ch === '[' || ch === ']') {
      i += 1
      continue
    }
    if (ch === '/') {
      const [tok, next] = readToken(content, i)
      operands.push({ kind: 'name', name: tok.slice(1) })
      i = next
      continue
    }
    const [tok, next] = readToken(content, i)
    i = next
    if (tok === '') break
    if (/^[-+.\d]/.test(tok) && !Number.isNaN(Number(tok))) {
      operands.push({ kind: 'number', num: Number(tok) })
      continue
    }

    switch (tok) {
      case 'Tf': {
        const name = [...operands].reverse().find((o) => o.kind === 'name')?.name
        font = name ? fonts.get(name) : undefined
        break
      }
      case 'Tj':
      case "'":
      case '"': {
        if (tok !== 'Tj') out += '\n'
        const last = [...operands].reverse().find((o) => o.kind === 'string')
        if (last?.bytes) show(last.bytes)
        break
      }
      case 'TJ': {
        for (const op of operands) {
          if (op.kind === 'string' && op.bytes) show(op.bytes)
          // Lùi nhiều đơn vị ≈ khoảng trắng giữa từ (heuristic quen thuộc).
          else if (op.kind === 'number' && (op.num ?? 0) < -120) out += ' '
        }
        break
      }
      case 'Td':
      case 'TD': {
        const nums = operands.filter((o) => o.kind === 'number')
        const ty = nums[nums.length - 1]?.num ?? 0
        if (ty !== 0) {
          out += '\n'
          lastY = lastY === null ? ty : lastY + ty
        }
        break
      }
      case 'Tm': {
        const nums = operands.filter((o) => o.kind === 'number')
        const y = nums[nums.length - 1]?.num ?? null
        // Chỉ Y đổi mới là dòng mới. Cùng Y mà dời ngang là chèn mảnh chữ vào
        // GIỮA dòng (kerning, đổi font giữa từ) — chèn dấu cách ở đó sẽ cắt
        // "Java" thành "J ava", hỏng cả việc tìm kiếm lẫn trích dẫn. Cái giá là
        // nhãn dính giá trị ("Email:a@b"), đọc vẫn ra, nên chấp nhận.
        if (y !== null && lastY !== null && y !== lastY) out += '\n'
        lastY = y
        break
      }
      case 'T*':
        out += '\n'
        break
      default:
        break
    }
    operands.length = 0
  }
  return out
}

// Dọn kết quả: bỏ ký tự điều khiển, gộp dòng trống thừa, chuẩn hoá khoảng trắng
// cuối dòng.
function tidy(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Nối các content stream của một trang (`/Contents` có thể là ref hoặc mảng ref).
function pageContent(buf: Buffer, objects: Map<number, PdfObject>, pageObj: PdfObject): string {
  const value = dictValue(pageObj.dict, 'Contents')
  if (!value) return ''
  const refs: number[] = []
  const single = refNumber(value)
  if (single !== null) refs.push(single)
  else {
    const re = /(\d+)\s+\d+\s+R/g
    let m: RegExpExecArray | null
    while ((m = re.exec(value)) !== null) {
      if (m[1]) refs.push(Number(m[1]))
    }
  }
  const parts: string[] = []
  for (const ref of refs) {
    const obj = objects.get(ref)
    if (!obj) continue
    const data = decodeStream(buf, obj)
    if (data) parts.push(data.toString('latin1'))
  }
  return parts.join('\n')
}

// Rút text của khoảng trang [firstPage, lastPage] (1-based, đã kẹp vào biên).
export function extractPdfText(buf: Buffer, firstPage: number, lastPage: number): PdfTextResult {
  const raw = buf.toString('latin1')
  const objects = parseObjects(raw)
  expandObjectStreams(buf, objects)
  const pageNums = collectPages(objects)
  const totalPages = pageNums.length
  if (totalPages === 0) {
    return { totalPages: 0, pages: [], note: 'Could not read the page structure of this PDF.' }
  }

  const from = Math.max(1, Math.min(firstPage, totalPages))
  const to = Math.max(from, Math.min(lastPage, totalPages))
  const pages: PdfPageText[] = []
  for (let p = from; p <= to; p++) {
    const obj = objects.get(pageNums[p - 1] as number)
    if (!obj) {
      pages.push({ page: p, text: '' })
      continue
    }
    const content = pageContent(buf, objects, obj)
    const text = tidy(extractTextFromContent(content, pageFonts(buf, objects, obj)))
    pages.push({ page: p, text: text.length > MAX_PAGE_CHARS ? `${text.slice(0, MAX_PAGE_CHARS)}\n…(page truncated)` : text })
  }

  const empty = pages.every((p) => p.text.length === 0)
  return {
    totalPages,
    pages,
    note: empty
      ? 'No text layer on these pages — the PDF is a scan, or its embedded fonts ship no ToUnicode table. AWOG does not OCR.'
      : null,
  }
}
