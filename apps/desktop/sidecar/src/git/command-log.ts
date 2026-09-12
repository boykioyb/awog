// Ring buffer of every git subprocess this sidecar ran, so the Git screen can
// show WHAT it actually executed — the thing every desktop git client has
// (Sublime Merge's command log, Fork's console) and AWOG had nothing of: a
// failed op surfaced one mapped error string and the real `git …` line, its exit
// code and its stderr were only ever visible to a process nobody can see.
//
// Three things this must not do:
//
//  1. **Leak.** Entries go straight to the renderer, so argv and both streams run
//     through `redactString` (invariant #1). The gh token reaches git through the
//     ENV, never argv (see streaming.ts GH_CREDENTIAL_ARGS), but a remote URL
//     pasted in the UI can carry `https://user:token@host` — that is the vector
//     redactString closes here.
//  2. **Grow.** `runGit` allows a 16 MiB stdout (`git diff` on a big tree). Keep
//     a head of each stream, not the whole thing, and cap the ring.
//  3. **Drown.** The watcher re-runs `status` on every file change and auto-fetch
//     ticks every 5 minutes; those would bury the one command the user is looking
//     for. Each entry carries `readOnly` so the UI can filter them out.
import { redactString } from '../sessions/redact.js'
import { emit } from '../transport/stdio.js'

export interface GitCommandEntry {
  id: number
  workspaceRoot: string
  /** Redacted argv, WITHOUT the leading `git`. */
  argv: string[]
  startedAt: string
  durationMs: number
  exitCode: number
  stdout: string
  stderr: string
  /** True when either stream was cut to its head. */
  truncated: boolean
  /** A probe git ran to answer a question, not to change the repo. */
  readOnly: boolean
}

const RING_CAP = 400
const STREAM_CAP = 4000

// Subcommands that only read. Anything not listed counts as a mutation, which is
// the safe default: a new write command shows up unfiltered rather than hiding.
const READ_ONLY = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'rev-list', 'branch', 'for-each-ref',
  'ls-files', 'ls-tree', 'cat-file', 'config', 'remote', 'stash', 'tag', 'blame',
  'describe', 'symbolic-ref', 'var', 'version', 'check-ignore', 'merge-base', 'shortlog',
])

// `-c foo=bar` pairs and other leading options come before the subcommand.
function subcommandOf(argv: readonly string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a === '-c' || a === '-C') {
      i++
      continue
    }
    if (a.startsWith('-')) continue
    return a
  }
  return ''
}

// `remote`/`stash`/`tag`/`branch`/`config` read with no verb but write with one
// (`remote add`, `stash pop`, `branch -d`). Treat a bare/`list` form as a read.
const MUTATING_VERB = new Set([
  'add', 'set-url', 'remove', 'rm', 'rename', 'prune', 'push', 'pop', 'apply', 'drop',
  'save', 'create', 'delete', 'clear', 'store',
])

function isReadOnly(argv: readonly string[]): boolean {
  const sub = subcommandOf(argv)
  if (!READ_ONLY.has(sub)) return false
  const i = argv.indexOf(sub)
  for (let j = i + 1; j < argv.length; j++) {
    const a = argv[j] as string
    if (a.startsWith('-')) {
      // `branch -d x` / `tag -d x` are deletions.
      if (a === '-d' || a === '-D' || a === '--delete' || a === '--unset') return false
      continue
    }
    return !MUTATING_VERB.has(a)
  }
  return true
}

function head(s: string): { text: string; cut: boolean } {
  const red = redactString(s ?? '')
  if (red.length <= STREAM_CAP) return { text: red, cut: false }
  return { text: red.slice(0, STREAM_CAP), cut: true }
}

const ring: GitCommandEntry[] = []
let nextId = 1

export function recordGitCommand(input: {
  workspaceRoot: string
  argv: readonly string[]
  startedAt: number
  durationMs: number
  exitCode: number
  stdout: string
  stderr: string
}): void {
  const out = head(input.stdout)
  const err = head(input.stderr)
  const entry: GitCommandEntry = {
    id: nextId++,
    workspaceRoot: input.workspaceRoot,
    argv: input.argv.map((a) => redactString(a)),
    startedAt: new Date(input.startedAt).toISOString(),
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    stdout: out.text,
    stderr: err.text,
    truncated: out.cut || err.cut,
    readOnly: isReadOnly(input.argv),
  }
  ring.push(entry)
  if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP)
  emit('git:command', entry)
}

/** Newest last, so the UI can append without re-sorting. */
export function listGitCommands(workspaceRoot?: string, limit = RING_CAP): GitCommandEntry[] {
  const src = workspaceRoot ? ring.filter((e) => e.workspaceRoot === workspaceRoot) : ring
  return src.slice(-limit)
}

export function clearGitCommands(): void {
  ring.length = 0
}
