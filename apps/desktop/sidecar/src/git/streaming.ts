// Streaming runner cho fetch/pull/push. Khác `runner.ts` ở 2 điểm:
//   1. Dùng `child_process.spawn` thay vì `execFile` để stream stderr line-by-line.
//   2. Giữ in-flight op registry → user/UI có thể `git.cancel` qua SIGTERM → SIGKILL.
//
// Một (workspaceRoot, op) chỉ chạy được 1 instance — spawn thứ 2 reject `BUSY`.
import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { RpcError } from '../transport/rpc.js'
import { GIT_RPC_CODE, GitErrorCode } from './error-map.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { attachGitWatcher } from './watcher.js'
import { resolveGhTokenToInject } from '../github/runner.js'

const ALLOW_ENV = [
  'PATH',
  'HOME',
  'SSH_AUTH_SOCK',
  'LANG',
  'LC_ALL',
  'SystemRoot',
  'USERPROFILE',
] as const

function filteredEnv(ghToken?: string | null): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const k of ALLOW_ENV) {
    const v = process.env[k]
    if (v !== undefined) out[k] = v
  }
  // When the caller pinned a gh account, inject its token so `gh auth
  // git-credential` (wired as the github.com helper via `ghCredentialArgs`)
  // serves THAT account instead of whatever the OS keychain holds. SECRET:
  // lives only in the child env, never logged / surfaced (invariant #1).
  if (ghToken) {
    out.GH_TOKEN = ghToken
    delete out.GITHUB_TOKEN
  }
  // Match runner.ts: never take git's optional index lock (the required locks
  // for fetch/pull/push are unaffected). Keeps background polling lock-free.
  out.GIT_OPTIONAL_LOCKS = '0'
  // Match runner.ts: fetch/pull/push must never fall back to an interactive
  // credential prompt. The sidecar has no TTY of its own — git would open the
  // controlling terminal that launched the app (dev: the `pnpm dev` shell) and
  // block there, so the "Password for 'https://…'" prompt only leaked to that
  // console and never reached the UI. With prompts disabled git fails fast
  // ("could not read Username … terminal prompts disabled") → detectAuthHint →
  // AUTH_FAILED → the rich GitAuthErrorModal in the renderer. Credential
  // *helpers* (osxkeychain / GCM / gh) still run non-interactively, so a cached
  // token keeps working; only the no-credentials case turns into a clean error.
  out.GIT_TERMINAL_PROMPT = '0'
  // Belt-and-suspenders: stop Git Credential Manager popping its own GUI window
  // in place of the terminal prompt (harmless when GCM isn't installed).
  out.GCM_INTERACTIVE = 'never'
  return out
}

// `-c` overrides (must precede the git subcommand) that route github.com HTTPS
// auth through `gh` for THIS invocation only — the empty value first RESETS any
// inherited helper (osxkeychain/GCM) for that host, then pins gh's credential
// helper. gh serves the account from the injected GH_TOKEN (or its active
// account). Scoped to github.com so non-GitHub remotes keep the default helper.
// Used only when the app pinned a gh account; otherwise git auth is untouched.
const GH_CREDENTIAL_ARGS = [
  '-c',
  'credential.https://github.com.helper=',
  '-c',
  'credential.https://github.com.helper=!gh auth git-credential',
] as const

export type StreamingOpKind = 'fetch' | 'pull' | 'push'

export interface StreamingResult {
  stdout: string
  stderr: string
  code: number
}

interface InFlightSlot {
  child: ChildProcess
  exited: Promise<void>
  cancelled: boolean
}

const inflight = new Map<string, InFlightSlot>()

const slotKey = (workspaceRoot: string, op: StreamingOpKind): string => `${workspaceRoot}::${op}`

// Progress regexes — order matters; most specific first. `pct` null → indeterminate.
const PROGRESS_PATTERNS: Array<[RegExp, string]> = [
  [/remote: Counting objects:\s+(\d+)%/i, 'counting'],
  [/Compressing objects:\s+(\d+)%/i, 'compressing'],
  [/Receiving objects:\s+(\d+)%/i, 'receiving'],
  [/Resolving deltas:\s+(\d+)%/i, 'resolving'],
  [/Writing objects:\s+(\d+)%/i, 'writing'],
]

const CONNECTING_HINTS = [/^Cloning into/i, /^From\s/i, /^To\s/i]

interface ParsedProgress {
  phase: string
  pct: number | null
}

function parseProgressLine(line: string): ParsedProgress | null {
  for (const [re, phase] of PROGRESS_PATTERNS) {
    const m = re.exec(line)
    if (m && m[1]) {
      const pct = Number.parseInt(m[1], 10)
      if (Number.isFinite(pct)) return { phase, pct }
    }
  }
  for (const re of CONNECTING_HINTS) {
    if (re.test(line)) return { phase: 'connecting', pct: null }
  }
  return null
}

async function assertWorkspace(workspaceRoot: string): Promise<void> {
  try {
    const s = await stat(workspaceRoot)
    if (!s.isDirectory()) throw new Error('not a directory')
  } catch {
    throw new RpcError(GIT_RPC_CODE, 'Workspace không tồn tại', {
      gitCode: GitErrorCode.WORKSPACE_NOT_FOUND,
      workspaceRoot,
    })
  }
}

export interface RunStreamingParams {
  workspaceRoot: string
  args: readonly string[]
  op: StreamingOpKind
  // When set (a validated gh login), authenticate github.com over HTTPS as that
  // gh account instead of the OS keychain default. Empty/undefined → git's own
  // credential helper is used, exactly as before (no behavior change).
  ghAccount?: string | undefined
}

const PROGRESS_THROTTLE_MS = 250 // tối đa 4 emit/s

export async function runGitStreaming(params: RunStreamingParams): Promise<StreamingResult> {
  const { workspaceRoot, args, op } = params
  await assertWorkspace(workspaceRoot)

  const key = slotKey(workspaceRoot, op)
  if (inflight.has(key)) {
    throw new RpcError(GIT_RPC_CODE, `Git ${op} đang chạy`, { gitCode: GitErrorCode.BUSY })
  }

  // Pinned gh account → resolve its token (throws a mapped GH error if the login
  // is unknown / gh not logged in) and route github.com auth through gh. Fetch
  // the token even for the active account (includeActive) so a remote whose URL
  // embeds a username still authenticates as the pinned account.
  const ghToken = params.ghAccount
    ? await resolveGhTokenToInject(params.ghAccount, { includeActive: true })
    : null
  const spawnArgs = params.ghAccount ? [...GH_CREDENTIAL_ARGS, ...args] : [...args]

  const child = spawn('git', spawnArgs, {
    cwd: workspaceRoot,
    env: filteredEnv(ghToken),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  let lastEmitAt = 0
  let lastPct: number | null = null
  let lastPhase: string | null = null

  const exited = new Promise<void>((resolve) => {
    child.on('exit', () => resolve())
    child.on('error', () => resolve())
  })

  const slot: InFlightSlot = { child, exited, cancelled: false }
  inflight.set(key, slot)

  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })

  // Stream stderr line-by-line — Git writes progress with \r so we split on
  // both \n and \r to catch in-progress updates.
  const stderrAccum = { buf: '' }
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    stderr += text
    stderrAccum.buf += text
    // Split on \r and \n; keep last partial fragment.
    const parts = stderrAccum.buf.split(/[\r\n]/)
    stderrAccum.buf = parts.pop() ?? ''
    for (const line of parts) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const progress = parseProgressLine(trimmed)
      if (!progress) continue
      // Throttle: skip if same phase+pct, or if last emit < 250ms ago (unless
      // pct jumped to 100 — always surface completion).
      const now = Date.now()
      const sameAsLast = progress.phase === lastPhase && progress.pct === lastPct
      const isComplete = progress.pct === 100
      if (sameAsLast) continue
      if (!isComplete && now - lastEmitAt < PROGRESS_THROTTLE_MS) continue
      lastEmitAt = now
      lastPct = progress.pct
      lastPhase = progress.phase
      emit(`git:${op}:progress`, {
        workspaceRoot,
        phase: progress.phase,
        pct: progress.pct,
      })
    }
  })

  try {
    await new Promise<void>((resolve) => {
      child.on('exit', () => resolve())
      child.on('error', (err) => {
        // Spawn-level error (ENOENT etc). Treat as exit with -1; runner-level
        // mapping happens at the caller via stderr / code inspection.
        stderr += `\n${err.message}`
        resolve()
      })
    })
  } finally {
    inflight.delete(key)
  }

  const code = typeof child.exitCode === 'number' ? child.exitCode : -1

  // Force a status refresh on the UI — fetch/pull may have moved refs even on
  // partial success; push doesn't change local tree but ahead/behind shifted.
  try {
    attachGitWatcher(workspaceRoot)
  } catch {
    // Watcher attach is best-effort.
  }
  emit('git:status:changed', { reason: op, workspaceRoot })

  if (slot.cancelled) {
    throw new RpcError(GIT_RPC_CODE, 'Operation đã cancel', {
      gitCode: GitErrorCode.CANCELLED,
    })
  }

  return { stdout, stderr, code }
}

export async function cancelOp(workspaceRoot: string, op: StreamingOpKind): Promise<{ ok: true }> {
  const key = slotKey(workspaceRoot, op)
  const slot = inflight.get(key)
  if (!slot) {
    throw new RpcError(GIT_RPC_CODE, `Không có ${op} đang chạy`, {
      gitCode: GitErrorCode.CANCELLED,
    })
  }
  slot.cancelled = true
  try {
    slot.child.kill('SIGTERM')
  } catch (err) {
    log.warn('SIGTERM failed', {
      workspaceRoot,
      op,
      err: err instanceof Error ? err.message : String(err),
    })
  }
  // 2s grace then SIGKILL.
  const killTimer = setTimeout(() => {
    try {
      if (slot.child.exitCode === null) slot.child.kill('SIGKILL')
    } catch (err) {
      log.warn('SIGKILL failed', {
        workspaceRoot,
        op,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }, 2000)
  slot.exited.finally(() => clearTimeout(killTimer))
  return { ok: true }
}
