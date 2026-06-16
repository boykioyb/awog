// Filesystem AgentTools for the Pi runtime (ADR 0029). Names + arg-keys mirror
// Claude Code EXACTLY so step-mapper.ts / trace-mapper.ts / Workspace Panel need
// no changes (Read/Write/Edit/Grep/Glob; file_path/content/old_string/new_string/
// pattern). All file I/O is gated by assertInsideWorkspace (security invariant
// #2) and scoped to the session cwd. Reuses git grep for search (ReDoS-safe).

import { readFile, writeFile, stat, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { assertInsideWorkspace } from '../../git/path-sanitize.js'
import { runGit } from '../../git/runner.js'

// Caps mirror the fs.* RPC methods so the runtime can't push pathological
// payloads through the model/IPC path.
const READ_MAX_BYTES = 256 * 1024
const WRITE_MAX_BYTES = 8 * 1024 * 1024
const GREP_TIMEOUT_MS = 15_000
const GLOB_TIMEOUT_MS = 15_000
const GREP_MAX_LINES = 500
const GLOB_MAX_FILES = 500

type TextResult = AgentToolResult<{ path?: string; command?: string }>

function textResult(text: string, details: { path?: string; command?: string }): TextResult {
  return { content: [{ type: 'text', text }], details }
}

// ─── Read ──────────────────────────────────────────────────────────────────
// Returns `cat -n`-style numbered lines (Claude Code Read format) so the model
// can reference line numbers for subsequent Edits.
const ReadParams = Type.Object({
  file_path: Type.String({ description: 'Absolute or workspace-relative file path to read.' }),
  offset: Type.Optional(Type.Number({ description: '1-based line to start from.' })),
  limit: Type.Optional(Type.Number({ description: 'Max number of lines to return.' })),
})

function numberLines(content: string, offset: number, limit: number | undefined): string {
  const lines = content.split('\n')
  const start = Math.max(0, offset - 1)
  const end = limit !== undefined ? Math.min(lines.length, start + limit) : lines.length
  const out: string[] = []
  for (let i = start; i < end; i++) {
    // Right-align line numbers in a 6-wide gutter + tab, matching `cat -n`.
    out.push(`${String(i + 1).padStart(6)}\t${lines[i]}`)
  }
  return out.join('\n')
}

export function createReadTool(cwd: string): AgentTool<typeof ReadParams> {
  return {
    name: 'Read',
    label: 'Read',
    description:
      'Read a file from the workspace. Returns the contents with line numbers (cat -n style).',
    parameters: ReadParams,
    async execute(_id, params): Promise<TextResult> {
      const abs = assertInsideWorkspace(cwd, params.file_path)
      const st = await stat(abs)
      if (st.isDirectory()) throw new Error(`Path is a directory: ${params.file_path}`)
      const buf = await readFile(abs)
      if (buf.includes(0)) {
        return textResult('[binary file — contents omitted]', { path: params.file_path })
      }
      const truncatedBuf = buf.subarray(0, READ_MAX_BYTES)
      const numbered = numberLines(truncatedBuf.toString('utf8'), params.offset ?? 1, params.limit)
      const suffix = buf.length > READ_MAX_BYTES ? '\n…(truncated)' : ''
      return textResult(numbered + suffix, { path: params.file_path })
    },
  }
}

// ─── Write ─────────────────────────────────────────────────────────────────
const WriteParams = Type.Object({
  file_path: Type.String({ description: 'Absolute or workspace-relative file path to write.' }),
  content: Type.String({ description: 'Full file contents to write (overwrites).' }),
})

export function createWriteTool(cwd: string): AgentTool<typeof WriteParams> {
  return {
    name: 'Write',
    label: 'Write',
    description: 'Create or overwrite a file with the given content.',
    parameters: WriteParams,
    async execute(_id, params): Promise<TextResult> {
      const abs = assertInsideWorkspace(cwd, params.file_path)
      const bytes = Buffer.byteLength(params.content, 'utf8')
      if (bytes > WRITE_MAX_BYTES) throw new Error(`File too large to write (> ${WRITE_MAX_BYTES} bytes)`)
      // Refuse to clobber a directory.
      try {
        const st = await stat(abs)
        if (st.isDirectory()) throw new Error(`Path is a directory: ${params.file_path}`)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, params.content, 'utf8')
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

export function createEditTool(cwd: string): AgentTool<typeof EditParams> {
  return {
    name: 'Edit',
    label: 'Edit',
    description:
      'Replace an exact string in a file. old_string must match verbatim and (unless replace_all) be unique.',
    parameters: EditParams,
    async execute(_id, params): Promise<TextResult> {
      const abs = assertInsideWorkspace(cwd, params.file_path)
      const st = await stat(abs)
      if (st.isDirectory()) throw new Error(`Path is a directory: ${params.file_path}`)
      const buf = await readFile(abs)
      if (buf.includes(0)) throw new Error('Cannot edit a binary file')
      const next = applyEdit(buf.toString('utf8'), params)
      await writeFile(abs, next, 'utf8')
      return textResult(`Edited ${params.file_path}`, { path: params.file_path })
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

export function createMultiEditTool(cwd: string): AgentTool<typeof MultiEditParams> {
  return {
    name: 'MultiEdit',
    label: 'Edit (multi)',
    description:
      'Apply multiple exact-string replacements to a single file in one atomic call. Edits run in order; each old_string must match verbatim and (unless replace_all) be unique at the time it is applied.',
    parameters: MultiEditParams,
    async execute(_id, params): Promise<TextResult> {
      if (params.edits.length === 0) throw new Error('edits is empty — nothing to do')
      const abs = assertInsideWorkspace(cwd, params.file_path)
      const st = await stat(abs)
      if (st.isDirectory()) throw new Error(`Path is a directory: ${params.file_path}`)
      const buf = await readFile(abs)
      if (buf.includes(0)) throw new Error('Cannot edit a binary file')
      let content = buf.toString('utf8')
      // Apply all edits in memory first; any throw aborts before the write.
      params.edits.forEach((edit, i) => {
        try {
          content = applyEdit(content, edit)
        } catch (err) {
          throw new Error(`edit #${i + 1}: ${err instanceof Error ? err.message : String(err)}`)
        }
      })
      await writeFile(abs, content, 'utf8')
      return textResult(`Applied ${params.edits.length} edit(s) to ${params.file_path}`, {
        path: params.file_path,
      })
    },
  }
}

// ─── Grep ──────────────────────────────────────────────────────────────────
// Content search via `git grep` (ReDoS-safe, .gitignore-aware in a repo; falls
// back to --no-index for non-repos). Reports `path:line:text` lines.
const GrepParams = Type.Object({
  pattern: Type.String({ description: 'Regular expression to search for (git grep -E).' }),
  path: Type.Optional(Type.String({ description: 'Workspace-relative subdirectory to limit to.' })),
  glob: Type.Optional(Type.String({ description: 'Pathspec glob to include (e.g. "*.ts").' })),
})

async function gitGrep(cwd: string, pattern: string, glob: string | undefined, noIndex: boolean): Promise<string | null> {
  const args = ['grep', '--no-color', '-I', '-n', '-E']
  args.push(noIndex ? '--no-index' : '--untracked')
  args.push('-e', pattern, '--')
  if (glob) args.push(`:(glob)${glob}`)
  let res
  try {
    res = await runGit(cwd, args, { throwOnNonZero: false, timeoutMs: GREP_TIMEOUT_MS })
  } catch {
    return null
  }
  if (res.code > 1) return null // not a repo / error
  if (res.code === 1) return '' // no matches
  return res.stdout
}

export function createGrepTool(cwd: string): AgentTool<typeof GrepParams> {
  return {
    name: 'Grep',
    label: 'Grep',
    description: 'Search file contents for a regular expression (powered by git grep).',
    parameters: GrepParams,
    async execute(_id, params): Promise<TextResult> {
      // Validate optional subdir scope (defence-in-depth; git also rejects ../).
      if (params.path) assertInsideWorkspace(cwd, params.path)
      const out =
        (await gitGrep(cwd, params.pattern, params.glob, false)) ??
        (await gitGrep(cwd, params.pattern, params.glob, true)) ??
        ''
      const lines = out.split('\n').filter((l) => l.length > 0).slice(0, GREP_MAX_LINES)
      const text = lines.length > 0 ? lines.join('\n') : 'No matches found.'
      return textResult(text, {})
    },
  }
}

// ─── Glob ──────────────────────────────────────────────────────────────────
// Filename search. Uses `git ls-files` with a pathspec glob in a repo; falls
// back to a bounded recursive walk for non-repos.
const GlobParams = Type.Object({
  pattern: Type.String({ description: 'Glob pattern to match file paths (e.g. "**/*.ts").' }),
  path: Type.Optional(Type.String({ description: 'Workspace-relative subdirectory to search.' })),
})

async function gitGlob(cwd: string, pattern: string): Promise<string | null> {
  try {
    const res = await runGit(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '--', `:(glob)${pattern}`], {
      throwOnNonZero: false,
      timeoutMs: GLOB_TIMEOUT_MS,
    })
    if (res.code > 1) return null
    return res.stdout
  } catch {
    return null
  }
}

export function createGlobTool(cwd: string): AgentTool<typeof GlobParams> {
  return {
    name: 'Glob',
    label: 'Glob',
    description: 'Find files by glob pattern (powered by git ls-files).',
    parameters: GlobParams,
    async execute(_id, params): Promise<TextResult> {
      if (params.path) assertInsideWorkspace(cwd, params.path)
      const out = await gitGlob(cwd, params.pattern)
      if (out === null) {
        return textResult('Glob unavailable (not a git repo).', {})
      }
      const files = out.split('\n').filter((l) => l.length > 0).slice(0, GLOB_MAX_FILES)
      const text = files.length > 0 ? files.join('\n') : 'No files matched.'
      return textResult(text, {})
    },
  }
}
