// Shared scanning core for the design-token codemods (scripts/codemod-radius.mjs,
// scripts/codemod-type-scale.mjs) — see docs/features/native-macos-polish.md §4 W3/W4
// and docs/decisions/0079-native-macos-shell-and-design-tokens.md D1.
//
// File scope, extensions, skip-list and comment masking MUST stay identical to
// scripts/check-design-tokens.mjs. If they drift, the guard reports sites the codemod
// never visits (or the codemod rewrites sites the guard never checks), which is exactly
// the failure mode the codemod exists to prevent. They are duplicated rather than
// imported so the guard stays a single self-contained file; keep them in sync by hand.
//
// Node only, zero dependencies.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

const SCAN_DIRS = ['components', 'layouts', 'pages', 'assets/css']
const SCAN_EXT = ['.vue', '.css']

// Generated vendor stylesheet (scripts/inline-katex-fonts.mjs): hundreds of compact
// `font-size:<n>em` declarations that are KaTeX's scale, not ours.
const SKIP_FILES = new Set(['assets/css/katex.css'])

/** Blank out `/* … *\/` comments with spaces — same length, same newlines, so byte
 *  offsets and line numbers still line up with the original source. Prose that merely
 *  *mentions* a declaration (e.g. WorkspaceTerminal.vue talking about `border-radius: 0`)
 *  must never be rewritten. */
export const maskBlockComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      yield* walk(abs)
      continue
    }
    if (SCAN_EXT.some((ext) => entry.endsWith(ext))) yield abs
  }
}

/** Every in-scope file as `{ relPath, absPath }`, in a stable order. */
// A declaration opts out of tokenisation with a `design-token-ok: <reason>` marker on
// its own line, or in the comment block sitting directly above it. Used where the raw
// px IS the geometry — a text caret, a 9px legend square, the near-square corner that
// forms a speech-bubble tail — and a token radius would change the shape.
export const OPT_OUT = 'design-token-ok'

export function isOptedOut(rawLines, maskedLines, index) {
  if (rawLines[index]?.includes(OPT_OUT)) return true
  // Walk up through the comment block above: masking blanks a comment-only line, so
  // any line with code on it (or a blank separator) ends the block.
  for (let i = index - 1; i >= 0; i--) {
    if (maskedLines[i].trim() !== '') return false
    if (rawLines[i].includes(OPT_OUT)) return true
    if (rawLines[i].trim() === '') return false
  }
  return false
}

export function* sourceFiles() {
  for (const dir of SCAN_DIRS) {
    for (const absPath of walk(join(ROOT, dir))) {
      const relPath = relative(ROOT, absPath).split(sep).join('/')
      if (SKIP_FILES.has(relPath)) continue
      yield { relPath, absPath }
    }
  }
}

/**
 * Rewrite every declaration matching `re` (a global regex capturing the property in
 * group 1 and its value in group 2, with the value as the trailing part of the match).
 *
 * Matching runs against the comment-masked source; the replacement is spliced into the
 * ORIGINAL text at the same offsets, back to front. Nothing else is touched — no
 * reformatting — because assets/css/prototype.css is deliberately kept in its compact
 * one-rule-per-line shape and is excluded from Prettier.
 *
 * `mapValue(value, at)` returns the new value, or the value unchanged to skip.
 * Returns the list of applied edits.
 */
export function rewriteDeclarations({ re, mapValue, dryRun = false }) {
  const edits = []

  for (const { relPath, absPath } of sourceFiles()) {
    const src = readFileSync(absPath, 'utf8')
    const masked = maskBlockComments(src)
    const fileEdits = []

    for (const m of masked.matchAll(re)) {
      const value = m[2]
      const start = m.index + m[0].length - value.length
      const at = { file: relPath, line: masked.slice(0, start).split('\n').length }
      const next = mapValue(value, at)
      if (next === value) continue
      fileEdits.push({ start, end: start + value.length, next })
      edits.push({ ...at, prop: m[1], from: value, to: next })
    }

    if (!fileEdits.length || dryRun) continue
    let out = src
    for (const e of fileEdits.reverse()) out = out.slice(0, e.start) + e.next + out.slice(e.end)
    writeFileSync(absPath, out)
  }

  return edits
}

/** `--verbose` prints every edit; otherwise a per-directory roll-up. */
export function report(name, edits, { warnings = [] } = {}) {
  const verbose = process.argv.includes('--verbose')
  const byDir = new Map()
  for (const e of edits) {
    const dir = e.file.split('/').slice(0, -1).join('/')
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1)
  }

  if (verbose) for (const e of edits) process.stdout.write(`  ${e.file}:${e.line}  ${e.from}\n`)

  process.stdout.write(`\n${name}: ${edits.length} site(s) rewritten\n`)
  for (const [dir, n] of [...byDir].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${String(n).padStart(4)}  ${dir}/\n`)
  }
  if (warnings.length) {
    process.stdout.write(`\n  WARNING — ${warnings.length} site(s) need a human look:\n`)
    for (const w of warnings) process.stdout.write(`    ${w}\n`)
  }
}
