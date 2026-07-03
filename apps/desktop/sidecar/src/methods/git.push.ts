// `git.push` — long-running. Spec AC-21..AC-22 + Flow 2 (non-ff recovery).
// Force push is exposed as `--force-with-lease` only (never bare `--force`),
// gated behind the double-confirm Push dialog — the precondition ADR 0017
// (OQ-12) set for lifting the original "no force flag" deferral.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { runGitStreaming } from '../git/streaming.js'
import {
  GIT_RPC_CODE,
  GitErrorCode,
  detectAuthHint,
  sanitizeStderr,
} from '../git/error-map.js'

const NAME = /^[a-zA-Z0-9._/-]+$/

const Params = z.object({
  workspaceRoot: z.string().min(1),
  remote: z.string().optional(),
  // Local branch to push (the source side of the refspec).
  branch: z.string().optional(),
  // Remote-side branch name when it differs from `branch` — builds a
  // `branch:targetBranch` refspec so the current branch can push to a
  // differently-named remote branch (the Push dialog's "To" picker).
  targetBranch: z.string().optional(),
  setUpstream: z.boolean().optional(),
  // `--force-with-lease` (safe force — aborts if the remote moved under us).
  force: z.boolean().optional(),
  // `--tags` — push all local tags alongside the branch.
  pushTags: z.boolean().optional(),
  // Optional gh account login to authenticate github.com HTTPS as (validated in
  // the streaming runner). Empty → OS keychain default, unchanged behavior.
  ghAccount: z.string().optional(),
})

interface Result {
  ok: true
  pushed: number
}

// `   abc1234..def5678  main -> main`
const PUSHED_REF_LINE = /^\s+[0-9a-f]{4,40}\.\.[0-9a-f]{4,40}\s+\S+\s+->\s+\S+/i
// `* [new branch]      main -> main`
const NEW_BRANCH_LINE = /^\s*\*\s+\[new branch\]/i

function countPushed(stderr: string): number {
  let n = 0
  for (const line of stderr.split(/\r?\n/)) {
    if (PUSHED_REF_LINE.test(line) || NEW_BRANCH_LINE.test(line)) n += 1
  }
  return n
}

register('git.push', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const remote = params.remote ?? 'origin'
  if (!NAME.test(remote)) {
    throw new RpcError(GIT_RPC_CODE, 'Remote name không hợp lệ', {
      gitCode: GitErrorCode.INVALID_REF,
    })
  }
  if (params.branch !== undefined && !NAME.test(params.branch)) {
    throw new RpcError(GIT_RPC_CODE, 'Branch name không hợp lệ', {
      gitCode: GitErrorCode.INVALID_REF,
    })
  }
  if (params.targetBranch !== undefined && !NAME.test(params.targetBranch)) {
    throw new RpcError(GIT_RPC_CODE, 'Target branch name không hợp lệ', {
      gitCode: GitErrorCode.INVALID_REF,
    })
  }

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    const args = ['push', '--progress']
    if (params.setUpstream) args.push('--set-upstream')
    // Never bare `--force`: `--force-with-lease` refuses to clobber commits the
    // remote gained since our last fetch (ADR 0017 OQ-12 safety constraint).
    if (params.force) args.push('--force-with-lease')
    args.push(remote)
    // Build the refspec server-side so the `:` never arrives from the UI as a
    // raw string (both sides are NAME-validated above). Same name → push the
    // branch as-is; different name → `local:remote` refspec.
    if (params.branch) {
      const refspec =
        params.targetBranch && params.targetBranch !== params.branch
          ? `${params.branch}:${params.targetBranch}`
          : params.branch
      args.push(refspec)
    }
    if (params.pushTags) args.push('--tags')

    const { stderr, code } = await runGitStreaming({
      workspaceRoot: params.workspaceRoot,
      args,
      op: 'push',
      ghAccount: params.ghAccount,
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
      if (/failed to push some refs/i.test(stderr) && /non-fast-forward/i.test(stderr)) {
        throw new RpcError(GIT_RPC_CODE, 'Remote có commit mới, cần pull trước', {
          gitCode: GitErrorCode.NOT_FAST_FORWARD,
          stderrSanitized: sanitized,
        })
      }
      if (
        /does not appear to be a git repository/i.test(stderr) ||
        /repository not found/i.test(stderr)
      ) {
        throw new RpcError(GIT_RPC_CODE, 'Remote không tồn tại', {
          gitCode: GitErrorCode.REMOTE_NOT_FOUND,
          stderrSanitized: sanitized,
        })
      }
      throw new RpcError(GIT_RPC_CODE, sanitized || `git push exit ${code}`, {
        gitCode: GitErrorCode.UNKNOWN,
        stderrSanitized: sanitized,
      })
    }

    return { ok: true, pushed: countPushed(stderr) }
  })
})
