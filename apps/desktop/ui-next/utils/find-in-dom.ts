// Find-in-page over a rendered markdown subtree (PreviewModal's `.mdbody`). Reuses
// `buildTextIndex` from quote-highlight — matching runs on the whitespace-normalized
// RENDERED text so it works across inline formatting (bold/code/link) and skips the
// synthetic block-boundary separators. Wrapping is DOM Range-based (never splices tag
// strings into HTML) so it stays XSS-safe on already-sanitized content.
//
// Matching is literal-substring (no regex) and codepoint-based (no diacritic folding):
// "phan tich" does NOT match "phân tích". Case-insensitive by lowercasing both sides.
import { buildTextIndex } from './quote-highlight'

const MARK_CLASS = 'findmatch'

// Locate every occurrence of `needle` inside `root`, returning one Range per contiguous
// run within a block (a match spanning a block boundary — rare for a search keyword —
// yields more than one Range, split at the synthetic separators). Empty/whitespace-only
// needle → no matches.
export function findAllRanges(root: HTMLElement, needle: string, matchCase: boolean): Range[] {
  const q = needle.replace(/\s+/g, ' ')
  if (!q.trim()) return []
  const { text, map } = buildTextIndex(root)
  const hay = matchCase ? text : text.toLowerCase()
  const need = matchCase ? q : q.toLowerCase()
  const ranges: Range[] = []
  let from = 0
  for (;;) {
    const idx = hay.indexOf(need, from)
    if (idx < 0) break
    const end = idx + need.length
    // Split [idx, end) into runs of consecutive real chars; a `null` map entry marks a
    // block boundary an inline <mark> can't legally span, so flush the run there.
    let runStart: { node: Text; offset: number } | null = null
    let runLast: { node: Text; offset: number } | null = null
    const flush = () => {
      if (!runStart || !runLast) return
      const range = document.createRange()
      range.setStart(runStart.node, runStart.offset)
      range.setEnd(runLast.node, runLast.offset + 1)
      ranges.push(range)
      runStart = null
      runLast = null
    }
    for (let i = idx; i < end; i++) {
      const cp = map[i]
      if (!cp) {
        flush()
        continue
      }
      if (!runStart) runStart = cp
      runLast = cp
    }
    flush()
    from = end // needle is non-empty → always advances
  }
  return ranges
}

// Wrap each range in a `<mark class="findmatch">`. Wraps in descending document order
// so `extractContents` on a later range can't shift the nodes/offsets of an earlier
// one, then returns the marks in ASCENDING document order (for next/prev navigation).
export function wrapMatches(ranges: Range[]): HTMLElement[] {
  const sorted = [...ranges].sort((a, b) => b.compareBoundaryPoints(Range.START_TO_START, a))
  const marks: HTMLElement[] = []
  for (const range of sorted) {
    try {
      const mark = document.createElement('mark')
      mark.className = MARK_CLASS
      mark.appendChild(range.extractContents())
      range.insertNode(mark)
      marks.push(mark)
    } catch {
      // Range crossed a boundary we can't cleanly wrap — skip this run.
    }
  }
  return marks.reverse()
}

// Remove all find highlights: replace each `<mark class="findmatch">` with its children
// and coalesce the split text nodes so a later search sees clean text.
export function clearMatches(root: HTMLElement): void {
  const marks = Array.from(root.querySelectorAll(`mark.${MARK_CLASS}`))
  for (const mark of marks) {
    const parent = mark.parentNode
    if (!parent) continue
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  }
  if (marks.length) root.normalize()
}
