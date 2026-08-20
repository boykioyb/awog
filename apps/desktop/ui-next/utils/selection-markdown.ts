// Selection → RAW markdown: map the plain text a user highlighted on a RENDERED markdown
// surface (a transcript message, a previewed .md) back onto the markdown SOURCE it was
// rendered from, so "Copy MD" puts the author's original syntax on the clipboard (fences,
// tables, `$…$` math, links) instead of the flattened text the browser would copy.
//
// Why match the source instead of serializing the DOM back to markdown: the source is
// already in state (a message's block text, the previewed file's text), so slicing it
// returns the EXACT bytes the model/author wrote. A re-serializer could only ever produce
// an equivalent rewrite, and would have to special-case Shiki's per-token spans, KaTeX's
// MathML and mermaid's SVG — none of which carry their source text.
//
// Matching runs on a "skeleton" of each string: letters + digits only, lowercased. Every
// markdown marker (`**`, `` ` ``, `#`, `-`, `|`, `[](…)`) is punctuation, so it drops out of
// BOTH sides — which is what makes a plain-text needle findable inside marked-up source,
// and what lets a selection span several blocks (the `\n\n## ` between them is invisible to
// the skeleton). Text the renderer does NOT show still lives in the source skeleton though
// (chiefly a link's URL and an image's src), so a selection crossing one is no longer
// contiguous there — hence the second, gap-tolerant pass.

const WORD = /[\p{L}\p{N}]/u

// Skeleton chars + the source index each of them came from (so a skeleton range maps back
// to a raw slice).
type Skeleton = { chars: string; at: number[] }

function skeletonize(s: string): Skeleton {
  let chars = ''
  const at: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    if (!WORD.test(c)) continue
    chars += c.toLowerCase()
    at.push(i)
  }
  return { chars, at }
}

// Gap-tolerant pass tuning. ANCHOR = how many leading needle chars must sit contiguously in
// the source to consider a start position (short enough that a link right after the first
// word doesn't break every candidate, long enough not to anchor on noise). MAX_GAP caps a
// single skipped run — a link URL / image src is well under this; a bigger jump means we
// drifted into unrelated source.
const ANCHOR = 4
const MAX_GAP = 160

// Locate `needle` in `hay` allowing the haystack to skip characters the renderer never
// showed. Greedy (no backtracking) per anchor position, but every anchor occurrence is
// tried, so a wrong first guess doesn't lose the match. Returns a skeleton range, or null.
function findWithGaps(hay: string, needle: string): [number, number] | null {
  const anchor = needle.slice(0, Math.min(ANCHOR, needle.length))
  const budget = Math.max(200, needle.length)
  for (let from = hay.indexOf(anchor); from >= 0; from = hay.indexOf(anchor, from + 1)) {
    let h = from + anchor.length
    let n = anchor.length
    let skipped = 0
    while (n < needle.length) {
      const next = hay.indexOf(needle[n] as string, h)
      if (next < 0) break
      const gap = next - h
      if (gap > MAX_GAP || skipped + gap > budget) break
      skipped += gap
      h = next + 1
      n++
    }
    if (n === needle.length) return [from, h]
  }
  return null
}

// `$` is in the run because inline math (`$E = mc^2$`) is delimited the same way — and the
// symmetry requirement below keeps it from eating a lone currency `$` out of prose.
const MARKER_RUN = /[*_~`$]+$/

// Grow the raw slice out to markdown boundaries so what lands on the clipboard is still
// valid markdown:
//   0. Re-attach the punctuation the selection itself ended on (`.`, `?`, `)`) — the skeleton
//      dropped it, so the range stops at the last letter and a copied sentence would lose its
//      full stop.
//   1. Inline emphasis/code is delimited by a marker run on BOTH sides (`**x**`, `` `x` ``).
//      Absorb a leading run only when the same run trails the slice — otherwise a selection
//      that merely starts after the underscore in `snake_case` would gain a stray `_`.
//   2. A selection starting at the beginning of a line's CONTENT pulls in that line's block
//      marker (`- `, `1. `, `## `, `> `, `- [x] `), so a copied bullet pastes as a bullet
//      instead of a paragraph. Only marker characters may sit in between — real prose before
//      the match means the selection genuinely starts mid-line.
const BLOCK_PREFIX = /^[ \t>#*+\-0-9.[\]x]*$/i

function expandToMarkdownBounds(
  raw: string,
  start: number,
  end: number,
  tail: string,
): [number, number] {
  let s = start
  let e = end
  if (tail && raw.startsWith(tail, e)) e += tail.length
  const left = MARKER_RUN.exec(raw.slice(Math.max(0, s - 3), s))?.[0] ?? ''
  if (left && raw.startsWith(left, e)) {
    s -= left.length
    e += left.length
  }
  const lineStart = raw.lastIndexOf('\n', s - 1) + 1
  if (lineStart < s && BLOCK_PREFIX.test(raw.slice(lineStart, s))) s = lineStart
  return [s, e]
}

// Drop blank lines around the slice but KEEP leading indentation on its first line — a
// nested list item's indent is what makes it nest again when pasted.
const trimEdges = (s: string) => s.replace(/^[ \t]*\n+/, '').replace(/\s+$/, '')

/**
 * Raw markdown behind a rendered selection, or null when it can't be located (caller then
 * falls back to the selected plain text).
 *
 * `sources` are the candidate markdown sources the selection could have come from, tried in
 * order — a transcript message hands its text blocks, the preview modal its file text.
 */
export function rawMarkdownForSelection(
  sources: readonly string[],
  selected: string,
): string | null {
  const needle = skeletonize(selected).chars
  // Punctuation the selection ended on, to re-attach after the match (see step 0).
  const tail = /[^\p{L}\p{N}\s]+$/u.exec(selected.replace(/\s+$/, ''))?.[0] ?? ''
  // A one-character selection carries no signal to align on (and copying its source syntax
  // would be meaningless) — let the caller copy it verbatim.
  if (needle.length < 2) return null
  for (const src of sources) {
    if (!src) continue
    const hay = skeletonize(src)
    if (!hay.chars) continue
    // Whole source selected (select-all inside one block) → hand it back as-is.
    if (hay.chars === needle) return trimEdges(src)
    const at = hay.chars.indexOf(needle)
    const range: [number, number] | null =
      at >= 0 ? [at, at + needle.length] : findWithGaps(hay.chars, needle)
    if (!range) continue
    const rawStart = hay.at[range[0]] as number
    const rawEnd = (hay.at[range[1] - 1] as number) + 1
    const [s, e] = expandToMarkdownBounds(src, rawStart, rawEnd, tail)
    return trimEdges(src.slice(s, e))
  }
  return null
}
