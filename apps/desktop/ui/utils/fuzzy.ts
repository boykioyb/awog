// Lightweight fuzzy subsequence matcher for the command palette / quick open.
// No external dependency (AWOG rule: no new deps without an ADR). A greedy
// left-to-right match with boundary + consecutive bonuses — good enough for
// ranking file paths and command labels, and cheap enough to run over the whole
// file index (≤20k entries) on every keystroke (it bails on the first query
// char that isn't a subsequence of the target).

const BONUS_BOUNDARY = 10 // match at a path-segment / word / after . - _ boundary
const BONUS_CAMEL = 7 // match at a camelCase hump (lower→Upper)
const BONUS_CONSECUTIVE = 8 // match immediately after the previous match
const PENALTY_GAP = -1 // per skipped char between two matches
const PENALTY_LEADING = -0.2 // per skipped char before the first match (capped)
const PENALTY_LEADING_CAP = -4

export interface FuzzyResult {
  score: number
  /** Indices into `target` (the displayed string) that matched — for highlight. */
  positions: number[]
}

const isBoundaryPrev = (ch: string): boolean =>
  ch === '/' || ch === '\\' || ch === '_' || ch === '-' || ch === '.' || ch === ' '

/**
 * Score `query` against `target`, case-insensitively. Returns `null` when
 * `query` is not a subsequence of `target`. An empty query matches everything
 * (score 0, no highlight). Higher score = better match.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (query.length === 0) return { score: 0, positions: [] }
  if (query.length > target.length) return null
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  const positions: number[] = []
  let score = 0
  let qi = 0
  let prevMatch = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue
    let s = 1
    const prevChar = ti > 0 ? (target[ti - 1] ?? '') : '/'
    const curChar = target[ti] ?? ''
    if (ti === 0 || isBoundaryPrev(prevChar)) {
      s += BONUS_BOUNDARY
    } else if (prevChar === prevChar.toLowerCase() && curChar !== curChar.toLowerCase()) {
      s += BONUS_CAMEL
    }
    if (prevMatch >= 0) {
      const gap = ti - prevMatch - 1
      s += gap === 0 ? BONUS_CONSECUTIVE : gap * PENALTY_GAP
    } else {
      s += Math.max(PENALTY_LEADING_CAP, ti * PENALTY_LEADING)
    }
    score += s
    positions.push(ti)
    prevMatch = ti
    qi++
  }

  return qi < q.length ? null : { score, positions }
}

/**
 * Split `text` into contiguous `{ text, match }` segments given the matched
 * `positions` (from {@link fuzzyMatch}). Lets a template render highlighted
 * chars via plain `<span>`s — no v-html, so it's XSS-safe for untrusted paths.
 */
export function highlightSegments(
  text: string,
  positions: number[],
): { text: string; match: boolean }[] {
  if (positions.length === 0) return [{ text, match: false }]
  const set = new Set(positions)
  const segs: { text: string; match: boolean }[] = []
  let buf = ''
  let cur = set.has(0)
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i)
    if (m !== cur) {
      segs.push({ text: buf, match: cur })
      buf = ''
      cur = m
    }
    buf += text[i]
  }
  if (buf) segs.push({ text: buf, match: cur })
  return segs
}
