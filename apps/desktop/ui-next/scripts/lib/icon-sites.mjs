// Finds every place the repo states an ICON SIZE, in the three channels it uses:
//
//   css     a `width` / `height` declaration on a rule whose key compound is an icon
//           (`.icn`, `svg`, or a class this file has SEEN applied to an icon element)
//   inline  `style="width: 13px; height: 13px"` on <Icon> / <svg> / a lucide component
//   size    `:size="15"` on a component imported from lucide-vue-next
//
// Why a shared module instead of the copy-paste the other guards use: deciding whether a
// rule sizes an icon or a dot/swatch/skeleton-bar is NOT a regex over the property name —
// it needs the template evidence collected by learnIconClasses(). Two independent copies
// of that would drift the first time someone renames a class, and a drifted classifier is
// worse than none: the codemod would rewrite sites the guard never checks. Both
// scripts/codemod-icon-scale.mjs and R5 of scripts/check-design-tokens.mjs read from here.
//
// Background: an icon on an ODD px size lands on a half pixel when it is centred inside a
// container of even height ((36 - 15) / 2 = 10.5), so its strokes never hit the device
// pixel grid and macOS paints them soft. Even sizes centre on whole pixels.
//
// Node only, zero dependencies.

import { readFileSync } from 'node:fs'
import { maskBlockComments, sourceFiles } from './css-sites.mjs'

// The icon scale — all even, so centring inside an even-height row is a whole pixel.
// 16 is the default (`.icn`): the sprite viewBox is 0 0 24 24, so at 16px the user-space
// stroke-width 1.5 renders as exactly 1 device pixel (1.5 x 16/24). Sizes outside the
// scale stay raw px; they only have to be even.
export const ICON_SCALE = [
  { px: 12, token: '--icon-xs' },
  { px: 14, token: '--icon-sm' },
  { px: 16, token: '--icon-md' },
  { px: 20, token: '--icon-lg' },
  { px: 24, token: '--icon-xl' },
]

// Above this a `width` is a panel, not an icon.
export const MAX_ICON_PX = 40

export const ICON_TOKENS = ICON_SCALE.map((s) => s.token)

/** Nearest even px, rounding UP so icons never shrink; a token when the scale has that step. */
export function iconTargetFor(px) {
  const even = px % 2 === 0 ? px : px + 1
  const step = ICON_SCALE.find((s) => s.px === even)
  return step ? `var(${step.token})` : `${even}px`
}

// Classes the learner cannot see, because nothing applies them with a literal `class=`.
const FORCE_ICON_CLASSES = new Set([
  'icn', // components/Icon.vue root — also learned, listed so a refactor there is loud
])

// Classes the learner DOES see on an icon but which are not an icon's own box.
const FORCE_NOT_ICON_CLASSES = new Set([
  'spin', // rotation modifier, shared with spinner spans
])

const TAG_RE = /<([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>'"])*?)\/?>/g
const LUCIDE_IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]lucide-vue-next['"]/g

/** Regions of a .vue that are NOT <script> / <style> — i.e. the template. `.css` is never a template. */
function templateRanges(relPath, masked) {
  if (!relPath.endsWith('.vue')) return []
  const blocked = [...masked.matchAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g)].map((m) => [
    m.index,
    m.index + m[0].length,
  ])
  const ranges = []
  let cursor = 0
  for (const [from, to] of blocked) {
    if (from > cursor) ranges.push([cursor, from])
    cursor = to
  }
  if (cursor < masked.length) ranges.push([cursor, masked.length])
  return ranges
}

/** Style-block bodies of a .vue; the whole file for a `.css`. */
function styleRanges(relPath, masked) {
  if (relPath.endsWith('.css')) return [[0, masked.length]]
  return [...masked.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => {
    const bodyStart = m.index + m[0].indexOf('>') + 1
    return [bodyStart, bodyStart + m[1].length]
  })
}

const inRange = (ranges, pos) => ranges.some(([a, b]) => pos >= a && pos < b)

const lucideTagsIn = (src) =>
  new Set(
    [...src.matchAll(LUCIDE_IMPORT_RE)]
      .flatMap((m) => m[1].split(','))
      .map((s) =>
        s
          .trim()
          .split(/\s+as\s+/)
          .pop(),
      )
      .filter(Boolean),
  )

const isIconTag = (tag, lucideTags) =>
  tag === 'Icon' || tag === 'svg' || tag === 'use' || lucideTags.has(tag)

/** Class names an attribute string puts on its element: static `class`, plus the literals
 *  and object keys of a bound `:class`. Interpolated names (`'x-' + kind`) are invisible
 *  here, which only ever costs us a skipped site. */
function classesIn(attrs) {
  const out = []
  const staticClass = /(?<![-:\w])class\s*=\s*"([^"]*)"/.exec(attrs)
  if (staticClass) out.push(...staticClass[1].split(/\s+/))
  const boundClass = /:class\s*=\s*"([^"]*)"/.exec(attrs)
  if (boundClass) {
    out.push(...[...boundClass[1].matchAll(/['"]([\w-]+)['"]/g)].map((m) => m[1]))
    out.push(...[...boundClass[1].matchAll(/(?:^|[{,\s])([\w-]+)\s*:/g)].map((m) => m[1]))
  }
  return out.filter((c) => /^[\w-]+$/.test(c))
}

/**
 * One pass over every template in scope, splitting class names into those only ever seen
 * on an icon element and those seen elsewhere too. A name used on both is ambiguous and
 * deliberately NOT an icon class — `.thumb`, `.spin` and friends would otherwise drag a
 * plain <span> into the rewrite.
 */
export function learnIconClasses() {
  const onIcon = new Set()
  const onOther = new Set()

  for (const { relPath, absPath } of sourceFiles()) {
    if (!relPath.endsWith('.vue')) continue
    const src = readFileSync(absPath, 'utf8')
    const masked = maskBlockComments(src)
    const ranges = templateRanges(relPath, masked)
    if (!ranges.length) continue
    const lucideTags = lucideTagsIn(src)

    for (const m of masked.matchAll(TAG_RE)) {
      if (!inRange(ranges, m.index)) continue
      const bucket = isIconTag(m[1], lucideTags) ? onIcon : onOther
      // Read the classes off the ORIGINAL text: masking blanks comments, and a class
      // attribute never spans one.
      for (const c of classesIn(src.slice(m.index, m.index + m[0].length))) bucket.add(c)
    }
  }

  const iconClasses = new Set(FORCE_ICON_CLASSES)
  for (const c of onIcon) if (!onOther.has(c) && !FORCE_NOT_ICON_CLASSES.has(c)) iconClasses.add(c)
  return iconClasses
}

/** Split a selector list on top-level commas — `:is(.a, .b)` must stay in one piece. */
function splitSelectorList(sel) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      parts.push(sel.slice(start, i))
      start = i + 1
    }
  }
  parts.push(sel.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** Does this single selector target an icon's own box? */
function selectorTargetsIcon(sel, iconClasses) {
  const flat = sel.replace(/::?v-deep|:deep/g, '')
  // Key (rightmost) compound: split on descendant / child / sibling combinators.
  const key = flat
    .split(/[\s>+~]+/)
    .filter(Boolean)
    .pop()
  if (!key) return false
  // A pseudo-element is a generated shape (`.tog::after` is a switch knob), never an icon.
  if (key.includes('::')) return false
  const base = key.split(':')[0].replace(/[()]/g, '')
  if (/(^|[^\w-])(svg|use)$/.test(base) || base === 'svg' || base === 'use') return true
  return [...base.matchAll(/\.([\w-]+)/g)].some((m) => iconClasses.has(m[1]))
}

const targetsIcon = (selectorList, iconClasses) => {
  const parts = splitSelectorList(selectorList)
  return parts.length > 0 && parts.every((p) => selectorTargetsIcon(p, iconClasses))
}

/** Selector of the innermost rule containing `pos`, or null. `floor` stops the walk at the
 *  start of the enclosing <style> body so a .vue never reads back into its template. */
function selectorAt(masked, pos, floor) {
  let depth = 0
  let open = -1
  for (let i = pos - 1; i >= floor; i--) {
    const c = masked[i]
    if (c === '}') depth++
    else if (c === '{') {
      if (depth === 0) {
        open = i
        break
      }
      depth--
    }
  }
  if (open < 0) return null
  let start = floor
  for (let i = open - 1; i >= floor; i--) {
    if (masked[i] === '{' || masked[i] === '}' || masked[i] === ';') {
      start = i + 1
      break
    }
  }
  return masked.slice(start, open).trim()
}

/** Name of the tag whose attribute list contains `pos`. */
function tagAt(masked, pos) {
  const open = masked.lastIndexOf('<', pos)
  if (open < 0) return null
  return /^<([A-Za-z][\w.-]*)/.exec(masked.slice(open, pos))?.[1] ?? null
}

const RE_BOX = /(?<![-\w])(width|height)\s*:\s*([^;}"'\n]+)/g
const RE_INLINE_STYLE = /(?<![-:\w])style\s*=\s*"([^"]*)"/g
const RE_SIZE_PROP = /(?<![-\w]):size\s*=\s*"(\d+)"/g

/**
 * Every icon-size site in one file, as `{ line, start, end, value, channel, context }`
 * where `[start, end)` are byte offsets into the ORIGINAL source of the value to rewrite.
 *
 * `value` is the raw text (`15px`, `var(--icon-md)`, …) — consumers decide what is legal,
 * so the codemod and the guard agree on WHERE an icon size is stated even though they
 * disagree on what to do about it.
 */
export function* iconSites(relPath, src, iconClasses) {
  const masked = maskBlockComments(src)
  const styles = styleRanges(relPath, masked)
  const templates = templateRanges(relPath, masked)
  const lucideTags = lucideTagsIn(src)
  const lineAt = (pos) => masked.slice(0, pos).split('\n').length

  // --- css: a width/height on a rule that targets an icon ---
  for (const [from, to] of styles) {
    const body = masked.slice(from, to)
    for (const m of body.matchAll(RE_BOX)) {
      const pos = from + m.index
      const selector = selectorAt(masked, pos, from)
      if (!selector || !targetsIcon(selector, iconClasses)) continue
      const value = m[2].trim()
      const start = pos + m[0].length - m[2].length + (m[2].length - m[2].trimStart().length)
      yield {
        line: lineAt(pos),
        start,
        end: start + value.length,
        value,
        prop: m[1],
        channel: 'css',
        context: selector.replace(/\s+/g, ' '),
      }
    }
  }

  if (!templates.length) return

  // --- inline: style="width: 13px; height: 13px" on an icon element ---
  for (const m of masked.matchAll(RE_INLINE_STYLE)) {
    if (!inRange(templates, m.index)) continue
    const tag = tagAt(masked, m.index)
    if (!tag || !isIconTag(tag, lucideTags)) continue
    const declFrom = m.index + m[0].length - 1 - m[1].length
    for (const d of m[1].matchAll(RE_BOX)) {
      const value = d[2].trim()
      const pos = declFrom + d.index
      const start = pos + d[0].length - d[2].length + (d[2].length - d[2].trimStart().length)
      yield {
        line: lineAt(pos),
        start,
        end: start + value.length,
        value,
        prop: d[1],
        channel: 'inline',
        context: `<${tag}>`,
      }
    }
  }

  // --- size: :size="15" on a lucide component (its own px prop; <Icon> has no such prop) ---
  for (const m of masked.matchAll(RE_SIZE_PROP)) {
    if (!inRange(templates, m.index)) continue
    const tag = tagAt(masked, m.index)
    if (!tag || !lucideTags.has(tag)) continue
    const start = m.index + m[0].length - 1 - m[1].length
    yield {
      line: lineAt(m.index),
      start,
      end: start + m[1].length,
      value: `${m[1]}px`,
      prop: 'size',
      channel: 'size',
      context: `<${tag}>`,
    }
  }
}
