// Per-session background shell registry (ADR 0066, P1). Backs
// `Bash(run_in_background: true)` + the `BashOutput` tool.
//
// A background command runs DETACHED (its own process group, unref'd) so it
// outlives the turn — it is NOT subject to the one-shot Bash 600s cap. A shell
// wrapper redirects the command's stdout+stderr to a `log` file and writes its
// exit code to an `exit` file when it finishes, so results survive a sidecar
// restart (restart-safe BY CONSTRUCTION — no reattach needed).
//
// On-disk layout, per shell (under the session's own folder):
//   ~/.awog/sessions/<sid>/bg/<shellId>/meta.json  { shellId, command, pid, startedAt, sessionId }
//   ~/.awog/sessions/<sid>/bg/<shellId>/log        stdout+stderr (wrapper redirect)
//   ~/.awog/sessions/<sid>/bg/<shellId>/exit       exit code — appears ONLY when done
//
// Completion detection: while the sidecar lives we finalize on the child's
// `exit` event (fast path); a low-frequency poll of the `exit` file is the
// restart-safe backstop (after a restart there is no child handle) and also
// catches an orphaned shell (pid gone, no exit file → 'exited-unknown').
//
// Security: same posture as the one-shot Bash tool — the exec itself is gated
// upstream in beforeToolCall (execute mode = the user's explicit full-access
// choice). cwd = the session workspace, env = the shell allowlist (never AWOG
// credentials), all files live inside the AWOG-home session folder.

import { spawn, type ChildProcess } from 'node:child_process'
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { sessionsDir, sessionDir } from './jsonl.js'
import { resolveBashShell, filteredShellEnv } from '../runtime/tools/shell.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'

// Cap concurrent RUNNING background shells per session (open question default,
// matches the Task engine's scheduler cap). Exited shells don't count.
const MAX_RUNNING_PER_SESSION = 4
// Output cap mirrors the one-shot Bash tool.
const MAX_OUTPUT_BYTES = 64 * 1024
// Poll cadence for the exit-file backstop (fast path is the child 'exit' event).
const POLL_INTERVAL_MS = 1_500
// Exited shell dirs older than this are swept on boot (open question default).
const EXITED_TTL_MS = 24 * 60 * 60 * 1000

const BG_DIR_NAME = 'bg'

export type BgShellStatus = 'running' | 'exited' | 'exited-unknown'

export interface BgShellMeta {
  shellId: string
  command: string
  pid: number
  startedAt: string
  sessionId: string
}

export interface BgShellState {
  shellId: string
  command: string
  startedAt: string
  status: BgShellStatus
  exitCode: number | null
}

// Live handle for a running (or just-finalized) shell, kept only in memory.
interface LiveShell {
  meta: BgShellMeta
  status: BgShellStatus
  exitCode: number | null
  child?: ChildProcess | undefined
  poll?: ReturnType<typeof setInterval> | undefined
  settled: boolean
}

// sessionId → shellId → LiveShell. Exited shells stay here (for listBackground)
// until the session is cleaned up or the process restarts.
const registry = new Map<string, Map<string, LiveShell>>()

// ─── Paths ────────────────────────────────────────────────────────────────

function bgRootFor(sessionId: string): string {
  return join(sessionDir(sessionId), BG_DIR_NAME)
}
function shellDirFor(sessionId: string, shellId: string): string {
  return join(bgRootFor(sessionId), shellId)
}
function logPathFor(dir: string): string {
  return join(dir, 'log')
}
function exitPathFor(dir: string): string {
  return join(dir, 'exit')
}
function metaPathFor(dir: string): string {
  return join(dir, 'meta.json')
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Single-quote a path for safe inclusion in the shell wrapper string. Paths are
// AWOG-owned (session folder), but home may contain odd chars — quote defensively.
function shq(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`
}

function readExitCode(dir: string): number | null {
  try {
    const raw = readFileSync(exitPathFor(dir), 'utf8').trim()
    if (!raw) return null
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

// Read the accumulated log, capped to the LAST MAX_OUTPUT_BYTES (the tail matters
// most for a long-running command — errors surface at the end).
function readOutput(dir: string): string {
  let buf: string
  try {
    buf = readFileSync(logPathFor(dir), 'utf8')
  } catch {
    return ''
  }
  if (buf.length <= MAX_OUTPUT_BYTES) return buf
  const dropped = buf.length - MAX_OUTPUT_BYTES
  return `…(${dropped} bytes truncated at start)\n${buf.slice(-MAX_OUTPUT_BYTES)}`
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

// Count RUNNING shells for a session (exited ones don't count against the cap).
export function countRunning(sessionId: string): number {
  const m = registry.get(sessionId)
  if (!m) return 0
  let n = 0
  for (const s of m.values()) if (s.status === 'running') n += 1
  return n
}

export class BackgroundLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`Background shell limit reached (${limit} running).`)
    this.name = 'BackgroundLimitError'
  }
}

// Start a detached background command. Returns immediately with the shell handle.
// Throws BackgroundLimitError when the per-session running cap is hit.
export async function startBackground(input: {
  sessionId: string
  cwd: string
  command: string
}): Promise<BgShellMeta> {
  const { sessionId, cwd, command } = input
  if (countRunning(sessionId) >= MAX_RUNNING_PER_SESSION) {
    throw new BackgroundLimitError(MAX_RUNNING_PER_SESSION)
  }

  const shellId = `bg_${randomBytes(5).toString('hex')}`
  const dir = shellDirFor(sessionId, shellId)
  mkdirSync(dir, { recursive: true })

  const logPath = logPathFor(dir)
  const exitPath = exitPathFor(dir)
  const exitTmp = `${exitPath}.tmp`

  // Wrapper: run the (opaque, model-authored) command in a SUBSHELL, redirect all
  // of its output to the log, then atomically write the exit code. `printf` + `mv`
  // keep the `exit` file appearing only once and fully written.
  //
  // A subshell `( … )` — NOT a brace group `{ … }` — is essential: a brace group
  // runs in the CURRENT shell, so an `exit N` inside the model's command would
  // terminate the wrapper before it records the exit code (leaving the shell
  // 'exited-unknown'). A subshell contains `exit`, and `$?` in the parent still
  // captures the subshell's status.
  const wrapper = [
    '(',
    command,
    `) > ${shq(logPath)} 2>&1`,
    `printf '%s' "$?" > ${shq(exitTmp)} && mv ${shq(exitTmp)} ${shq(exitPath)}`,
  ].join('\n')

  const shell = await resolveBashShell()
  const child = spawn(shell.bin, [shell.flag, wrapper], {
    cwd,
    env: filteredShellEnv(),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()

  const startedAt = new Date().toISOString()
  const meta: BgShellMeta = { shellId, command, pid: child.pid ?? -1, startedAt, sessionId }
  writeFileSync(metaPathFor(dir), JSON.stringify(meta, null, 2))

  const state: LiveShell = { meta, status: 'running', exitCode: null, child, settled: false }
  let byId = registry.get(sessionId)
  if (!byId) {
    byId = new Map()
    registry.set(sessionId, byId)
  }
  byId.set(shellId, state)

  // Fast path: finalize on the wrapper's exit (the exit file is already written
  // by then — mv completes before the shell returns).
  child.on('exit', () => finalize(state))
  child.on('error', (err) => {
    log.warn('bg-registry: child error', { shellId, err: err.message })
    finalize(state)
  })
  // Backstop: catches completion after a restart (no child handle) + orphans.
  state.poll = setInterval(() => pollShell(state), POLL_INTERVAL_MS)

  emit('session.background-started', { sessionId, shellId, command, startedAt })
  log.info('bg-registry: started', { sessionId, shellId, pid: meta.pid })
  return meta
}

// Poll a running shell's on-disk state. Finalizes when the exit file appears, or
// marks 'exited-unknown' when the pid is gone with no exit file (orphaned by a
// crash / machine shutdown).
function pollShell(state: LiveShell): void {
  if (state.settled) return
  const dir = shellDirFor(state.meta.sessionId, state.meta.shellId)
  if (existsSync(exitPathFor(dir))) {
    finalize(state)
    return
  }
  // A live child (this process spawned it) reports completion via 'exit'; only
  // treat a dead pid as orphaned when we have NO child handle (post-restart).
  if (!state.child && state.meta.pid > 0 && !pidAlive(state.meta.pid)) {
    finalize(state, 'exited-unknown')
  }
}

// Settle a shell to a terminal status, tear down watchers, emit the done event.
// Idempotent (child 'exit' + poll can race).
function finalize(state: LiveShell, forced?: BgShellStatus): void {
  if (state.settled) return
  state.settled = true
  if (state.poll) clearInterval(state.poll)
  state.poll = undefined
  state.child = undefined

  const dir = shellDirFor(state.meta.sessionId, state.meta.shellId)
  const hasExit = existsSync(exitPathFor(dir))
  const status: BgShellStatus = forced ?? (hasExit ? 'exited' : 'exited-unknown')
  const exitCode = status === 'exited' ? readExitCode(dir) : null
  state.status = status
  state.exitCode = exitCode

  const outputTail = readOutput(dir)
  // The reactive wake (ADR 0066 P2) is renderer-driven: the sessions store
  // subscribes to this event and, per the autoContinueOnBackground setting,
  // either auto-starts a continuation turn or surfaces a "Continue" card. No
  // sidecar-side turn primitive is needed — sessions are renderer-driven.
  emit('session.background-done', {
    sessionId: state.meta.sessionId,
    shellId: state.meta.shellId,
    command: state.meta.command,
    status,
    exitCode,
    outputTail,
  })
  log.info('bg-registry: done', { shellId: state.meta.shellId, status, exitCode })
}

// ─── Read / list / kill ───────────────────────────────────────────────────

export interface BackgroundReadResult {
  shellId: string
  status: BgShellStatus
  exitCode: number | null
  output: string
}

// Read a shell's current output + status. Reads from disk so it works even for a
// shell adopted after a restart. Returns null for an unknown shellId.
export function readBackground(sessionId: string, shellId: string): BackgroundReadResult | null {
  const dir = shellDirFor(sessionId, shellId)
  const state = registry.get(sessionId)?.get(shellId)
  if (!state && !existsSync(dir)) return null

  const hasExit = existsSync(exitPathFor(dir))
  let status: BgShellStatus
  let exitCode: number | null
  if (state) {
    status = state.status
    exitCode = state.exitCode
  } else if (hasExit) {
    status = 'exited'
    exitCode = readExitCode(dir)
  } else {
    status = 'running'
    exitCode = null
  }
  return { shellId, status, exitCode, output: readOutput(dir) }
}

// List a session's background shells (running + finalized) for the UI.
export function listBackground(sessionId: string): BgShellState[] {
  const m = registry.get(sessionId)
  if (!m) return []
  return [...m.values()].map((s) => ({
    shellId: s.meta.shellId,
    command: s.meta.command,
    startedAt: s.meta.startedAt,
    status: s.status,
    exitCode: s.exitCode,
  }))
}

// Kill a running background shell (its whole process group) and finalize it.
export function killBackground(sessionId: string, shellId: string): boolean {
  const state = registry.get(sessionId)?.get(shellId)
  if (!state) return false
  if (state.status === 'running' && state.meta.pid > 0) {
    try {
      // Negative pid → kill the detached process group.
      process.kill(-state.meta.pid, 'SIGKILL')
    } catch (err) {
      log.warn('bg-registry: kill failed', {
        shellId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  finalize(state, 'exited-unknown')
  return true
}

// Remove a session's background shells + their on-disk dir. Called when a session
// is deleted.
export function cleanupSessionBackground(sessionId: string): void {
  const m = registry.get(sessionId)
  if (m) {
    for (const s of m.values()) {
      if (s.status === 'running' && s.meta.pid > 0) {
        try {
          process.kill(-s.meta.pid, 'SIGKILL')
        } catch {
          /* already gone */
        }
      }
      if (s.poll) clearInterval(s.poll)
    }
    registry.delete(sessionId)
  }
  try {
    rmSync(bgRootFor(sessionId), { recursive: true, force: true })
  } catch (err) {
    log.warn('bg-registry: cleanup dir failed', {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

// ─── Boot reload ──────────────────────────────────────────────────────────

// Scan every session's bg/ dir on boot. Already-exited shells are re-registered
// as terminal (so listBackground shows them); shells still running (pid alive,
// no exit file) resume the poll backstop; orphaned shells (pid gone, no exit)
// finalize as 'exited-unknown'. Old exited dirs past the TTL are swept.
export function reloadBackgroundShells(): void {
  let root: string
  try {
    root = sessionsDir()
    if (!existsSync(root)) return
  } catch {
    return
  }

  let sessionIds: string[]
  try {
    sessionIds = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return
  }

  for (const sessionId of sessionIds) {
    const bgRoot = bgRootFor(sessionId)
    if (!existsSync(bgRoot)) continue
    let shellIds: string[]
    try {
      shellIds = readdirSync(bgRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      continue
    }

    for (const shellId of shellIds) {
      const dir = shellDirFor(sessionId, shellId)
      const metaPath = metaPathFor(dir)
      let meta: BgShellMeta | null = null
      try {
        meta = JSON.parse(readFileSync(metaPath, 'utf8')) as BgShellMeta
      } catch {
        meta = null
      }
      if (!meta) continue

      const hasExit = existsSync(exitPathFor(dir))
      // TTL sweep: drop exited dirs older than the cutoff.
      if (hasExit) {
        try {
          const age = Date.now() - statSync(exitPathFor(dir)).mtimeMs
          if (age > EXITED_TTL_MS) {
            rmSync(dir, { recursive: true, force: true })
            continue
          }
        } catch {
          /* keep it */
        }
      }

      const alive = meta.pid > 0 && pidAlive(meta.pid)
      const status: BgShellStatus = hasExit ? 'exited' : alive ? 'running' : 'exited-unknown'
      const state: LiveShell = {
        meta,
        status,
        exitCode: hasExit ? readExitCode(dir) : null,
        settled: status !== 'running',
      }
      let byId = registry.get(sessionId)
      if (!byId) {
        byId = new Map()
        registry.set(sessionId, byId)
      }
      byId.set(shellId, state)

      if (status === 'running') {
        // No child handle after a restart — the poll backstop is the only signal.
        state.poll = setInterval(() => pollShell(state), POLL_INTERVAL_MS)
        log.info('bg-registry: adopted running shell on boot', { sessionId, shellId })
      }
    }
  }
}
