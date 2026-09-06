// Codemod — replace every UNITLESS line-height coefficient with a length.
// docs/features/native-macos-polish.md §4 W13 · ADR 0079 D2d.
//
// scripts/codemod-line-height.mjs paired --fs-* with --lh-* for rules that stated NO
// leading of their own. It deliberately left the rules that DID state one alone, because
// overwriting a number the author tuned by eye is a visual change. That backlog is what
// this script clears: 234 sites still carry a unitless coefficient, and a coefficient
// multiplies by whatever font-size the element resolves to, so it hands back the half
// pixel the type scale just removed (1.5 x 13px = 19.5px).
//
// `line-height: 1` is the same defect, not an exemption: it pins the line box TO the
// font-size, and 4 of the 6 --fs-* steps are odd at the default base (11 / 13 / 15 / 17).
// An even icon centred in an odd line box is back on a half pixel.
//
// TARGETS — the density rule comes first (see W10: rounding spacing DOWN cost 2px of
// height everywhere and had to be reverted). Nothing here may get SHORTER, so every
// value rounds UP, and a token is only accepted when it is >= the current line box.
// TOLERANCE_PX absorbs the case where a step sits a rounding hair below the current
// value (1.55 x 13 = 20.15 vs --lh-md 20) — a fifth of a pixel is under the device grid
// and is exactly the rounding this pass exists to do.
//
//   c <= TIGHT_MAX (1.25)  the author asked for the tightest possible box (badge, pill,
//                          chip, single-glyph close button, display number). A token
//                          would inflate it by up to 5px, so the target is a FIXED EVEN
//                          px — even at every Appearance base by construction.
//   font-size in px        the rule opted out of Appearance scaling, so its leading has
//                          to as well: fixed even px.
//   otherwise              the smallest --lh-* whose px @base13 does not shrink the line
//                          box. --lh-prose wins the 22px slot when c >= 1.6 (long-form
//                          intent, and prose >= lg at every base).
//
//   node scripts/codemod-line-height-coefficients.mjs [--dry-run] [--verbose]
// Then `node scripts/check-design-tokens.mjs` must report 0 R4 violations.
//
// Node only, zero dependencies.

import { readFileSync, writeFileSync } from 'node:fs'

import { isOptedOut, maskBlockComments, sourceFiles } from './lib/css-sites.mjs'

// html { font-size: var(--font-size-base) } — assets/css/app-shell.css. So 1rem = the
// Appearance base, and the default base is the reference column for every table below.
const BASE_PX = 13
const TIGHT_MAX = 1.25
const TOLERANCE_PX = 0.2

// px @base13 for each --fs-* step (declared as calc(base ± Npx), ADR 0079 D2).
const FS_PX = {
  '--fs-xs': BASE_PX - 2,
  '--fs-sm': BASE_PX - 1,
  '--fs-md': BASE_PX,
  '--fs-lg': BASE_PX + 2,
  '--fs-xl': BASE_PX + 4,
  '--fs-2xl': BASE_PX + 9,
}

// px @base13 for each --lh-* step (round(up, base * k, 2px), ADR 0079 D2c). Ascending —
// the picker walks it in order. `--lh-lg` and `--lh-prose` collide at 22 @base13 and
// diverge at the other bases (1.6 vs 1.65), so the coefficient picks between them.
const LH_LADDER = [
  { token: '--lh-xs', px: 16 },
  { token: '--lh-sm', px: 18 },
  { token: '--lh-md', px: 20 },
  { token: '--lh-lg', px: 22, prose: '--lh-prose' },
  { token: '--lh-xl', px: 24 },
  { token: '--lh-2xl', px: 28 },
]

const ceilEven = (px) => Math.ceil(px / 2) * 2

/** px @base13 of the font-size stated in the same rule, plus how it behaves under
 *  Appearance. `null` size = the rule inherits its font-size (or states `1em`, which is
 *  the same thing), so the body base is the only defensible reference. */
function resolveFontSize(rule) {
  const token = /(?<![\w-])font-size\s*:\s*var\(\s*(--fs-(?:xs|sm|md|lg|xl|2xl))\s*\)/.exec(rule)
  if (token) return { px: FS_PX[token[1]], scales: true }
  const px = /(?<![\w-])font-size\s*:\s*(\d*\.?\d+)px\b/.exec(rule)
  if (px) return { px: Number(px[1]), scales: false }
  // rem resolves off html's font-size, which IS the Appearance base.
  const rem = /(?<![\w-])font-size\s*:\s*(\d*\.?\d+)rem\b/.exec(rule)
  if (rem) return { px: Number(rem[1]) * BASE_PX, scales: true }
  // `1em` is a no-op (= the parent's size); any other em is relative to the parent, and
  // the parent is body-sized in every site here.
  const em = /(?<![\w-])font-size\s*:\s*(\d*\.?\d+)em\b/.exec(rule)
  if (em) return { px: Number(em[1]) * BASE_PX, scales: true }
  return { px: BASE_PX, scales: true, inherited: true }
}

function targetFor(coefficient, rule) {
  const fs = resolveFontSize(rule)
  const current = coefficient * fs.px

  if (coefficient <= TIGHT_MAX || !fs.scales) {
    return { value: `${ceilEven(current)}px`, px: ceilEven(current), current }
  }
  const step =
    LH_LADDER.find((s) => s.px >= current - TOLERANCE_PX) ?? LH_LADDER[LH_LADDER.length - 1]
  const token = step.prose && coefficient >= 1.6 ? step.prose : step.token
  return { value: `var(${token})`, px: step.px, current }
}

// Hand decisions the resolver cannot reach, keyed by the ORIGINAL file:line. Every entry
// must match a site or the script fails — a stale key means the reasoning below is about
// a rule that no longer exists.
//
// `keep` leaves the declaration and appends a `design-token-ok` marker so the guard stays
// green; `drop` deletes the declaration outright.
const OVERRIDES = new Map([
  [
    'assets/css/app-shell.css:330',
    // .dh .dt > .dttitle inherits font-size from `.dh .dt` (--fs-lg, 15px), not from the
    // body, so the resolver's 13px reference is 2px short: 1.25 x 15 = 18.75.
    { value: 'var(--lh-md)', current: 18.75, note: 'inherits --fs-lg from .dh .dt, not the body' },
  ],
  [
    'assets/css/prototype.css:392',
    { value: 'var(--lh-2xl)', note: '.ftree — 2.1 is literally what --lh-2xl means' },
  ],
  [
    'assets/css/prototype.css:527',
    { value: 'var(--lh-2xl)', note: '.ftree (workspace copy) — same rule, same target' },
  ],
  [
    'assets/css/theme-cute.css:224',
    // The Cute family re-declares the GLOBAL body leading as a coefficient, on top of
    // `html,body{line-height:var(--lh-md)}`. 1.55 x 13 = 20.15 vs 20: the override buys
    // 0.15px and costs the whole family its parity. Dropping it inherits --lh-md.
    { drop: true, note: 'redundant global override of html,body line-height' },
  ],
  [
    'assets/css/theme-cute.css:827',
    // Decorative opening-quote glyph: position:absolute, single character, nothing is
    // centred against it. A length would move the mark relative to its own `top: 2px`.
    {
      keep: true,
      note: 'decorative ::before glyph, absolutely positioned — the line box IS the glyph box',
    },
  ],
  [
    'components/common/PreviewModal.vue:821',
    // 0 kills the inline strut so the frame measures exactly the image, which is what the
    // translate(-50%,-50%) centring above it depends on. Not a text line box.
    { keep: true, note: 'line-height: 0 removes the inline strut around the <img>' },
  ],
  [
    'components/connection/SourceAvatar.vue:129',
    // font-size is bound inline (`GLYPH_PX` = 13 / 16 / 22 px), so the rule cannot state a
    // matching px. The avatar is a fixed even square with place-items:center, so any even
    // line box centres on a whole pixel — and 13px would not.
    {
      value: 'var(--lh-xs)',
      current: null,
      note: 'font-size comes from an inline binding (13/16/22px)',
    },
  ],
  [
    'components/git/GitCommitDetail.vue:85',
    // Inline override on `.ftree` (--fs-sm): 2 x 12 = 24, which --lh-xl matches exactly.
    {
      value: 'var(--lh-xl)',
      current: 24,
      note: 'inline tightening of .ftree (--fs-sm): 2 x 12 = 24',
    },
  ],
])

const RE_LINE_HEIGHT = /(?<![\w-])line-height\s*:\s*(\d*\.?\d+)\s*(?=[;}"'\n])/g
const RE_STYLE_TAG = /<style[^>]*>([\s\S]*?)<\/style>/g

/** Byte ranges of the CSS regions of a file: the whole thing for `.css`, each `<style>`
 *  block for `.vue`. Everything else is template markup, where a `line-height` can only
 *  live inside a `style="…"` attribute. */
function styleRanges(relPath, masked) {
  if (relPath.endsWith('.css')) return [[0, masked.length]]
  return [...masked.matchAll(RE_STYLE_TAG)].map((m) => {
    const start = m.index + m[0].indexOf(m[1])
    return [start, start + m[1].length]
  })
}

/** The declaration list the site belongs to, as one string — a CSS rule body inside
 *  `<style>`, or the `style="…"` attribute value in markup. Used to find the font-size
 *  the coefficient multiplies, and to report the selector. */
function context(masked, at, inStyle) {
  const openers = inStyle ? '{' : '"\''
  let from = at
  while (from > 0 && !openers.includes(masked[from - 1])) from--
  const closers = inStyle ? '}' : '"\''
  let to = at
  while (to < masked.length && !closers.includes(masked[to])) to++
  return masked.slice(from, to)
}

function selectorOf(masked, at, inStyle) {
  if (!inStyle) return '[inline style]'
  let brace = at
  while (brace > 0 && masked[brace - 1] !== '{') brace--
  let from = brace - 1
  while (from > 0 && !'{};'.includes(masked[from - 1])) from--
  return masked
    .slice(from, brace - 1)
    .trim()
    .replace(/\s+/g, ' ')
}

const dryRun = process.argv.includes('--dry-run')
const rows = []
const usedOverrides = new Set()

for (const { relPath, absPath } of sourceFiles()) {
  const src = readFileSync(absPath, 'utf8')
  const masked = maskBlockComments(src)
  const rawLines = src.split('\n')
  const maskedLines = masked.split('\n')
  const ranges = styleRanges(relPath, masked)
  const fileEdits = []

  for (const m of masked.matchAll(RE_LINE_HEIGHT)) {
    const valueStart = m.index + m[0].length - m[1].length
    const line = masked.slice(0, m.index).split('\n').length
    if (isOptedOut(rawLines, maskedLines, line - 1)) continue

    const inStyle = ranges.some(([a, b]) => m.index >= a && m.index < b)
    const rule = context(masked, m.index, inStyle)
    const coefficient = Number(m[1])
    const key = `${relPath}:${line}`
    const override = OVERRIDES.get(key)
    if (override) usedOverrides.add(key)

    const auto = targetFor(coefficient, rule)
    const row = {
      file: relPath,
      line,
      selector: selectorOf(masked, m.index, inStyle),
      from: `${coefficient}`,
      current: override && 'current' in override ? override.current : auto.current,
      note: override?.note,
    }

    if (override?.keep) {
      // Marker goes on the declaration's own line; check-design-tokens.mjs reads either
      // the line itself or the comment block directly above it.
      const eol = masked.indexOf('\n', m.index)
      fileEdits.push({
        start: eol < 0 ? masked.length : eol,
        end: eol < 0 ? masked.length : eol,
        next: ` /* design-token-ok: ${override.note}. */`,
      })
      rows.push({ ...row, to: `${coefficient} (kept)`, px: auto.current })
      continue
    }

    if (override?.drop) {
      // Swallow the whole declaration plus its separator and the blank line it leaves.
      let start = m.index
      while (start > 0 && ' \t'.includes(masked[start - 1])) start--
      let end = valueStart + m[1].length
      while (end < masked.length && ' \t'.includes(masked[end])) end++
      if (masked[end] === ';') end++
      if (masked[start - 1] === '\n' && masked[end] === '\n') end++
      else if (masked[start - 1] === '\n') start--
      fileEdits.push({ start, end, next: '' })
      rows.push({ ...row, to: '(dropped)', px: null })
      continue
    }

    const target = override?.value ? { ...auto, value: override.value } : auto
    const px = override?.value
      ? (LH_LADDER.find((s) => override.value.includes(s.token))?.px ??
        Number(/(\d+)px/.exec(override.value)?.[1]))
      : target.px
    if (target.value === m[1]) continue
    fileEdits.push({ start: valueStart, end: valueStart + m[1].length, next: target.value })
    rows.push({ ...row, to: target.value, px })
  }

  if (!fileEdits.length || dryRun) continue
  let out = src
  for (const e of fileEdits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.next + out.slice(e.end)
  }
  writeFileSync(absPath, out)
}

// Once the pass has landed there are no unitless coefficients left, so EVERY key is
// stale — that is the idempotent state, not an error. Only complain while there is still
// something to rewrite, which is when a bad key would actually silence a decision.
const stale = rows.length ? [...OVERRIDES.keys()].filter((k) => !usedOverrides.has(k)) : []
if (stale.length) {
  process.stdout.write(`\nSTALE OVERRIDE KEY(S) — no site there:\n  ${stale.join('\n  ')}\n`)
  process.exit(1)
}

const delta = (r) => (r.px == null ? null : Math.round((r.px - r.current) * 100) / 100)
const grew = rows.filter((r) => (delta(r) ?? 0) > 0)
const shrank = rows.filter((r) => (delta(r) ?? 0) < 0)

if (process.argv.includes('--verbose')) {
  for (const r of rows.sort((a, b) => (delta(b) ?? 0) - (delta(a) ?? 0))) {
    const d = delta(r)
    process.stdout.write(
      `  ${(d == null ? '   —' : (d > 0 ? '+' : '') + d).padStart(6)}  ` +
        `${String(r.current).padStart(6)} → ${String(r.px ?? 'inherit').padStart(7)}  ` +
        `${r.from.padEnd(5)} → ${r.to.padEnd(16)}  ${r.file}:${r.line}  ${r.selector}` +
        `${r.note ? `   [${r.note}]` : ''}\n`,
    )
  }
}

process.stdout.write(
  `\ncodemod-line-height-coefficients: ${rows.length} site(s)` +
    `${dryRun ? ' (dry run)' : ' rewritten'}\n` +
    `  ${grew.length} line box(es) grew, ${shrank.length} shrank, ` +
    `${rows.length - grew.length - shrank.length} unchanged in height\n`,
)
if (shrank.length) {
  process.stdout.write('  shrinking sites (must all be within the tolerance):\n')
  for (const r of shrank) {
    process.stdout.write(`    ${delta(r)}px  ${r.file}:${r.line}  ${r.selector}\n`)
  }
}
