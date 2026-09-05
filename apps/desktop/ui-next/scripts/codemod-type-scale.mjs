// Codemod — move rem font sizes onto the --fs-* scale.
// docs/features/native-macos-polish.md §4 W3 · ADR 0079 D2.
//
// rem is a RATIO of a base the user can drag (Appearance offers 12/13/14/15/16/18px), so
// the ~700 rem sites land on fractions — 0.8846rem is 11.5px at the default base — and
// macOS renders half-pixel glyphs blurry. The --fs-* tokens are integer offsets off
// --font-size-base, so every step is a whole pixel at every base.
//
// Run once, review the diff, commit the script with it:
//   node scripts/codemod-type-scale.mjs [--dry-run] [--verbose]
// Then `node scripts/check-design-tokens.mjs` must report 0 type violations.
//
// Node only, zero dependencies.

import { report, rewriteDeclarations } from './lib/css-sites.mjs'

// Same ladder as scripts/check-design-tokens.mjs TYPE_TOKENS — keep the two in sync.
// The px column is what the token resolves to at the default base of 13.
const TYPE_TOKENS = [
  { maxPx: 11, token: '--fs-xs' }, // 11
  { maxPx: 12.5, token: '--fs-sm' }, // 12
  { maxPx: 13.5, token: '--fs-md' }, // 13 — body
  { maxPx: 15, token: '--fs-lg' }, // 15
  { maxPx: 18, token: '--fs-xl' }, // 17 — 18px sites lose 1px on purpose, the scale
  { maxPx: 22, token: '--fs-2xl' }, // 22   has six steps and no seventh
]
const REM_BASE_PX = 13

// Single hero number (`.stat .big`, 32px) — an empty-state display size that sits above
// the UI scale on purpose. Left alone, and the guard agrees.
const HERO_REM = 2.4615

// The rem values the plan enumerated. Anything else still gets mapped (the guard's
// ladder is total), but it is reported so a human confirms the rounding was wanted.
const DOCUMENTED_REM = new Set([
  0.6923, 0.7692, 0.8077, 0.8462, 0.8846, 0.9231, 0.9615, 1, 1.0385, 1.0769, 1.1154, 1.15, 1.1538,
  1.3846, 1.6923,
])

const RE_FONT_SIZE = /(font-size)\s*:\s*([^;}\n]+)/g
const RE_REM = /(\d*\.?\d+)rem/g

// Round to 0.1px first: the rem values were themselves rounded, so 0.8462rem is 11.0006px
// and 0.9615rem is 12.4995px. Without this they fall one rung off.
const toPx = (rem) => Math.round(rem * REM_BASE_PX * 10) / 10
const pick = (px) => (TYPE_TOKENS.find((t) => px <= t.maxPx) ?? TYPE_TOKENS.at(-1)).token

const offTable = []

/** `em` and `px` are deliberately left alone: `em` is relative to the parent (swapping in
 *  an absolute token changes the meaning, not the spelling) and the fixed `12px` badge /
 *  hint sizes opt out of Appearance scaling by design (.claude/rules/nuxt-vue.md). */
function mapFontSize(value, at) {
  const rems = [...value.matchAll(RE_REM)].map((m) => Number(m[1]))
  if (!rems.length) return value
  if (rems.length === 1 && rems[0] === HERO_REM) return value

  for (const rem of rems) {
    if (DOCUMENTED_REM.has(rem)) continue
    offTable.push(
      `${at.file}:${at.line}  ${rem}rem (= ${toPx(rem)}px @base13) → var(${pick(toPx(rem))})`,
    )
  }
  return value.replace(RE_REM, (_, n) => `var(${pick(toPx(Number(n)))})`)
}

const edits = rewriteDeclarations({
  re: RE_FONT_SIZE,
  mapValue: mapFontSize,
  dryRun: process.argv.includes('--dry-run'),
})

report('codemod-type-scale', edits, { warnings: offTable })
