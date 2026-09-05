// Filesystem AgentTools for the Pi runtime (ADR 0029). Names + arg-keys mirror
// Claude Code EXACTLY so step-mapper.ts / trace-mapper.ts / Workspace Panel need
// no changes (Read/Write/Edit/Grep/Glob; file_path/content/old_string/new_string/
// pattern). All file I/O is gated by assertInsideWorkspace (security invariant
// #2) and scoped to the session cwd. Content search runs through search-backend.ts
// (ripgrep first, git grep as fallback); file lookup uses git ls-files with a
// bounded filesystem walk outside a repo (glob-backend.ts).

import { readFile, writeFile, stat, mkdir, open } from 'node:fs/promises'
import { dirname, extname } from 'node:path'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { assertInsideWorkspace } from '../../git/path-sanitize.js'
import { runGit } from '../../git/runner.js'
import { buildUnifiedDiff } from './text-diff.js'
import { clampForLlm } from './output-budget.js'
import { runGrep, type GrepOutputMode } from './search-backend.js'
import { gateError, statForGate, type ReadRegistry } from './read-registry.js'
import { sortByMtime, walkGlob } from './glob-backend.js'

// Caps mirror the fs.* RPC methods so the runtime can't push pathological
// payloads through the model/IPC path.
// Read returns a WINDOW, not a whole file: at most this many lines per call, each
// clamped, so one Read of a large file cannot swallow a turn's context.
const READ_DEFAULT_LINE_LIMIT = 2_000
const READ_MAX_LINE_CHARS = 2_000
// Heap ceiling on how much of a file we will decode at all. Distinct from the
// line window: we decode up to this much so that a large `offset` still resolves
// to the correct line.
const READ_HARD_MAX_BYTES = 8 * 1024 * 1024
// Base64 inflates by ~4/3; keep the encoded image comfortably under the 5MB most
// providers accept for an inline image part.
const IMAGE_MAX_BYTES = 3_500_000
const WRITE_MAX_BYTES = 8 * 1024 * 1024
const GLOB_TIMEOUT_MS = 15_000
const GREP_MAX_LINES = 500
const GLOB_MAX_FILES = 500
// rtk mindset (output-budget.ts): cap grep/glob output by BYTES, not just lines.
// A single minified/vendored line can be megabytes — the 500-line cap alone let a
// `Grep` over a non-repo's node_modules return ~8MB and blow a turn to 5.1M tokens.
const GREP_MAX_LINE_CHARS = 1_000
const GREP_MAX_OUTPUT_CHARS = 64 * 1024
const GLOB_MAX_OUTPUT_CHARS = 32 * 1024
// `diff`/`newContent` ride on Edit/MultiEdit results as a side channel (NOT in
// the model-facing `content` text) so step-mapper can render a git-style diff +
// full-file view in the step detail. See runtime/event-adapter.ts.
type ToolDetails = {
  path?: string
  command?: string
  diff?: string
  newContent?: string
}
type TextResult = AgentToolResult<ToolDetails>

function textResult(text: string, details: ToolDetails): TextResult {
  return { content: [{ type: 'text', text }], details }
}

// Normalise a workspace-relative subdir scope into a clean pathspec prefix:
// strip a leading `./` and trailing slashes. Returns '' when the input collapses
// to the workspace root (treated as "no scope" by callers).
function normalizeDir(path: string): string {
  return path.replace(/^\.\/+/, '').replace(/\/+$/, '')
}

// ─── Read ──────────────────────────────────────────────────────────────────
// Returns `cat -n`-style numbered lines (Claude Code Read format) so the model
// can reference line numbers for subsequent Edits.
//
// Windowing matters here. Claude Code returns at most 2000 lines per call and
// clamps each line; AWOG previously returned EVERY line up to a byte ceiling, so
// one Read of an 8000-line file swallowed a turn's whole context. Worse, the
// byte ceiling was applied to the buffer BEFORE lines were sliced, so an
// `offset` pointing past that ceiling produced an empty result — the model read
// "nothing there" as a fact about the file. Decode first, slice lines second.
const ReadParams = Type.Object({
  file_path: Type.String({ description: 'Absolute or workspace-relative file path to read.' }),
  offset: Type.Optional(Type.Number({ description: '1-based line to start from.' })),
  limit: Type.Optional(Type.Number({ description: 'Max number of lines to return.' })),
})

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

interface ReadWindow {
  text: string
  shown: number
  total: number
  nextOffset: number | null
}

// Slice [offset, offset+limit) out of `content`, number the lines `cat -n`-style
// and clamp any single line that is long enough to be a minified bundle.
function readWindow(content: string, offset: number, limit: number): ReadWindow {
  const lines = content.split('\n')
  const start = Math.max(0, offset - 1)
  const end = Math.min(lines.length, start + limit)
  const out: string[] = []
  for (let i = start; i < end; i++) {
    const raw = lines[i]
    const line =
      raw.length > READ_MAX_LINE_CHARS
        ? `${raw.slice(0, READ_MAX_LINE_CHARS)}…(line truncated)`
        : raw
    // Right-align line numbers in a 6-wide gutter + tab, matching `cat -n`.
    out.push(`${String(i + 1).padStart(6)}\t${line}`)
  }
  return {
    text: out.join('\n'),
    shown: Math.max(0, end - start),
    total: lines.length,
    nextOffset: end < lines.length ? end + 1 : null,
  }
}

export function createReadTool(cwd: string, reads: ReadRegistry): AgentTool<typeof ReadParams> {
  return {
    name: 'Read',
    label: 'Read',
    description: [
      'Read a file from the workspace. Returns the contents with line numbers (`cat -n` format, 1-indexed) — cite those numbers as `path:line` when you reference what you read.',
      '',
      '- `file_path` must resolve inside the working directory; absolute or workspace-relative.',
      `- Returns at most ${READ_DEFAULT_LINE_LIMIT} lines per call. When a file is longer the result says so and gives you the next \`offset\` — pass \`offset\`/\`limit\` to walk it, or better, Grep to find the region you actually need instead of paging through the whole file.`,
      '- Images (png/jpg/gif/webp) come back as an image you can actually look at. Other binary files return a placeholder, not their bytes.',
      '- Read a file BEFORE you Edit or overwrite it. Both refuse to run against a file you have not read, and against one that changed on disk since you read it.',
      '- Do NOT re-read a file to check that a Write or Edit landed. A failed write returns an error, so a call that succeeded quietly did what it said.',
    ].join('\n'),
    parameters: ReadParams,
    async execute(_id, params): Promise<TextResult> {
      const abs = assertInsideWorkspace(cwd, params.file_path)
      const st = await stat(abs)
      if (st.isDirectory()) throw new Error(`Path is a directory: ${params.file_path}`)

      const ext = extname(abs).toLowerCase()
      const imageMime = IMAGE_MIME_BY_EXT[ext]
      if (imageMime !== undefined) {
        if (st.size > IMAGE_MAX_BYTES) {
          throw new Error(
            `Image too large to read (${st.size} bytes > ${IMAGE_MAX_BYTES}). Resize it first.`,
          )
        }
        const bytes = await readFile(abs)
        // Register it: an image is "seen", so a later Write to the same path is
        // a deliberate replacement rather than a blind clobber.
        reads.markRead(abs, { mtimeMs: st.mtimeMs, size: st.size })
        return {
          content: [{ type: 'image', data: bytes.toString('base64'), mimeType: imageMime }],
          details: { path: params.file_path },
        }
      }

      // Read at most READ_HARD_MAX_BYTES so a pathological file can't blow the
      // heap, but decode ALL of what we read before slicing lines — that is what
      // makes a large `offset` resolve to the right line instead of nothing.
      const oversize = st.size > READ_HARD_MAX_BYTES
      let buf: Buffer
      if (oversize) {
        const handle = await open(abs, 'r')
        try {
          buf = Buffer.alloc(READ_HARD_MAX_BYTES)
          const { bytesRead } = await handle.read(buf, 0, READ_HARD_MAX_BYTES, 0)
          buf = buf.subarray(0, bytesRead)
        } finally {
          await handle.close()
        }
      } else {
        buf = await readFile(abs)
      }

      if (buf.includes(0)) {
        return textResult('[binary file — contents omitted]', { path: params.file_path })
      }

      reads.markRead(abs, { mtimeMs: st.mtimeMs, size: st.size })

      const content = buf.toString('utf8')
      if (content.length === 0) {
        return textResult('[file is empty — 0 bytes]', { path: params.file_path })
      }

      const window = readWindow(content, params.offset ?? 1, params.limit ?? READ_DEFAULT_LINE_LIMIT)
      if (window.shown === 0) {
        return textResult(
          `[no lines at offset ${params.offset ?? 1} — the file has ${window.total} lines]`,
          { path: params.file_path },
        )
      }
      const notes: string[] = []
      if (window.nextOffset !== null) {
        notes.push(
          `…showing lines ${params.offset ?? 1}-${(params.offset ?? 1) + window.shown - 1} of ${window.total}. Continue with offset ${window.nextOffset}.`,
        )
      }
      if (oversize) {
        notes.push(`(file is larger than ${READ_HARD_MAX_BYTES} bytes; only the first part was read)`)
      }
      const suffix = notes.length > 0 ? `\n${notes.join(' ')}` : ''
      return textResult(window.text + suffix, { path: params.file_path })
    },
  }
}

// ─── Write ─────────────────────────────────────────────────────────────────
const WriteParams = Type.Object({
  file_path: Type.String({ description: 'Absolute or workspace-relative file path to write.' }),
  content: Type.String({ description: 'Full file contents to write (overwrites).' }),
})

export function createWriteTool(cwd: string, reads: ReadRegistry): AgentTool<typeof WriteParams> {
  return {
    name: 'Write',
    label: 'Write',
    description: [
      'Create a file, or overwrite an existing one, with exactly the content given. Missing parent directories are created.',
      '',
      '- This replaces the ENTIRE file: anything not present in `content` is gone. To change part of a file use Edit, which cannot silently drop the rest.',
      '- Overwriting an existing file you have not Read in this conversation is REFUSED, as is overwriting one that changed on disk since you read it. Creating a new file needs no prior Read.',
      `- Refuses a path that is a directory, a path outside the working directory, and content over ${WRITE_MAX_BYTES} bytes.`,
    ].join('\n'),
    parameters: WriteParams,
    async execute(_id, params): Promise<TextResult> {
      const abs = assertInsideWorkspace(cwd, params.file_path)
      const bytes = Buffer.byteLength(params.content, 'utf8')
      if (bytes > WRITE_MAX_BYTES) throw new Error(`File too large to write (> ${WRITE_MAX_BYTES} bytes)`)
      // Gate BEFORE writing: 'ok' also covers a path that does not exist yet,
      // where there is nothing to clobber (statForGate returns null).
      const current = await statForGate(abs, params.file_path)
      const gate = reads.gate(abs, current)
      if (gate !== 'ok') throw gateError(gate, params.file_path, 'overwrite')

      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, params.content, 'utf8')
      // The model authored this exact content, so it is current for a follow-up
      // Edit in the same turn — no round-trip through Read to prove it.
      const after = await stat(abs)
      reads.markRead(abs, { mtimeMs: after.mtimeMs, size: after.size })
      return textResult(`Wrote ${bytes} bytes to ${params.file_path}`, { path: params.file_path })
    },
  }
}

// ─── Edit ──────────────────────────────────────────────────────────────────
// Exact-match string replace. Requires old_string to appear in the file; by
// default it must be unique (replace_all flips that). Matches Claude Code Edit
// semantics so step-mapper's pickDiffStats(old_string/new_string) is accurate.
const EditParams = Type.Object({
  file_path: Type.String({ description: 'Absolute or workspace-relative file path to edit.' }),
  old_string: Type.String({ description: 'Exact text to replace (must exist in the file).' }),
  new_string: Type.String({ description: 'Replacement text.' }),
  replace_all: Type.Optional(
    Type.Boolean({ description: 'Replace every occurrence instead of requiring uniqueness.' }),
  ),
})

function applyEdit(
  content: string,
  params: { old_string: string; new_string: string; replace_all?: boolean },
): string {
  if (params.old_string === params.new_string) {
    throw new Error('old_string and new_string are identical — no change')
  }
  const idx = content.indexOf(params.old_string)
  if (idx === -1) throw new Error('old_string not found in file')
  if (params.replace_all) {
    return content.split(params.old_string).join(params.new_string)
  }
  const second = content.indexOf(params.old_string, idx + params.old_string.length)
  if (second !== -1) {
    throw new Error('old_string is not unique — pass replace_all or add more context')
  }
  return content.slice(0, idx) + params.new_string + content.slice(idx + params.old_string.length)
}

// Shared pre-flight for Edit/MultiEdit: the file must exist, be text, have been
// read, and be unchanged since that read. Returns its current content.
async function openForEdit(
  cwd: string,
  reads: ReadRegistry,
  filePath: string,
): Promise<{ abs: string; before: string }> {
  const abs = assertInsideWorkspace(cwd, filePath)
  const current = await statForGate(abs, filePath)
  if (current === null) throw new Error(`File not found: ${filePath}`)
  const gate = reads.gate(abs, current)
  if (gate !== 'ok') throw gateError(gate, filePath, 'edit')
  const buf = await readFile(abs)
  if (buf.includes(0)) throw new Error('Cannot edit a binary file')
  return { abs, before: buf.toString('utf8') }
}

// Persist an edit result and re-register the file at its new state.
async function commitEdit(
  abs: string,
  reads: ReadRegistry,
  next: string,
): Promise<void> {
  await writeFile(abs, next, 'utf8')
  const after = await stat(abs)
  reads.markRead(abs, { mtimeMs: after.mtimeMs, size: after.size })
}

export function createEditTool(cwd: string, reads: ReadRegistry): AgentTool<typeof EditParams> {
  return {
    name: 'Edit',
    label: 'Edit',
    description: [
      'Replace an exact string in a file. This is the default way to change existing code.',
      '',
      '- `old_string` must match the file byte-for-byte, including indentation. Strip the line-number prefix that Read adds before matching.',
      '- `old_string` must be unique in the file unless `replace_all` is true. Include enough surrounding lines to make it unique rather than reaching for `replace_all`.',
      '- Read the file first: editing a file you have not read in this conversation is REFUSED, as is editing one that changed on disk since you read it.',
      '- When you have several changes to the SAME file, use MultiEdit so they apply atomically instead of one failing halfway through.',
    ].join('\n'),
    parameters: EditParams,
    async execute(_id, params): Promise<TextResult> {
      const { abs, before } = await openForEdit(cwd, reads, params.file_path)
      const next = applyEdit(before, params)
      await commitEdit(abs, reads, next)
      return textResult(`Edited ${params.file_path}`, {
        path: params.file_path,
        diff: buildUnifiedDiff(before, next),
        newContent: next,
      })
    },
  }
}

// ─── MultiEdit ───────────────────────────────────────────────────────────────
// Apply a sequence of exact-match edits to ONE file in a single call (Claude
// Code MultiEdit). Each edit runs on the result of the previous one. Atomic:
// we build the full new content in memory and only write once — if any edit
// fails (old_string missing / not unique / no-op), nothing is written.
const MultiEditParams = Type.Object({
  file_path: Type.String({ description: 'Absolute or workspace-relative file path to edit.' }),
  edits: Type.Array(
    Type.Object({
      old_string: Type.String({ description: 'Exact text to replace (must exist in the file).' }),
      new_string: Type.String({ description: 'Replacement text.' }),
      replace_all: Type.Optional(
        Type.Boolean({ description: 'Replace every occurrence instead of requiring uniqueness.' }),
      ),
    }),
    { description: 'Edits applied in order; each operates on the prior result.' },
  ),
})

export function createMultiEditTool(cwd: string, reads: ReadRegistry): AgentTool<typeof MultiEditParams> {
  return {
    name: 'MultiEdit',
    label: 'Edit (multi)',
    description: [
      'Apply several exact-string replacements to ONE file atomically. Edits run in order, each against the result of the previous one.',
      '',
      '- All edits are applied in memory first: if any `old_string` fails to match, NOTHING is written. Either the whole set lands or the file is left untouched.',
      '- Same rules as Edit — verbatim match, unique unless `replace_all`, and the file must have been Read and unchanged since — plus order matters: write each later edit against the text as the earlier ones leave it.',
      '- Prefer this over a run of Edit calls on one file. It is a single round trip and it cannot leave the file half-changed.',
    ].join('\n'),
    parameters: MultiEditParams,
    async execute(_id, params): Promise<TextResult> {
      if (params.edits.length === 0) throw new Error('edits is empty — nothing to do')
      const { abs, before } = await openForEdit(cwd, reads, params.file_path)
      let content = before
      // Apply all edits in memory first; any throw aborts before the write.
      params.edits.forEach((edit, i) => {
        try {
          content = applyEdit(content, edit)
        } catch (err) {
          throw new Error(`edit #${i + 1}: ${err instanceof Error ? err.message : String(err)}`)
        }
      })
      await commitEdit(abs, reads, content)
      return textResult(`Applied ${params.edits.length} edit(s) to ${params.file_path}`, {
        path: params.file_path,
        diff: buildUnifiedDiff(before, content),
        newContent: content,
      })
    },
  }
}

// ─── Grep ──────────────────────────────────────────────────────────────────
// Content search. Backend is ripgrep when present, falling back to `git grep -P`
// then `git grep -E` (see search-backend.ts for why that order matters — the ERE
// fallback silently fails to match `\d`, so it announces itself in-band).
// Parameter surface mirrors Claude Code's Grep so the model's habitual
// output_mode / -i / -A / -B / -C / head_limit calls are honoured instead of
// rejected by the schema.
const GrepParams = Type.Object({
  pattern: Type.String({ description: 'Regular expression to search file contents for.' }),
  path: Type.Optional(Type.String({ description: 'Workspace-relative subdirectory to limit the search to.' })),
  glob: Type.Optional(Type.String({ description: 'Glob of files to include (e.g. "*.ts", "src/**/*.vue").' })),
  type: Type.Optional(Type.String({ description: 'ripgrep file type filter (e.g. "ts", "vue", "py").' })),
  output_mode: Type.Optional(
    Type.Union(
      [Type.Literal('content'), Type.Literal('files_with_matches'), Type.Literal('count')],
      { description: 'content = matching lines (default); files_with_matches = paths only; count = per-file match counts.' },
    ),
  ),
  '-i': Type.Optional(Type.Boolean({ description: 'Case-insensitive search.' })),
  '-A': Type.Optional(Type.Number({ description: 'Lines of trailing context (content mode only).' })),
  '-B': Type.Optional(Type.Number({ description: 'Lines of leading context (content mode only).' })),
  '-C': Type.Optional(Type.Number({ description: 'Lines of context on both sides (content mode only).' })),
  multiline: Type.Optional(
    Type.Boolean({ description: 'Let the pattern span lines and `.` match newlines. Requires ripgrep.' }),
  ),
  head_limit: Type.Optional(Type.Number({ description: 'Keep only the first N result lines.' })),
})

export function createGrepTool(cwd: string): AgentTool<typeof GrepParams> {
  return {
    name: 'Grep',
    label: 'Grep',
    description: [
      'Search file CONTENTS for a regular expression. Use this to find code by what it says; use Glob to find files by name.',
      '',
      '- Powered by ripgrep, so ripgrep regex syntax works: `\\d`, `\\w`, `\\s`, `\\b`, character classes, alternation. If ripgrep is missing the tool falls back to git grep and SAYS SO in the result — a fallback note means some syntax silently did not apply, so re-read it rather than trusting an empty result.',
      '- `output_mode`: `content` (default) returns `path:line:text`; `files_with_matches` returns paths only — much cheaper when you just need to know WHERE to look; `count` returns per-file totals.',
      '- Scope before you widen: `path` limits to a subdirectory, `glob` to a file pattern, `type` to a language. A scoped search is faster and its output is readable.',
      '- Dependency and build output is excluded by default (node_modules, .git, dist, build, .next, .nuxt, .output, vendor, *.min.js, *.min.css, *.map). Passing `glob` REPLACES those excludes with your own pattern — that is how you deliberately search inside them.',
      `- Capped at ${GREP_MAX_LINES} lines / ${GREP_MAX_OUTPUT_CHARS} chars, with long lines clamped. Narrow the pattern or the scope rather than fighting the cap; \`head_limit\` trims further.`,
      '- An empty result means the pattern did not match — it is not proof the thing does not exist. Try a shorter, less anchored pattern before concluding anything.',
    ].join('\n'),
    parameters: GrepParams,
    async execute(_id, params): Promise<TextResult> {
      // Validate the optional subdir scope (defence-in-depth; the backends also
      // refuse to escape cwd, but the check belongs at the tool boundary).
      if (params.path) assertInsideWorkspace(cwd, params.path)
      const context = params['-C']
      const outputMode: GrepOutputMode = params.output_mode ?? 'content'
      const { lines, note } = await runGrep(cwd, {
        pattern: params.pattern,
        path: params.path,
        glob: params.glob,
        type: params.type,
        caseInsensitive: params['-i'] === true,
        outputMode,
        // -C is shorthand for "both sides"; an explicit -A/-B wins over it.
        before: params['-B'] ?? context,
        after: params['-A'] ?? context,
        multiline: params.multiline === true,
      })

      const prefix = note ? `${note}\n\n` : ''
      if (lines.length === 0) {
        return textResult(`${prefix}No matches found.`, {})
      }
      // rtk: cap by bytes + clamp giant (minified) lines, not just line count.
      const { text } = clampForLlm(lines, {
        maxLines: Math.min(params.head_limit ?? GREP_MAX_LINES, GREP_MAX_LINES),
        maxLineChars: GREP_MAX_LINE_CHARS,
        maxTotalChars: GREP_MAX_OUTPUT_CHARS,
        hint: 'narrow the pattern, pass a `glob`/`path`/`type`, or use output_mode "files_with_matches"',
      })
      return textResult(prefix + text, {})
    },
  }
}

// ─── Glob ──────────────────────────────────────────────────────────────────
// Filename search. Uses `git ls-files` with a pathspec glob inside a repo and a
// bounded filesystem walk outside one, so the tool works in every project rather
// than only in git-tracked ones. Both branches return most-recently-modified
// first (Claude Code parity): when a broad pattern matches many files, the one
// the user just touched is at the top.
const GlobParams = Type.Object({
  pattern: Type.String({ description: 'Glob pattern to match file paths (e.g. "**/*.ts").' }),
  path: Type.Optional(Type.String({ description: 'Workspace-relative subdirectory to search.' })),
})

async function gitGlob(cwd: string, pattern: string, path: string | undefined): Promise<string[] | null> {
  const dir = path ? normalizeDir(path) : ''
  // Scope the glob WITHIN the subdir when `path` is given (else match repo-wide).
  const spec = `:(glob)${dir ? `${dir}/${pattern}` : pattern}`
  try {
    const res = await runGit(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '--', spec], {
      throwOnNonZero: false,
      timeoutMs: GLOB_TIMEOUT_MS,
    })
    if (res.code > 1) return null // not a repo → caller falls back to the walk
    return res.stdout.split('\n').filter((l) => l.length > 0)
  } catch {
    return null
  }
}

export function createGlobTool(cwd: string): AgentTool<typeof GlobParams> {
  return {
    name: 'Glob',
    label: 'Glob',
    description: [
      'Find files by name or path pattern. Use this to locate files; use Grep to search inside them.',
      '',
      '- Results are sorted most-recently-modified first, so a broad pattern still surfaces the file being worked on at the top.',
      '- Patterns: `**/*.ts`, `src/**/*.test.ts`, `*.{js,ts}`. Scope with `path` to search one subdirectory.',
      '- In a git repository this lists tracked AND untracked files but respects .gitignore, so ignored paths (node_modules, build output) do not appear — that is expected, not a missing file. Outside a repository it walks the filesystem, skipping hidden and dependency/build directories.',
      `- Capped at ${GLOB_MAX_FILES} files; narrow the pattern if you reach it.`,
    ].join('\n'),
    parameters: GlobParams,
    async execute(_id, params): Promise<TextResult> {
      if (params.path) assertInsideWorkspace(cwd, params.path)
      const tracked = await gitGlob(cwd, params.pattern, params.path)
      // Outside a repo, walk the tree ourselves rooted at the requested scope.
      const root = params.path ? assertInsideWorkspace(cwd, params.path) : cwd
      const hits =
        tracked !== null
          ? await sortByMtime(cwd, tracked)
          : (await walkGlob(root, params.pattern)).map((h) => ({
              // Re-anchor a walk result to the workspace so both branches return
              // paths the model can hand straight back to Read.
              path: params.path ? `${normalizeDir(params.path)}/${h.path}` : h.path,
              mtimeMs: h.mtimeMs,
            }))
      if (hits.length === 0) return textResult('No files matched.', {})
      const { text } = clampForLlm(
        hits.map((h) => h.path),
        {
          maxLines: GLOB_MAX_FILES,
          maxTotalChars: GLOB_MAX_OUTPUT_CHARS,
          hint: 'narrow the glob pattern or `path` scope',
        },
      )
      return textResult(text, {})
    },
  }
}
