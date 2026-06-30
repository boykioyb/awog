// Quote highlights (§8): locate each quoted excerpt as one or more DOM Ranges inside a
// rendered markdown block, so the caller can wrap each in a numbered <mark> (see
// SessionTextBlock). Matching runs on the RENDERED text (what a text selection captures), so
// it works across inline markdown formatting (bold/code/link text concatenate) AND across
// block boundaries (a selection spanning several paragraphs/list items). Wrapping is
// DOM-based and thus XSS-safe — it manipulates parsed nodes, never splices tags into HTML
// strings.

// Collapse whitespace runs to single spaces + trim (matches how excerpts are stored) so
// the haystack and needle compare on the same footing.
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

type CharPos = { node: Text; offset: number }

// Block-level tags marked emits. Crossing one of these boundaries inside a selection means
// the captured text had a line break there (a space after normalize), and an inline <mark>
// can't legally span it — both reasons to treat it as a hard run boundary.
const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'LI',
  'UL',
  'OL',
  'BLOCKQUOTE',
  'PRE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'DL',
  'DT',
  'DD',
  'FIGURE',
  'FIGCAPTION',
])

// Nearest block-level ancestor of a text node (or `root` if none) — identifies which block a
// character belongs to, so a boundary between two blocks can be detected.
function nearestBlock(node: Node, root: HTMLElement): Element {
  let el = node.parentElement
  while (el && el !== root) {
    if (BLOCK_TAGS.has(el.tagName)) return el
    el = el.parentElement
  }
  return root
}

// Build a whitespace-normalized string of all text under `root`, plus a map from each
// normalized char back to its (textNode, offset) so a substring match becomes DOM Ranges.
// Whitespace runs collapse to one space (mapped to the first ws char). At a block-element
// boundary we emit a SYNTHETIC space with a `null` map entry: it lets the needle (whose own
// inter-block newlines normalized to spaces) match across blocks, while the `null` marks the
// spot as un-wrappable so the caller splits the run there instead of spanning the boundary.
function buildTextIndex(root: HTMLElement): { text: string; map: (CharPos | null)[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let text = ''
  const map: (CharPos | null)[] = []
  let prevSpace = true // start collapsed so leading whitespace is trimmed
  let prevBlock: Element | null = null
  let node = walker.nextNode()
  while (node) {
    const block = nearestBlock(node, root)
    // Crossed into a different block since the last emitted char → insert one separator.
    if (prevBlock && block !== prevBlock && !prevSpace) {
      text += ' '
      map.push(null)
      prevSpace = true
    }
    const value = node.nodeValue ?? ''
    for (let i = 0; i < value.length; i++) {
      const ch = value.charAt(i)
      if (/\s/.test(ch)) {
        if (prevSpace) continue
        text += ' '
        prevSpace = true
      } else {
        text += ch
        prevSpace = false
      }
      map.push({ node: node as Text, offset: i })
    }
    prevBlock = block
    node = walker.nextNode()
  }
  return { text, map }
}

// One located quote: the DOM Ranges to wrap (one per block the excerpt spans), its circled
// label, and its [start, end) char span in the normalized text (used by the caller to drop
// overlaps). The label badge is appended to the LAST range only.
export type QuoteMark = { ranges: Range[]; label: string; start: number; end: number }

// Locate each item's `needle` (a quoted excerpt) inside `root` as DOM Ranges. A needle that
// spans block boundaries yields one range per block (split at the synthetic `null`s);
// needles not found are skipped. Each search runs from the start of the text, so a repeated
// excerpt maps to its first occurrence (rare; highlights are few).
export function locateMarks(
  root: HTMLElement,
  items: { needle: string; label: string }[],
): QuoteMark[] {
  const { text, map } = buildTextIndex(root)
  const out: QuoteMark[] = []
  for (const { needle: raw, label } of items) {
    const needle = normalize(raw)
    if (!needle) continue
    const idx = text.indexOf(needle)
    if (idx < 0) continue
    const end = idx + needle.length
    // Split the match into runs of consecutive real chars (synthetic block-boundary `null`s
    // break a run), each confined to one block so its <mark> wrap stays valid inline markup.
    const ranges: Range[] = []
    let runStart: CharPos | null = null
    let runLast: CharPos | null = null
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
    if (ranges.length) out.push({ ranges, label, start: idx, end })
  }
  return out
}
