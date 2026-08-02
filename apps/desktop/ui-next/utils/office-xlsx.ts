// XLSX (SpreadsheetML) → a sheet grid model the preview renders as a table.
// A *reading* model like the docx one: cell values with just enough number-format
// awareness to keep dates from showing up as 45678 and percentages as 0.42.
// Formulas are shown by their cached result (what Excel last computed) — the
// preview never evaluates anything. Charts, conditional formats, colours, pivot
// tables and images are out of scope; "open externally" is the fidelity path.

import {
  attrNamed,
  childNamed,
  childrenNamed,
  descendantsNamed,
  firstDescendant,
  intAttr,
  OfficeParseError,
  parseRelationships,
  parseXmlRoot,
  resolvePartPath,
  type Relationship,
} from './office-xml'
import { openZip, zipEntryText, type Bytes, type Zip } from './office-zip'

export type SheetCell = {
  text: string
  /** Numeric cells are right-aligned, like a spreadsheet app. */
  num?: boolean
}
/** A row is dense up to its last used column; gaps are null. */
export type SheetRow = (SheetCell | null)[]
export type SheetMerge = { row: number; col: number; rowSpan: number; colSpan: number }

export type XlsxSheet = {
  name: string
  rows: SheetRow[]
  colCount: number
  /** Per-column pixel widths, dense over colCount (Excel char units → px). */
  colWidths: number[]
  merges: SheetMerge[]
  /** True when the sheet hit MAX_ROWS / MAX_COLS and was cut short. */
  truncated: boolean
}
export type XlsxBook = { sheets: XlsxSheet[]; truncated: boolean }

// Bounds: a 5k × 200 window is far more than anyone reads in a preview pane, and
// keeps a 50 MB workbook from freezing the renderer.
const MAX_SHEETS = 30
const MAX_ROWS = 5000
const MAX_COLS = 200
// Excel character-width units → px (≈7 px per char + cell padding).
const PX_PER_CHAR = 7
const CELL_PADDING = 12
const MIN_COL_PX = 48
const MAX_COL_PX = 420
/** Width used for columns the workbook doesn't size explicitly. */
export const SHEET_DEFAULT_COL_PX = 92
// Serial-date epoch offsets: 1900 mode counts 25569 days to 1970-01-01 (including
// Excel's deliberate 1900 leap-year bug), 1904 mode counts 24107.
const EPOCH_1900 = 25569
const EPOCH_1904 = 24107
const MS_PER_DAY = 86400000
// Built-in number formats that mean date/time (ECMA-376 §18.8.30).
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

type Styles = {
  /** cellXfs index → numFmtId. */
  cellNumFmt: number[]
  /** numFmtId → format code (custom formats only; built-ins are implicit). */
  formatCodes: Map<number, string>
}

export async function parseXlsx(bytes: Bytes): Promise<XlsxBook> {
  const zip = openZip(bytes)
  const workbookXml = await zipEntryText(zip, 'xl/workbook.xml')
  if (!workbookXml) throw new OfficeParseError('Not an Excel workbook (xl/workbook.xml missing)')

  const root = parseXmlRoot(workbookXml)
  const date1904 = /^(1|true)$/i.test(
    attrNamed(childNamed(root, 'workbookPr') ?? root, 'date1904') ?? '',
  )
  const relsXml = await zipEntryText(zip, 'xl/_rels/workbook.xml.rels')
  const rels = relsXml ? parseRelationships(relsXml) : new Map<string, Relationship>()
  const shared = await loadSharedStrings(zip)
  const styles = await loadStyles(zip)

  const sheetsEl = childNamed(root, 'sheets')
  const refs = sheetsEl ? childrenNamed(sheetsEl, 'sheet') : []
  const sheets: XlsxSheet[] = []
  for (const ref of refs.slice(0, MAX_SHEETS)) {
    const rel = rels.get(attrNamed(ref, 'id') ?? '')
    if (!rel || rel.external) continue
    const part = resolvePartPath('xl/workbook.xml', rel.target)
    const xml = await zipEntryText(zip, part)
    if (!xml) continue
    sheets.push(parseSheet(attrNamed(ref, 'name') ?? part, xml, { shared, styles, date1904 }))
  }
  if (!sheets.length) throw new OfficeParseError('Workbook has no readable sheet')
  return { sheets, truncated: refs.length > MAX_SHEETS }
}

/** Tab-separated projection of one sheet — used for "copy" and "add to chat". */
export function sheetToTsv(sheet: XlsxSheet): string {
  return sheet.rows
    .map((row) =>
      Array.from({ length: sheet.colCount }, (_, c) => (row[c]?.text ?? '').replace(/\t/g, ' '))
        .join('\t')
        .replace(/\t+$/, ''),
    )
    .join('\n')
}

/** 0 → 'A', 25 → 'Z', 26 → 'AA' (spreadsheet column header labels). */
export function columnLabel(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

// ── one sheet ────────────────────────────────────────────────────────────────
type SheetCtx = { shared: string[]; styles: Styles; date1904: boolean }

function parseSheet(name: string, xml: string, ctx: SheetCtx): XlsxSheet {
  const root = parseXmlRoot(xml)
  const rows: SheetRow[] = []
  let colCount = 0
  let truncated = false

  const sheetData = childNamed(root, 'sheetData')
  for (const rowEl of sheetData ? childrenNamed(sheetData, 'row') : []) {
    // Trust @r when present (rows may be sparse); else append.
    const rowIndex = (intAttr(rowEl, 'r') ?? rows.length + 1) - 1
    if (rowIndex >= MAX_ROWS) {
      truncated = true
      break
    }
    const row: SheetRow = []
    for (const cellEl of childrenNamed(rowEl, 'c')) {
      const address = attrNamed(cellEl, 'r')
      const colIndex = address ? columnIndex(address) : row.length
      if (colIndex >= MAX_COLS) {
        truncated = true
        continue
      }
      const cell = cellOf(cellEl, ctx)
      if (!cell) continue
      row[colIndex] = cell
      if (colIndex + 1 > colCount) colCount = colIndex + 1
    }
    rows[rowIndex] = row
  }

  // Fill sparse holes so the view can iterate rows/columns by index.
  for (let r = 0; r < rows.length; r++) if (!rows[r]) rows[r] = []
  while (rows.length && !rows[rows.length - 1]?.some(Boolean)) rows.pop()

  return {
    name,
    rows,
    colCount,
    colWidths: colWidthsOf(root, colCount),
    merges: mergesOf(root),
    truncated,
  }
}

function cellOf(el: Element, ctx: SheetCtx): SheetCell | null {
  const type = attrNamed(el, 't') ?? 'n'
  if (type === 'inlineStr') {
    const text = textOfRichNode(childNamed(el, 'is'))
    return text ? { text } : null
  }
  const raw = childNamed(el, 'v')?.textContent ?? ''
  if (!raw) return null

  switch (type) {
    case 's': {
      const text = ctx.shared[Number(raw)] ?? ''
      return text ? { text } : null
    }
    case 'str':
      return { text: raw }
    case 'b':
      return { text: raw === '1' ? 'TRUE' : 'FALSE' }
    case 'e':
      return { text: raw }
    case 'd':
      return { text: raw.replace('T', ' ').replace(/\.\d+Z?$/, '') }
    default: {
      const value = Number(raw)
      if (!Number.isFinite(value)) return { text: raw }
      const format = formatOf(el, ctx.styles)
      if (isDateFormat(format)) return { text: serialToDate(value, ctx.date1904) }
      if (format.code.includes('%')) return { text: `${trimNumber(value * 100)}%`, num: true }
      return { text: trimNumber(value), num: true }
    }
  }
}

type NumFormat = { id: number; code: string }

function formatOf(el: Element, styles: Styles): NumFormat {
  const styleIndex = intAttr(el, 's')
  const id = (styleIndex != null ? styles.cellNumFmt[styleIndex] : 0) ?? 0
  return { id, code: styles.formatCodes.get(id) ?? '' }
}

// Built-in date ids, or a custom code that still has date/time tokens once the
// literal (quoted / bracketed / escaped) parts are stripped out.
function isDateFormat({ id, code }: NumFormat): boolean {
  if (DATE_FORMAT_IDS.has(id)) return true
  if (!code) return false
  const tokens = code
    .replace(/\[[^\]]*\]/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
  return /[ymdhs]/i.test(tokens) && !/^general$/i.test(code.trim())
}

// Excel serial → 'YYYY-MM-DD[ HH:MM[:SS]]'. Locale-independent on purpose: a
// preview should show what the file holds, not reformat it per machine locale.
function serialToDate(serial: number, date1904: boolean): string {
  const epoch = date1904 ? EPOCH_1904 : EPOCH_1900
  const ms = Math.round((serial - epoch) * MS_PER_DAY)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return trimNumber(serial)
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  const h = d.getUTCHours()
  const m = d.getUTCMinutes()
  const s = d.getUTCSeconds()
  // A time-only value (serial < 1) has no meaningful date part.
  if (serial > 0 && serial < 1) return s ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`
  if (!h && !m && !s) return date
  return s ? `${date} ${pad(h)}:${pad(m)}:${pad(s)}` : `${date} ${pad(h)}:${pad(m)}`
}

// Kill float noise (0.30000000000000004) without inventing precision.
function trimNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(12)))
}

/** 'AB12' → 27 (zero-based column index). */
function columnIndex(address: string): number {
  let index = 0
  for (let i = 0; i < address.length; i++) {
    const code = address.charCodeAt(i)
    if (code < 65 || code > 90) break // hit the row digits
    index = index * 26 + (code - 64)
  }
  return Math.max(0, index - 1)
}

// Dense over colCount so the view can size every column without a fallback.
function colWidthsOf(root: Element, colCount: number): number[] {
  const widths: number[] = []
  const cols = childNamed(root, 'cols')
  for (const col of cols ? childrenNamed(cols, 'col') : []) {
    const min = intAttr(col, 'min') ?? 1
    const max = Math.min(intAttr(col, 'max') ?? min, colCount)
    const raw = Number(attrNamed(col, 'width') ?? '')
    if (!Number.isFinite(raw)) continue
    const px = Math.round(
      Math.min(Math.max(raw * PX_PER_CHAR + CELL_PADDING, MIN_COL_PX), MAX_COL_PX),
    )
    for (let c = min; c <= max; c++) widths[c - 1] = px
  }
  for (let c = 0; c < colCount; c++) widths[c] ??= SHEET_DEFAULT_COL_PX
  return widths
}

function mergesOf(root: Element): SheetMerge[] {
  const container = childNamed(root, 'mergeCells')
  if (!container) return []
  const out: SheetMerge[] = []
  for (const el of childrenNamed(container, 'mergeCell')) {
    const ref = attrNamed(el, 'ref') ?? ''
    const [from, to] = ref.split(':')
    if (!from || !to) continue
    const row = (Number.parseInt(from.replace(/^[A-Z]+/i, ''), 10) || 1) - 1
    const rowEnd = (Number.parseInt(to.replace(/^[A-Z]+/i, ''), 10) || 1) - 1
    const col = columnIndex(from)
    const colEnd = columnIndex(to)
    if (row >= MAX_ROWS || col >= MAX_COLS) continue
    out.push({
      row,
      col,
      rowSpan: Math.max(1, Math.min(rowEnd, MAX_ROWS - 1) - row + 1),
      colSpan: Math.max(1, Math.min(colEnd, MAX_COLS - 1) - col + 1),
    })
  }
  return out
}

// ── side parts (sharedStrings / styles) ──────────────────────────────────────
async function loadSharedStrings(zip: Zip): Promise<string[]> {
  const xml = await zipEntryText(zip, 'xl/sharedStrings.xml')
  if (!xml) return []
  try {
    return descendantsNamed(parseXmlRoot(xml), 'si').map((si) => textOfRichNode(si))
  } catch {
    return [] // a broken string table costs labels, not the whole preview
  }
}

// Rich text is a run list (`<r><t>`); phonetic hints (`<rPh>`) are Japanese ruby
// annotations Excel stores alongside and must not be concatenated into the value.
function textOfRichNode(node: Element | null): string {
  if (!node) return ''
  const direct = childNamed(node, 't')
  if (direct) return direct.textContent ?? ''
  let out = ''
  for (const run of childrenNamed(node, 'r')) out += childNamed(run, 't')?.textContent ?? ''
  return out
}

async function loadStyles(zip: Zip): Promise<Styles> {
  const empty: Styles = { cellNumFmt: [], formatCodes: new Map() }
  const xml = await zipEntryText(zip, 'xl/styles.xml')
  if (!xml) return empty
  try {
    const root = parseXmlRoot(xml)
    const formatCodes = new Map<number, string>()
    // Only the workbook-level <numFmts> table — `dxfs` (conditional formats) also
    // carries numFmt children that would otherwise clobber real format codes.
    const numFmts = firstDescendant(root, 'numFmts')
    for (const fmt of numFmts ? childrenNamed(numFmts, 'numFmt') : []) {
      const id = intAttr(fmt, 'numFmtId')
      const code = attrNamed(fmt, 'formatCode')
      if (id != null && code) formatCodes.set(id, code)
    }
    const cellXfs = firstDescendant(root, 'cellXfs')
    const cellNumFmt = cellXfs
      ? childrenNamed(cellXfs, 'xf').map((xf) => intAttr(xf, 'numFmtId') ?? 0)
      : []
    return { cellNumFmt, formatCodes }
  } catch {
    return empty // unformatted numbers still beat no preview
  }
}
