// Codemod — pair every --fs-* font size with its --lh-* leading.
// docs/features/native-macos-polish.md §4 W3 · ADR 0079 D2.
//
// P2 put font-size on an integer scale, but `html,body{line-height:1.5}` was a UNITLESS
// coefficient: it multiplies by whatever font-size an element ends up with, so the
// integer type scale came straight back out as fractions (1.5 x 13px = 19.5px). Text
// whose line box is a half pixel gets a baseline off the device grid, and macOS renders
// that soft — the very blur the type scale was meant to remove.
//
// Two moves fix it. The global leading became an absolute length (assets/css/prototype.css
// `html,body{line-height:var(--lh-md)}`), which inherits as a LENGTH and so cannot be
// re-multiplied by a child's font-size. This script does the second: any rule that picks
// its own font-size off the scale also needs its own leading off the scale, or it keeps
// the 20px meant for 13px body text on 22px display text. Rules that pin font-size in px
// (badges, hint chips — deliberately outside Appearance scaling) get the whole-pixel
// leading they already render, so their geometry does not move at all.
//
//   node scripts/codemod-line-height.mjs [--dry-run] [--verbose]
// Then `node scripts/check-design-tokens.mjs` must report 0 R4 violations.
//
// Node only, zero dependencies.

import { readFileSync, writeFileSync } from 'node:fs'

import { maskBlockComments, report, sourceFiles } from './lib/css-sites.mjs'

// One leading step per type step — the suffix carries the pairing, nothing to look up.
const LH_FOR_FS = {
  '--fs-xs': '--lh-xs', // 11px text → 16px line @base13
  '--fs-sm': '--lh-sm', // 12 → 18
  '--fs-md': '--lh-md', // 13 → 20 (body)
  '--fs-lg': '--lh-lg', // 15 → 22
  '--fs-xl': '--lh-xl', // 17 → 24
  '--fs-2xl': '--lh-2xl', // 22 → 28 (display text wants proportionally less air)
}

// The old global coefficient. A rule that pins its font-size in px opted out of
// Appearance scaling, so it cannot take a --lh-* token (those follow the base); it gets
// the SAME leading it renders today, just spelled as a whole pixel instead of computed
// from a coefficient. 12px x 1.5 = 18px exactly, which is 146 of the 152 such rules —
// badges, chips and count pills that would otherwise inherit the 20px meant for body text
// and grow 2px each.
const OLD_GLOBAL_COEFFICIENT = 1.5

const RE_FONT_SIZE_TOKEN = /(?<![\w-])font-size\s*:\s*var\(\s*(--fs-(?:xs|sm|md|lg|xl|2xl))\s*\)/
const RE_FONT_SIZE_PX = /(?<![\w-])font-size\s*:\s*(\d*\.?\d+)px\b/
const RE_LINE_HEIGHT = /(?<![\w-])line-height\s*:/
// Innermost `{ … }` only — a nested block (SFC `<style>` inside @media, SCSS nesting)
// contains no braces of its own, so this lands on real declaration lists and never on
// the @media wrapper.
const RE_BLOCK = /\{([^{}]*)\}/g
const RE_STYLE_TAG = /<style[^>]*>([\s\S]*?)<\/style>/g

/** CSS regions of a file as `{ body, offset }`: the whole thing for `.css`, each
 *  `<style>` block for `.vue`. Template markup is deliberately out of scope — an inline
 *  `:style` binding is not a rule and has no block to inspect. */
function cssRegions(relPath, masked) {
  if (relPath.endsWith('.css')) return [{ body: masked, offset: 0 }]
  return [...masked.matchAll(RE_STYLE_TAG)].map((m) => ({
    body: m[1],
    offset: m.index + m[0].indexOf(m[1]),
  }))
}

const skippedDeclared = []

/**
 * Where to splice, and what. Insertion goes right after the font-size VALUE so the
 * pair reads together, and it copies the surrounding shape: assets/css/prototype.css is
 * compact one-rule-per-line on purpose (excluded from Prettier), the rest is
 * Prettier-formatted one-declaration-per-line.
 */
function insertionFor(masked, blockStart, blockBody, fsMatch, leading) {
  const valueEnd = blockStart + fsMatch.index + fsMatch[0].length
  const compact = !blockBody.includes('\n')
  if (compact) return { at: valueEnd, text: `;line-height:${leading}` }
  const lineStart = masked.lastIndexOf('\n', blockStart + fsMatch.index) + 1
  const indent = /^[ \t]*/.exec(masked.slice(lineStart))[0]
  return { at: valueEnd, text: `;\n${indent}line-height: ${leading}` }
}

const edits = []
const dryRun = process.argv.includes('--dry-run')

for (const { relPath, absPath } of sourceFiles()) {
  const src = readFileSync(absPath, 'utf8')
  const masked = maskBlockComments(src)
  const fileEdits = []

  for (const region of cssRegions(relPath, masked)) {
    for (const block of region.body.matchAll(RE_BLOCK)) {
      const body = block[1]
      const token = RE_FONT_SIZE_TOKEN.exec(body)
      const px = token ? null : RE_FONT_SIZE_PX.exec(body)
      const fs = token ?? px
      if (!fs) continue
      const line = masked.slice(0, region.offset + block.index).split('\n').length
      if (RE_LINE_HEIGHT.test(body)) {
        // The rule states its own leading. Respect it — an explicit value is a decision,
        // and overwriting it silently would change layout the author tuned by eye. A
        // unitless one is still a half-pixel risk; the guard's R4 reports those.
        skippedDeclared.push(`${relPath}:${line}  keeps its own line-height`)
        continue
      }
      const blockStart = region.offset + block.index + 1
      const leading = token
        ? `var(${LH_FOR_FS[token[1]]})`
        : `${Math.round(Number(px[1]) * OLD_GLOBAL_COEFFICIENT)}px`
      fileEdits.push(insertionFor(masked, blockStart, body, fs, leading))
      edits.push({ file: relPath, line, from: `font-size: ${fs[1]}`, to: leading })
    }
  }

  if (!fileEdits.length || dryRun) continue
  let out = src
  for (const e of fileEdits.sort((a, b) => b.at - a.at)) {
    out = out.slice(0, e.at) + e.text + out.slice(e.at)
  }
  writeFileSync(absPath, out)
}

report('codemod-line-height', edits)
process.stdout.write(
  `\n  ${skippedDeclared.length} rule(s) already declare a line-height — left alone.\n`,
)
if (process.argv.includes('--verbose')) {
  for (const s of skippedDeclared) process.stdout.write(`    ${s}\n`)
}
