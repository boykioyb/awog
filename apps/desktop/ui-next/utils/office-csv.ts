// CSV / TSV → mô hình sheet của utils/office-xlsx (XlsxBook) để vẽ bằng ĐÚNG lưới Excel
// (OfficeSheetView) — không có bảng thứ hai. Hàm thuần, không Vue, không IPC.
//
// Theo RFC 4180: ô bọc ngoặc kép được chứa dấu phân cách, xuống dòng và `""` (= một
// dấu `"`); CRLF / LF / CR đều là hết dòng; BOM UTF-8 (Excel hay ghi) bị bỏ. Dấu phân
// cách của .csv tự đoán trên dòng đầu (`,` `;` tab) — Excel cài locale châu Âu/Nhật xuất
// CSV bằng `;`. Cùng trần 5000 dòng × 200 cột như xlsx để file lớn không treo renderer.
// Chỉ import KIỂU: test `node --test` chạy .ts thuần, không phân giải được import giá trị
// không đuôi của office-xlsx (nó lại kéo theo office-xml/office-zip).
import type { SheetRow, XlsxBook } from './office-xlsx'

const MAX_ROWS = 5000
const MAX_COLS = 200
// Bề rộng cột ước theo độ dài chữ dài nhất (px/ký tự + padding), kẹp trong khoảng đọc được.
const PX_PER_CHAR = 7
const CELL_PADDING = 16
const MIN_COL_PX = 48
const MAX_COL_PX = 360
// Cột trống: cùng giá trị SHEET_DEFAULT_COL_PX của office-xlsx.
const DEFAULT_COL_PX = 92
// Số có thể có dấu, phân cách nghìn, phần thập phân, %, đơn vị tiền phổ biến — căn phải.
const NUM_RE = /^[-+]?[$¥€£]?\s?\d[\d,]*(\.\d+)?\s?%?$/

export type CsvDelimiter = ',' | ';' | '\t'

/** Đoán dấu phân cách từ dòng đầu (ngoài ngoặc kép): dấu xuất hiện nhiều nhất thắng. */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ',': 0, ';': 0, '\t': 0 }
  let quoted = false
  for (const ch of text) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && (ch === '\n' || ch === '\r')) break
    else if (!quoted && (ch === ',' || ch === ';' || ch === '\t')) counts[ch]++
  }
  if (counts['\t'] > counts[','] && counts['\t'] >= counts[';']) return '\t'
  if (counts[';'] > counts[',']) return ';'
  return ','
}

/** Tách văn bản thành mảng dòng × ô (chuỗi thô). Dừng khi đủ `maxRows` dòng. */
export function parseCsvRows(
  text: string,
  delimiter: CsvDelimiter,
  maxRows = Number.POSITIVE_INFINITY,
): { rows: string[][]; truncated: boolean } {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  const endRow = (): boolean => {
    row.push(cell)
    rows.push(row)
    row = []
    cell = ''
    return rows.length >= maxRows
  }
  while (i < src.length) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
      } else {
        cell += ch
      }
      i++
      continue
    }
    if (ch === '"' && cell === '') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      if (endRow()) return { rows, truncated: i + 1 < src.length }
    } else {
      cell += ch
    }
    i++
  }
  // Dòng cuối không có ký tự xuống dòng; file kết thúc bằng xuống dòng thì không thêm dòng rỗng.
  if (cell !== '' || row.length > 0) endRow()
  return { rows, truncated: false }
}

/** CSV/TSV → XlsxBook một sheet tên `name`. `delimiter` bỏ trống ⇒ tự đoán. */
export function parseCsv(text: string, name: string, delimiter?: CsvDelimiter): XlsxBook {
  const delim = delimiter ?? detectDelimiter(text)
  const parsed = parseCsvRows(text, delim, MAX_ROWS)
  let colCount = 0
  let colsCut = false
  const rows: SheetRow[] = parsed.rows.map((cells) => {
    if (cells.length > MAX_COLS) colsCut = true
    const used = cells.slice(0, MAX_COLS)
    colCount = Math.max(colCount, used.length)
    return used.map((t) =>
      t === '' ? null : { text: t, ...(NUM_RE.test(t.trim()) ? { num: true } : {}) },
    )
  })
  const colWidths = Array.from({ length: colCount }, (_, c) => {
    let longest = 0
    for (const r of rows) longest = Math.max(longest, r[c]?.text.length ?? 0)
    if (longest === 0) return DEFAULT_COL_PX
    return Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, longest * PX_PER_CHAR + CELL_PADDING))
  })
  const truncated = parsed.truncated || colsCut
  return {
    sheets: [{ name, rows, colCount, colWidths, merges: [], truncated }],
    truncated,
  }
}
