// Puts every icon size on the even scale --icon-xs|sm|md|lg|xl (12/14/16/20/24).
// See docs/features/native-macos-polish.md §4 W9 and ADR 0079 D6.
//
// P7a made every LINE BOX a whole pixel; the elements still landing on a half pixel
// afterwards were almost all SVG icons: an odd icon (15px) centred in an even row (36px)
// sits at 10.5px, so with `stroke-width: 1.7` no stroke ever hits the device pixel grid.
// Even sizes centre on whole pixels.
//
// Rewrites, in the three channels scripts/lib/icon-sites.mjs knows about:
//   `width`/`height` on a rule whose key compound targets an icon
//   `style="width: 13px; height: 13px"` on <Icon> / <svg> / a lucide component
//   `:size="15"` on a lucide component
// Odd values round UP to the next even px (icons never shrink); a value that lands on a
// scale step becomes the token, everything else stays raw even px.
//
//   node scripts/codemod-icon-scale.mjs [--dry-run] [--verbose]
//
// Idempotent: `var(--icon-md)` maps to itself. Node only, zero dependencies.

import { readFileSync, writeFileSync } from 'node:fs'
import { isOptedOut, maskBlockComments, report, sourceFiles } from './lib/css-sites.mjs'
import {
  ICON_TOKENS,
  MAX_ICON_PX,
  iconSites,
  iconTargetFor,
  learnIconClasses,
} from './lib/icon-sites.mjs'

const dryRun = process.argv.includes('--dry-run')
const iconClasses = learnIconClasses()

const edits = []
const skipped = []
const warnings = []

for (const { relPath, absPath } of sourceFiles()) {
  const src = readFileSync(absPath, 'utf8')
  const rawLines = src.split('\n')
  const maskedLines = maskBlockComments(src).split('\n')
  const fileEdits = []

  for (const site of iconSites(relPath, src, iconClasses)) {
    const at = `${relPath}:${site.line}`
    if (ICON_TOKENS.some((t) => site.value.includes(t))) continue // already on the scale
    const px = /^(\d+)px$/.exec(site.value)
    if (!px) {
      // Anything else (`100%`, `auto`, `calc(...)`, a non-icon token) is intentional.
      if (/\d/.test(site.value))
        warnings.push(`${at}  ${site.prop}: ${site.value}  [${site.context}]`)
      continue
    }
    const n = Number(px[1])
    if (n === 0 || n > MAX_ICON_PX) continue
    if (isOptedOut(rawLines, maskedLines, site.line - 1)) {
      skipped.push(`${at}  ${site.prop}: ${site.value}  [${site.context}]`)
      continue
    }
    // `:size` is a bare number prop, not a CSS length: it takes the even px, never a token.
    const isSizeProp = site.channel === 'size'
    const current = isSizeProp ? String(n) : site.value
    const next = isSizeProp ? String(n % 2 === 0 ? n : n + 1) : iconTargetFor(n)
    if (next === current) continue
    fileEdits.push({ start: site.start, end: site.end, next })
    edits.push({ file: relPath, line: site.line, from: current, to: next })
  }

  if (!fileEdits.length || dryRun) continue
  let out = src
  for (const e of fileEdits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.next + out.slice(e.end)
  }
  writeFileSync(absPath, out)
}

report('codemod-icon-scale', edits, { warnings })
process.stdout.write(
  `\n  ${iconClasses.size} icon class(es) learned from templates` +
    `, ${skipped.length} site(s) kept by a design-token-ok marker\n`,
)
if (process.argv.includes('--verbose')) {
  for (const s of skipped) process.stdout.write(`    skip  ${s}\n`)
}
