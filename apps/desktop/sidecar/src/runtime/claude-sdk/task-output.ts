// Read the tail of a background task's output file. The CLI names that file in the
// backgrounded Bash tool_result while the task runs, and again in
// `system/task_notification` when it settles — reading it is what lets a background
// shell show its actual output (live, then final) instead of just "completed".
//
// The path comes from the CLI, not from the UI, but it is still validated before any
// I/O (invariant #2). Three independent conditions, all required:
//   1. the basename is exactly `<taskId>.output` — the caller knows the task id, so a
//      path pointing anywhere else is refused no matter how it was produced;
//   2. it sits in a `tasks/` directory;
//   3. its REAL directory (symlinks resolved) is inside a root the CLI may own — the
//      OS temp dir (`/tmp` is its own symlink on macOS) or AWOG's home.
//
// Only the TAIL is read: a long-running command can write megabytes, and this text
// lands in a persisted session step. A subagent's output_file is its whole JSONL
// transcript (its steps already stream in individually) — callers skip it; this
// module deals in plain text.

import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, resolve, sep } from 'node:path'
import { awogHome } from '../../util/path.js'
import { log } from '../../util/logger.js'

// Enough to see a test run's failure block, small enough to persist per step.
const MAX_TAIL_BYTES = 4000

// Resolved once: realpath collapses the /tmp → /private/tmp indirection on macOS, so
// the comparison below is symlink-proof on both sides.
let allowedRoots: string[] | undefined
function realRoots(): string[] {
  if (allowedRoots) return allowedRoots
  const roots = new Set([tmpdir(), '/tmp', awogHome()])
  allowedRoots = [...roots]
    .map((root) => {
      try {
        return realpathSync(root)
      } catch {
        return ''
      }
    })
    .filter((root) => root.length > 0)
  return allowedRoots
}

function isAcceptablePath(file: string, taskId: string): boolean {
  const resolved = resolve(file)
  if (!file.startsWith('/')) return false
  if (basename(resolved) !== `${taskId}.output`) return false
  if (!resolved.includes(`${sep}tasks${sep}`)) return false
  let realDir: string
  try {
    realDir = realpathSync(dirname(resolved))
  } catch {
    return false
  }
  return realRoots().some((root) => realDir === root || realDir.startsWith(root + sep))
}

// Tail of the task's output: '' when the file exists but has nothing yet, undefined
// when the path is refused or cannot be read (the caller stops polling after a few).
// Never throws — an unreadable output must not break a turn.
export function readTaskOutputTail(file: string, taskId: string): string | undefined {
  if (!isAcceptablePath(file, taskId)) {
    log.warn('claude-sdk: refusing to read task output — path not accepted', { file, taskId })
    return undefined
  }
  const resolved = resolve(file)
  if (!existsSync(resolved)) return undefined
  let fd: number | undefined
  try {
    const size = statSync(resolved).size
    if (size === 0) return ''
    const length = Math.min(size, MAX_TAIL_BYTES)
    const buf = Buffer.allocUnsafe(length)
    fd = openSync(resolved, 'r')
    readSync(fd, buf, 0, length, size - length)
    const text = buf.toString('utf8')
    // A cut tail can start mid-line; drop the partial first line and say so.
    if (length < size) {
      const nl = text.indexOf('\n')
      const body = nl >= 0 ? text.slice(nl + 1) : text
      return `… (${size - length} earlier bytes omitted)\n${body}`
    }
    return text
  } catch (err) {
    log.warn('claude-sdk: task output read failed', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
    return undefined
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
