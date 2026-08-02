import { computed, ref, shallowRef } from 'vue'
import { docxPlainText, parseDocx, type DocxDoc } from '~/utils/office-docx'
import { columnLabel, parseXlsx, sheetToTsv, type XlsxBook } from '~/utils/office-xlsx'
import type { Bytes } from '~/utils/office-zip'

// Office (docx / xlsx) branch of the shared preview modal, kept out of
// usePreviewModal so that controller stays about "one file, many kinds" and this
// owns the office-specific state: the parsed model, which sheet is active, and how
// many rows are on screen.
//
// SoC: parsing lives in utils/office-* (pure functions over bytes); this
// composable only holds state + the derived shapes the two views bind to. No IPC —
// the caller hands over the bytes it already fetched.

/** Preview kinds handled here. `doc` = Word (.docx), `sheet` = Excel (.xlsx). */
export type OfficeKind = 'doc' | 'sheet'

// Rows are painted in pages: a 5000-row sheet would otherwise put ~1M cells in the
// DOM on open. 200 fills a tall window with room to scroll.
const ROW_PAGE = 200

export function useOfficePreview() {
  const doc = shallowRef<DocxDoc | null>(null)
  const book = shallowRef<XlsxBook | null>(null)
  const sheetIndex = ref(0)
  const rowLimit = ref(ROW_PAGE)

  const sheet = computed(() => book.value?.sheets[sheetIndex.value] ?? null)
  const sheetNames = computed(() => book.value?.sheets.map((s) => s.name) ?? [])
  const visibleRows = computed(() => sheet.value?.rows.slice(0, rowLimit.value) ?? [])
  const hiddenRowCount = computed(() =>
    Math.max(0, (sheet.value?.rows.length ?? 0) - visibleRows.value.length),
  )
  const colLabels = computed(() =>
    Array.from({ length: sheet.value?.colCount ?? 0 }, (_, c) => columnLabel(c)),
  )

  // Merged ranges, resolved once per sheet into what the table needs: the span for
  // an anchor cell, and the set of cells an anchor swallowed (skipped when painting).
  const spans = computed(() => {
    const anchors = new Map<string, { rowSpan: number; colSpan: number }>()
    const covered = new Set<string>()
    for (const m of sheet.value?.merges ?? []) {
      if (m.rowSpan === 1 && m.colSpan === 1) continue
      anchors.set(`${m.row}:${m.col}`, { rowSpan: m.rowSpan, colSpan: m.colSpan })
      for (let r = m.row; r < m.row + m.rowSpan; r++) {
        for (let c = m.col; c < m.col + m.colSpan; c++) {
          if (r !== m.row || c !== m.col) covered.add(`${r}:${c}`)
        }
      }
    }
    return { anchors, covered }
  })

  const spanAt = (row: number, col: number) => spans.value.anchors.get(`${row}:${col}`) ?? null
  const isCovered = (row: number, col: number) => spans.value.covered.has(`${row}:${col}`)

  /** Parsed-but-empty document (renders an "empty" placeholder instead of a blank pane). */
  const isEmpty = computed(() => {
    if (doc.value) return doc.value.blocks.length === 0
    if (sheet.value) return sheet.value.rows.length === 0
    return false
  })

  /** True when a cap cut the content short — the view says so rather than lying. */
  const truncated = computed(
    () => !!doc.value?.truncated || !!book.value?.truncated || !!sheet.value?.truncated,
  )

  /** Plain-text projection for copy / add-to-chat (TSV for the active sheet). */
  const text = computed(() => {
    if (doc.value) return docxPlainText(doc.value)
    const s = sheet.value
    return s ? sheetToTsv(s) : ''
  })

  function selectSheet(index: number): void {
    if (index === sheetIndex.value) return
    sheetIndex.value = index
    rowLimit.value = ROW_PAGE
  }
  function showMoreRows(): void {
    rowLimit.value += ROW_PAGE
  }

  function reset(): void {
    doc.value = null
    book.value = null
    sheetIndex.value = 0
    rowLimit.value = ROW_PAGE
  }

  /**
   * Parse `bytes` into the model for `kind`. Returns false when the file isn't a
   * readable OOXML container (corrupt, password-protected, or a legacy .doc/.xls
   * binary renamed) — the caller shows "couldn't read" + open-externally.
   */
  async function parse(kind: OfficeKind, bytes: Bytes): Promise<boolean> {
    reset()
    try {
      if (kind === 'doc') doc.value = await parseDocx(bytes)
      else book.value = await parseXlsx(bytes)
      return true
    } catch {
      reset()
      return false
    }
  }

  return {
    doc,
    sheet,
    sheetNames,
    sheetIndex,
    selectSheet,
    visibleRows,
    hiddenRowCount,
    showMoreRows,
    colLabels,
    spanAt,
    isCovered,
    isEmpty,
    truncated,
    text,
    parse,
    reset,
  }
}

export type OfficePreviewController = ReturnType<typeof useOfficePreview>
