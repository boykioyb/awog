// Codemod — collapse hand-written border-radius pixels onto the --r-* scale.
// docs/features/native-macos-polish.md §4 W4 · ADR 0079 D1.
//
// 18 distinct pixel values across ~700 sites is not a style, it is noise: `7px` sitting
// next to `var(--r-xs)` looks identical on screen, so hand-fixing is guaranteed to leave
// survivors nobody can spot. Every rewrite here is a pure syntactic substitution, so the
// diff is large but line-by-line reviewable.
//
// Run once, review the diff, commit the script with it:
//   node scripts/codemod-radius.mjs [--dry-run] [--verbose]
// Then `node scripts/check-design-tokens.mjs` must report 0 radius violations.
//
// Node only, zero dependencies.

import { report, rewriteDeclarations } from './lib/css-sites.mjs'

// Scale declared at assets/css/prototype.css :root. Same ladder as
// scripts/check-design-tokens.mjs RADIUS_TOKENS — keep the two in sync.
const RADIUS_TOKENS = [
  { maxPx: 7, token: '--r-xs' }, // 1 2 3 4 5 6 7 → 6px
  { maxPx: 9, token: '--r-sm' }, // 8 9           → 8px
  { maxPx: 12, token: '--r-btn' }, // 10 11 12      → 10px
  { maxPx: 14, token: '--r-card' }, // 13 14         → 14px
  { maxPx: 16, token: '--r-panel' }, // 16            → 16px
  { maxPx: Infinity, token: '--r-pill' }, // 99 999 9999   → 999px
]

// Longhand corners included: `border-top-left-radius` & co (~9 sites).
const RE_RADIUS = /(border(?:-(?:top|bottom)-(?:left|right))?-radius)\s*:\s*([^;}\n]+)/g

// A declared token carrying a redundant fallback, e.g. `var(--r-pill, 999px)`. The
// fallback only ever fires if the token is missing, which it is not — drop it rather
// than rewriting the pixel inside it into `var(--r-pill, var(--r-pill))`.
const RE_TOKEN_FALLBACK = /var\(\s*(--r-(?:xs|sm|btn|card|panel|pill))\s*,[^)]*\)/g

// `var(--r)` is referenced in 13 places but declared in none, so border-radius resolves
// to its initial value (0) and those surfaces (all of Wiki, Settings → Memory) render
// square. This is a live bug, not a style choice; --r-sm is the neutral panel radius.
const RE_UNDECLARED_R = /var\(\s*--r\s*\)/g

const RE_PX = /(-?\d*\.?\d+)px/g

const pick = (px) => RADIUS_TOKENS.find((t) => px <= t.maxPx).token

/** `3px 3px 0 0` → `var(--r-xs) var(--r-xs) 0 0`: shorthand keeps its arity, `0` stays
 *  `0` (a zero corner is intentional, not an un-tokenised value), `50%` and `inherit`
 *  have no px to match and pass through untouched. */
const mapRadius = (value) =>
  value
    .replace(RE_TOKEN_FALLBACK, 'var($1)')
    .replace(RE_UNDECLARED_R, 'var(--r-sm)')
    .replace(RE_PX, (_, n) => (Number(n) === 0 ? '0' : `var(${pick(Number(n))})`))

const edits = rewriteDeclarations({
  re: RE_RADIUS,
  mapValue: mapRadius,
  dryRun: process.argv.includes('--dry-run'),
})

// Multi-value shorthands change shape the most (a 2px speech-bubble tail becomes 6px),
// so surface them for the visual pass instead of burying them in the diff.
const warnings = edits
  .filter((e) => /\S\s+\S/.test(e.from.trim()))
  .map((e) => `${e.file}:${e.line}  ${e.prop}: ${e.from.trim()}  →  ${e.to.trim()}`)

report('codemod-radius', edits, { warnings })
