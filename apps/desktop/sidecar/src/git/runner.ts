// Runner: every git subprocess goes through here. Spawn invariant per ADR 0017
// — execFile only, arg array only, env whitelist only, cwd = workspaceRoot.
import { execFile, type ExecFileException } from 'node:child_process'
import { stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { RpcError } from '../transport/rpc.js'
import { GIT_RPC_CODE, GitErrorCode, mapStderrToCode, sanitizeStderr } from './error-map.js'
import { log } from '../util/logger.js'

const ALLOW_ENV = ['PATH', 'HOME', 'SSH_AUTH_SOCK', 'LANG', 'LC_ALL', 'SystemRoot', 'USERPROFILE'] as const

function filteredEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const k of ALLOW_ENV) {
    const v = process.env[k]
    if (v !== undefined) out[k] = v
  }
  // Read-only commands (`status`, `diff`) bypass the workspace mutex, but git
  // would still grab `.git/index.lock` to persist an opportunistic index
  // refresh — colliding with a concurrent mutex-held `add`/`reset` and failing
  // with "Unable to create index.lock: File exists". Disabling optional locks
  // (what IDEs do when polling git) keeps reads lock-free; the genuine mutators
  // still take the required lock and are serialized by withWorkspaceLock.
  out.GIT_OPTIONAL_LOCKS = '0'
  return out
}

export interface RunGitResult {
  stdout: string
  stderr: string
  code: number
}

export interface RunGitOptions {
  // Bypass the WORKSPACE_NOT_FOUND probe — used by `git.checkInstalled` which
  // does not have a workspaceRoot.
  noWorkspaceCheck?: boolean
  // Don't throw on non-zero exit; caller inspects RunGitResult.
  throwOnNonZero?: boolean
  // Optional input piped to stdin (e.g. `commit -F -`).
  stdin?: string
  // Timeout in ms (default 30 000).
  timeoutMs?: number
  // maxBuffer override; default 16 MiB.
  maxBuffer?: number
}

const DEFAULT_TIMEOUT = 30_000
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024

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

// A git write holds `.git/index.lock` for milliseconds. A lock file older than
// this is almost certainly stale — left behind by a git process that was killed
// (app force-quit, SIGKILL on a cancelled fetch/pull, OOM) rather than one that
// is actively writing. Break it so the workspace isn't wedged with "Unable to
// create index.lock: File exists" until the user removes the file by hand. A
// *fresh* lock (younger than the threshold) means a real op is mid-write — leave
// it and let the BUSY error surface.
const STALE_INDEX_LOCK_MS = 10_000

async function removeStaleIndexLock(workspaceRoot: string): Promise<boolean> {
  const lockPath = join(workspaceRoot, '.git', 'index.lock')
  try {
    const info = await stat(lockPath)
    if (!info.isFile()) return false
    const ageMs = Date.now() - info.mtimeMs
    if (ageMs < STALE_INDEX_LOCK_MS) return false
    await unlink(lockPath)
    log.warn('removed stale git index.lock', { workspaceRoot, ageMs: Math.round(ageMs) })
    return true
  } catch {
    // stat failed (no lock, or `.git` is a gitfile for a linked worktree) or
    // unlink raced another remover — either way nothing more to do.
    return false
  }
}

type ExecOutcome =
  | { ok: true; res: RunGitResult }
  | { ok: false; kind: 'enoent' }
  | { ok: false; kind: 'fail'; stdout: string; stderr: string; code: number; message: string }

function execOnce(
  workspaceRoot: string,
  args: readonly string[],
  opts: RunGitOptions,
): Promise<ExecOutcome> {
  return new Promise<ExecOutcome>((resolveOutcome) => {
    const child = execFile(
      'git',
      [...args],
      {
        cwd: opts.noWorkspaceCheck ? undefined : workspaceRoot,
        env: filteredEnv(),
        windowsHide: true,
        maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
      },
      (err, stdoutBuf, stderrBuf) => {
        const decode = (v: string | Buffer | undefined | null): string => {
          if (v === undefined || v === null) return ''
          if (typeof v === 'string') return v
          return (v as Buffer).toString('utf8')
        }
        const stdout = decode(stdoutBuf as string | Buffer | undefined | null)
        const stderr = decode(stderrBuf as string | Buffer | undefined | null)
        if (err) {
          const ex = err as ExecFileException
          if (ex.code === 'ENOENT') {
            resolveOutcome({ ok: false, kind: 'enoent' })
            return
          }
          const exitCode = typeof ex.code === 'number' ? ex.code : -1
          resolveOutcome({
            ok: false,
            kind: 'fail',
            stdout,
            stderr,
            code: exitCode,
            message: ex.message ?? '',
          })
          return
        }
        resolveOutcome({ ok: true, res: { stdout, stderr, code: 0 } })
      },
    )

    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.write(opts.stdin)
      child.stdin.end()
    }
  })
}

export async function runGit(
  workspaceRoot: string,
  args: readonly string[],
  opts: RunGitOptions = {},
): Promise<RunGitResult> {
  if (!opts.noWorkspaceCheck) await assertWorkspace(workspaceRoot)

  let outcome = await execOnce(workspaceRoot, args, opts)

  // Stale-lock recovery: a command that failed *solely* because
  // `.git/index.lock` already exists is recoverable when that lock is stale.
  // Break it once and retry. Read probes run with GIT_OPTIONAL_LOCKS=0 and never
  // hit this; `diff --quiet` returning 1 carries no stderr so it won't match.
  if (
    !opts.noWorkspaceCheck &&
    !outcome.ok &&
    outcome.kind === 'fail' &&
    /index\.lock/i.test(outcome.stderr) &&
    (await removeStaleIndexLock(workspaceRoot))
  ) {
    outcome = await execOnce(workspaceRoot, args, opts)
  }

  if (outcome.ok) return outcome.res

  if (outcome.kind === 'enoent') {
    throw new RpcError(GIT_RPC_CODE, 'Git binary không tìm thấy', {
      gitCode: GitErrorCode.GIT_NOT_FOUND,
    })
  }

  if (opts.throwOnNonZero === false) {
    return { stdout: outcome.stdout, stderr: outcome.stderr, code: outcome.code }
  }

  const sanitized = sanitizeStderr(outcome.stderr)
  const gitCode = mapStderrToCode(outcome.stderr)
  throw new RpcError(GIT_RPC_CODE, sanitized || outcome.message || 'git failed', {
    gitCode,
    stderrSanitized: sanitized,
  })
}
