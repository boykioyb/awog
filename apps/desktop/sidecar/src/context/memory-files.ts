// Memory files (CLAUDE.md / AGENTS.md) with `@import` expansion — ADR 0071.
//
// Before this module, `sessions.send-message` read the project-root CLAUDE.md
// verbatim and injected it as-is. That silently dropped the majority of this
// repo's own conventions: its CLAUDE.md carries its rules by REFERENCE —
//
//   @.claude/rules/principles.md
//   @.claude/rules/typescript.md
//   …
//
// — a syntax the Claude Code CLI expands and AWOG did not, so the model received
// the literal string `@.claude/rules/principles.md` (a path, not the content) and
// never saw a single project rule. This module expands those imports, and also
// loads the user-global `~/.claude/CLAUDE.md` that AWOG ignored entirely.
//
// Security (invariant #2 — path sanitize before filesystem I/O): an import path
// comes out of a workspace file, so it is L1-untrusted input. Reads are confined
// to an explicit two-root allowlist — the workspace root and the shared Claude
// home — via resolve + prefix check + realpath symlink-escape check. Anything
// else is refused and logged. Loading is best-effort throughout: a missing,
// unreadable, oversized, or out-of-bounds file is skipped, never thrown, because
// a malformed memory file must not break the user's turn.
import { readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { claudeHome } from '../util/path.js'
import { log } from '../util/logger.js'

// Top-level memory files, in ascending precedence. Project files come last so a
// project convention reads as the final word over a user-global one — the same
// order the Claude Code CLI applies.
const PROJECT_FILE_NAMES = ['CLAUDE.md', 'AGENTS.md'] as const

// Cap per top-level memory file, measured AFTER import expansion so a deep
// import chain cannot blow the prompt the way a single giant file cannot.
const MAX_FILE_CHARS = 64_000

// How many import hops to follow. A file importing a file importing a file… is
// legitimate two or three deep; beyond this it is a mistake or a cycle we did
// not catch, and stopping is better than reading the disk forever.
const MAX_IMPORT_DEPTH = 5

// Only a line that is ENTIRELY an import is expanded: optional indent, optional
// list marker, `@`, a path ending in `.md`. Deliberately strict — prose and code
// in these files is full of `@`-prefixed tokens (`@nuxt/eslint`, `@types/node`,
// npm scopes, email addresses), and the `.md` suffix plus whole-line anchoring is
// what keeps `@nuxt/eslint` from being read as a file path. An inline import is
// left alone by design; document the one-per-line form instead of loosening this.
const IMPORT_LINE_RE = /^\s*(?:[-*]\s+)?@(\S+\.md)\s*$/

// Fence toggles for the code-block skip. An import inside a fenced example is
// documentation ABOUT the syntax, not a request to inline a file.
const FENCE_RE = /^\s*(?:```|~~~)/

export interface MemoryFile {
  // Display label, also what the model cites. Relative for project files
  // (`CLAUDE.md`), `~`-prefixed for the user-global one.
  label: string
  // File content with every resolvable import expanded in place.
  content: string
}

// Resolve an import path against the importing file's directory, honouring the
// `~/` home shorthand and absolute paths. Returns the absolute candidate; the
// allowlist check happens separately in `isInsideAllowedRoot`.
function resolveImportPath(spec: string, fromDir: string): string {
  if (spec === '~' || spec.startsWith('~/')) return resolve(homedir(), spec.slice(2))
  if (isAbsolute(spec)) return resolve(spec)
  return resolve(fromDir, spec)
}

// True when `abs` sits inside one of the allowed roots, following symlinks. Read
// counterpart of git/path-sanitize.ts#assertInsideWorkspace, differing on two
// points: it accepts SEVERAL roots (the workspace plus the shared Claude home,
// which is legitimately outside the workspace), and it returns a boolean instead
// of throwing, because a bad import must skip rather than fail the turn.
async function isInsideAllowedRoot(abs: string, roots: readonly string[]): Promise<boolean> {
  const within = (path: string, root: string): boolean =>
    path === root || path.startsWith(root + sep)
  if (!roots.some((root) => within(abs, root))) return false
  // Symlink-escape check: compare real-vs-real so a root that is itself under a
  // symlink (macOS /tmp → /private/tmp, a symlinked home) does not false-deny.
  let real: string
  try {
    real = await realpath(abs)
  } catch {
    return false // missing / unreadable → nothing to inline anyway
  }
  for (const root of roots) {
    let realRoot: string
    try {
      // eslint-disable-next-line no-await-in-loop
      realRoot = await realpath(root)
    } catch {
      continue
    }
    if (within(real, realRoot)) return true
  }
  return false
}

// Read a memory file and expand its imports depth-first.
//
// `visited` holds the REAL paths already inlined on the current branch and is
// what makes a cycle (a → b → a) terminate; it is shared across the whole
// expansion of one top-level file so the same rule file is not inlined twice.
async function expandImports(
  abs: string,
  roots: readonly string[],
  visited: Set<string>,
  depth: number,
): Promise<string | undefined> {
  let real: string
  try {
    real = await realpath(abs)
  } catch {
    return undefined // missing → skip
  }
  if (visited.has(real)) return undefined
  visited.add(real)

  try {
    const st = await stat(real)
    if (!st.isFile()) return undefined
  } catch {
    return undefined
  }

  let raw: string
  try {
    raw = await readFile(real, 'utf8')
  } catch {
    return undefined
  }

  const dir = dirname(real)
  const out: string[] = []
  let inFence = false

  for (const line of raw.split('\n')) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    const match = inFence ? null : IMPORT_LINE_RE.exec(line)
    if (!match?.[1]) {
      out.push(line)
      continue
    }
    // Depth exhausted → keep the reference line so the model at least knows the
    // file exists, rather than silently losing the pointer.
    if (depth >= MAX_IMPORT_DEPTH) {
      log.warn('memory-files: import depth exceeded', { spec: match[1], from: real })
      out.push(line)
      continue
    }
    const spec = match[1]
    const target = resolveImportPath(spec, dir)
    // eslint-disable-next-line no-await-in-loop
    if (!(await isInsideAllowedRoot(target, roots))) {
      log.warn('memory-files: refusing import outside allowed roots', { spec, from: real })
      out.push(line)
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    const nested = await expandImports(target, roots, visited, depth + 1)
    if (nested === undefined) {
      // Unreadable or already inlined earlier — keep the reference, drop nothing.
      out.push(line)
      continue
    }
    // Wrap the inlined content in its own labelled block so provenance survives:
    // the model can cite the rule file it actually read, not the file that
    // imported it (which is the whole point of the evidence contract).
    out.push(`<imported-file path="${spec}">\n${nested}\n</imported-file>`)
  }

  return out.join('\n')
}

// Load every memory file in scope, imports expanded.
//
// `cwd` is the session's working directory (absent when no project is bound, in
// which case only the user-global file applies). Never throws.
export async function loadMemoryFiles(cwd: string | undefined): Promise<MemoryFile[]> {
  const home = claudeHome()
  const roots = cwd ? [resolve(cwd), home] : [home]
  const files: MemoryFile[] = []

  // Candidates in ascending precedence: user-global first, then project.
  const candidates: { label: string; abs: string }[] = [
    { label: '~/.claude/CLAUDE.md', abs: resolve(home, 'CLAUDE.md') },
  ]
  if (cwd) {
    for (const name of PROJECT_FILE_NAMES) {
      candidates.push({ label: name, abs: resolve(cwd, name) })
    }
  }

  for (const { label, abs } of candidates) {
    // Each top-level file gets a FRESH visited set: a rule file imported by both
    // the global and the project CLAUDE.md should appear under each, since the
    // two blocks are read as separate instruction sources.
    // eslint-disable-next-line no-await-in-loop
    if (!(await isInsideAllowedRoot(abs, roots))) continue
    // eslint-disable-next-line no-await-in-loop
    const content = await expandImports(abs, roots, new Set<string>(), 0)
    if (content === undefined) continue
    // Over the cap the tail is dropped — SAY SO, in the block and in the log. A
    // silent cut mid-sentence reads to the model as a complete instruction file, so
    // whatever sits past the cut (often the security / testing / troubleshooting
    // sections at the end) is not merely absent, it is invisibly absent: the model
    // answers as if those rules did not exist and nobody can tell why.
    let trimmed = content
    if (content.length > MAX_FILE_CHARS) {
      trimmed =
        `${content.slice(0, MAX_FILE_CHARS)}\n\n` +
        `[TRUNCATED: this file is ${content.length} characters after import expansion; ` +
        `only the first ${MAX_FILE_CHARS} are shown. Everything below the cut is MISSING ` +
        `from your context — say so rather than assuming the file ends here.]`
      log.warn('memory files: file over cap, tail dropped from the prompt', {
        label,
        chars: content.length,
        capChars: MAX_FILE_CHARS,
      })
    }
    if (trimmed.trim().length === 0) continue
    files.push({ label, content: trimmed })
  }

  return files
}
