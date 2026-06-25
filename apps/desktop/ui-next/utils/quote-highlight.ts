// Quote highlights (§8): locate each quoted excerpt as a DOM Range inside a rendered
// markdown block, so the caller can wrap it in a numbered <mark> (see SessionTextBlock).
// Matching runs on the RENDERED text (what a text selection captures), so it works across
// inline markdown formatting (bold/code/link text concatenate). Wrapping is DOM-based and
// thus XSS-safe — it manipulates parsed nodes, never splices tags into HTML strings.

// Collapse whitespace runs to single spaces + trim (matches how excerpts are stored) so
// the haystack and needle compare on the same footing.
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

type CharPos = { node: Text; offset: number }

// Build a whitespace-normalized string of all text under `root`, plus a map from each
// normalized char back to its (textNode, offset) so a substring match becomes a DOM
// Range. Whitespace runs collapse to one space (mapped to the first ws char), which makes
// matching work across inline formatting — the common intra-paragraph quote. Cross-block
// quotes (no whitespace between block elements in the DOM) may not match.
function buildTextIndex(root: HTMLElement): { text: string; map: CharPos[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let text = ''
  const map: CharPos[] = []
  let prevSpace = true // start collapsed so leading whitespace is trimmed
  let node = walker.nextNode()
  while (node) {
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
    node = walker.nextNode()
  }
  return { text, map }
}

// One located quote: the DOM Range to wrap, its circled label, and its [start, end) char
// span in the normalized text (used by the caller to drop overlaps + wrap last-first).
export type QuoteMark = { range: Range; label: string; start: number; end: number }

// Locate each item's `needle` (a quoted excerpt) as a DOM Range inside `root`. Needles not
// found are skipped. Each search runs from the start of the text, so a repeated excerpt
// maps to its first occurrence (rare; highlights are few).
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
    const start = map[idx]
    const last = map[idx + needle.length - 1]
    if (!start || !last) continue
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(last.node, last.offset + 1)
    out.push({ range, label, start: idx, end: idx + needle.length })
  }
  return out
}
