// Codemod — take the ODD numbers out of padding / margin / gap.
// See docs/features/native-macos-polish.md §4 W10 and ADR 0079.
//
// WHY, and why only this much.
//
// The shell states spacing 2400+ times in raw px across 246 files, spread over 30 padding
// values and 19 gap values. Only a third of them sit on a 4pt grid and a third are ODD,
// which is the half of the problem that shows on screen: an odd padding inside a box whose
// height is even (or vice versa) hands the half pixel straight back to the centring maths
// that ADR 0079 D2b / D6 just cleaned up out of line-height and icon sizes.
//
// The obvious move — snap everything to a 4pt grid — is the wrong first move. Forcing 9→12
// shifts three pixels at a time and wraps or overflows content in hundreds of places that
// nobody can review. So this pass does the strictly smaller thing: **make every value even,
// moving each one by at most 1px**, and leave the rhythm (a real --sp-* scale) for a later
// pass once we can see what set of values is actually left.
//
// Rounding goes DOWN (9→8, 7→6, 5→4, 3→2, 11→10, 13→12, 15→14). Tighter is the safe
// direction: shrinking a gap cannot cause an overflow, growing one can.
//
// `1px` is EXEMPT (63 sites). A 1px padding/margin is almost never rhythm — it is an
// optical nudge or the thickness of a hairline being compensated for — and both available
// moves (0 or 2) are wrong. Same for `-1px`.
//
// SCOPE: `padding*`, `margin*`, `gap` / `row-gap` / `column-gap`. Explicitly NOT
// `width`/`height`/`top`/`left`/`inset`/`transform` — those are SHAPE, not rhythm, and an
// odd one there is usually deliberate.
//
// Shorthands keep their arity: `padding: 7px 9px` → `padding: 6px 8px`.
//
//   node scripts/codemod-spacing.mjs [--dry-run] [--verbose]
//
// Node only, zero dependencies.

import { rewriteDeclarations, report } from './lib/css-sites.mjs'

// Files another branch is mid-edit in. Excluded from the REWRITE only — the guard still
// reads them, so they must be clean on their own (they are: 0 odd spacing values).
// Remove the entry once that work lands.
const SKIP = ['components/settings/SettingsSessions.vue']

// Property list, spelled out rather than a `padding.*` wildcard so `scroll-padding`,
// `padding-box` and friends can never be caught by accident. `(?<![-\w])` keeps
// `-webkit-margin-start` and camelCase `marginTop` (JS style objects) out too.
//
// The value stops at `"` and `'` as well as `;}` so an inline `style="padding: 9px"` in a
// template reads as one declaration instead of swallowing the rest of the attribute. A
// consequence: a JS style object written `{ padding: '4px 9px' }` is skipped outright,
// because the value starts with the quote. That is deliberate — those are nearly all
// computed (`${8 + depth * 12}px`) and not ours to round.
const RE_SPACING =
  /(?<![-\w])((?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|(?:row-|column-)?gap)\s*:\s*([^;}"'\n]+)/g

const EXEMPT_PX = 1

/** Nearest even px, moving TOWARDS zero, so a negative margin gets tighter too. */
export function evenSpacing(px) {
  if (!Number.isInteger(px)) return px
  const mag = Math.abs(px)
  if (mag === EXEMPT_PX || mag % 2 === 0) return px
  return Math.sign(px) * (mag - 1)
}

const before = new Map()
const after = new Map()
const bump = (map, px) => map.set(px, (map.get(px) ?? 0) + 1)

const dryRun = process.argv.includes('--dry-run')

const edits = rewriteDeclarations({
  re: RE_SPACING,
  dryRun,
  skip: SKIP,
  mapValue: (value) =>
    value.replace(/(-?\d*\.?\d+)px/g, (match, raw) => {
      const px = Number(raw)
      const next = evenSpacing(px)
      bump(before, px)
      bump(after, next)
      return next === px ? match : `${next}px`
    }),
})

const distribution = (label, map) => {
  const rows = [...map].sort((a, b) => a[0] - b[0])
  const odd = rows.filter(([px]) => Math.abs(px) % 2 === 1).reduce((n, [, c]) => n + c, 0)
  const total = rows.reduce((n, [, c]) => n + c, 0)
  process.stdout.write(
    `\n  ${label}: ${rows.length} distinct value(s), ${total} number(s), ${odd} odd\n    `,
  )
  process.stdout.write(rows.map(([px, c]) => `${px}px x${c}`).join('  ') + '\n')
}

report(`codemod-spacing${dryRun ? ' (dry run)' : ''}`, edits)
distribution('before', before)
distribution('after ', after)
process.stdout.write(
  `\n  ${(before.get(1) ?? 0) + (before.get(-1) ?? 0)} site(s) left at ±1px on purpose ` +
    '(optical nudge / hairline compensation, not rhythm).\n' +
    `  ${SKIP.length} file(s) skipped by request: ${SKIP.join(', ') || '—'}\n`,
)
