// Runner: every git subprocess goes through here. Spawn invariant per ADR 0017
// — execFile only, arg array only, env whitelist only, cwd = workspaceRoot.
import { execFile, type ExecFileException } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { RpcError } from '../transport/rpc.js'
import { GIT_RPC_CODE, GitErrorCode, mapStderrToCode, sanitizeStderr } from './error-map.js'

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

export async function runGit(
  workspaceRoot: string,
  args: readonly string[],
  opts: RunGitOptions = {},
): Promise<RunGitResult> {
  if (!opts.noWorkspaceCheck) await assertWorkspace(workspaceRoot)

  return new Promise<RunGitResult>((resolveResult, reject) => {
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
          const exitCode = typeof ex.code === 'number' ? ex.code : -1

          if (ex.code === 'ENOENT') {
            reject(
              new RpcError(GIT_RPC_CODE, 'Git binary không tìm thấy', {
                gitCode: GitErrorCode.GIT_NOT_FOUND,
              }),
            )
            return
          }

          if (opts.throwOnNonZero === false) {
            resolveResult({ stdout, stderr, code: exitCode })
            return
          }

          const sanitized = sanitizeStderr(stderr)
          const gitCode = mapStderrToCode(stderr)
          reject(
            new RpcError(GIT_RPC_CODE, sanitized || ex.message || 'git failed', {
              gitCode,
              stderrSanitized: sanitized,
            }),
          )
          return
        }
        resolveResult({ stdout, stderr, code: 0 })
      },
    )

    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.write(opts.stdin)
      child.stdin.end()
    }
  })
}
