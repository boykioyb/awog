// `git.pull` — long-running. Strategy-driven (ff-only / merge / rebase) per
// ADR 0017 + spec AC-19..AC-20 + Flow 3 (conflict).
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { runGit } from '../git/runner.js'
import { runGitStreaming } from '../git/streaming.js'
import {
  GIT_RPC_CODE,
  GitErrorCode,
  detectAuthHint,
  sanitizeStderr,
} from '../git/error-map.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  strategy: z.enum(['ff-only', 'merge', 'rebase']),
})

interface Result {
  ok: true
  fastForwarded: boolean
  commitsApplied: number
}

const NUL = String.fromCharCode(0)

function parseConflictedFiles(porcelain: string): string[] {
  // `--porcelain=v2 -z` separates entries by NUL. Unmerged entries start with
  // 'u XY ...' followed by metadata + a single space + path.
  const out: string[] = []
  for (const entry of porcelain.split(NUL)) {
    if (!entry.startsWith('u ')) continue
    const lastSpace = entry.lastIndexOf(' ')
    if (lastSpace > 0) out.push(entry.slice(lastSpace + 1))
  }
  return out
}

async function getConflictedFiles(workspaceRoot: string): Promise<string[]> {
  try {
    const r = await runGit(
      workspaceRoot,
      ['status', '--porcelain=v2', '-z', '--untracked-files=no'],
      { throwOnNonZero: false },
    )
    return parseConflictedFiles(r.stdout)
  } catch {
    return []
  }
}

async function countAppliedCommits(workspaceRoot: string): Promise<number> {
  try {
    const r = await runGit(workspaceRoot, ['rev-list', '--count', 'HEAD@{1}..HEAD'], {
      throwOnNonZero: false,
    })
    if (r.code !== 0) return 0
    const n = Number.parseInt(r.stdout.trim(), 10)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

register('git.pull', async (raw): Promise<Result> => {
  const params = Params.parse(raw)

  return withWorkspaceLock(params.workspaceRoot, async () => {
    // Verify we are on a branch (detached HEAD can't pull meaningfully).
    const headRef = await runGit(params.workspaceRoot, ['symbolic-ref', '--short', 'HEAD'], {
      throwOnNonZero: false,
    })
    if (headRef.code !== 0) {
      throw new RpcError(GIT_RPC_CODE, 'HEAD đang detached, không thể pull', {
        gitCode: GitErrorCode.INVALID_REF,
      })
    }

    suppressEchoFor(params.workspaceRoot)
    const args = ['pull', '--progress']
    if (params.strategy === 'ff-only') args.push('--ff-only')
    else if (params.strategy === 'merge') args.push('--no-rebase')
    else args.push('--rebase')

    const { stdout, stderr, code } = await runGitStreaming({
      workspaceRoot: params.workspaceRoot,
      args,
      op: 'pull',
    })

    if (code !== 0) {
      const sanitized = sanitizeStderr(stderr)
      const authHint = detectAuthHint(stderr)
      if (authHint) {
        throw new RpcError(GIT_RPC_CODE, 'Authentication failed', {
          gitCode: GitErrorCode.AUTH_FAILED,
          hint: authHint,
          stderrSanitized: sanitized,
        })
      }
      const merged = `${stdout}\n${stderr}`
      if (/CONFLICT/i.test(merged)) {
        const files = await getConflictedFiles(params.workspaceRoot)
        throw new RpcError(GIT_RPC_CODE, 'Merge conflict', {
          gitCode: GitErrorCode.MERGE_CONFLICT,
          files,
          stderrSanitized: sanitized,
        })
      }
      if (
        /not possible to fast-forward/i.test(stderr) ||
        /divergent branches/i.test(stderr) ||
        /refusing to merge unrelated histories/i.test(stderr)
      ) {
        throw new RpcError(GIT_RPC_CODE, 'Branch diverge với upstream', {
          gitCode: GitErrorCode.NOT_FAST_FORWARD,
          stderrSanitized: sanitized,
        })
      }
      throw new RpcError(GIT_RPC_CODE, sanitized || `git pull exit ${code}`, {
        gitCode: GitErrorCode.UNKNOWN,
        stderrSanitized: sanitized,
      })
    }

    const fastForwarded = /Fast-forward/i.test(stdout)
    const commitsApplied = await countAppliedCommits(params.workspaceRoot)
    return { ok: true, fastForwarded, commitsApplied }
  })
})
