// `git.fetch` — long-running, streams `git:fetch:progress` events via stdio
// transport. Per ADR 0017 streaming notifications + spec AC-16..AC-18.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { runGitStreaming } from '../git/streaming.js'
import {
  GIT_RPC_CODE,
  GitErrorCode,
  detectAuthHint,
  mapStderrToCode,
  sanitizeStderr,
} from '../git/error-map.js'

const REMOTE_NAME = /^[a-zA-Z0-9._/-]+$/

const Params = z.object({
  workspaceRoot: z.string().min(1),
  remote: z.string().optional(),
  prune: z.boolean().optional(),
  // Optional gh account login to authenticate github.com HTTPS as (validated in
  // the streaming runner). Empty → OS keychain default, unchanged behavior.
  ghAccount: z.string().optional(),
})

interface UpdatedRef {
  ref: string
  oldSha: string
  newSha: string
}

interface Result {
  ok: true
  updated: UpdatedRef[]
}

// `   abc1234..def5678  main       -> origin/main`
// or `   abc1234..def5678  main       -> origin/main (fast-forward)`
const UPDATED_REF_LINE = /^\s+([0-9a-f]{4,40})\.\.([0-9a-f]{4,40})\s+\S+\s+->\s+(\S+)/i

function parseUpdatedRefs(stderr: string): UpdatedRef[] {
  const out: UpdatedRef[] = []
  for (const line of stderr.split(/\r?\n/)) {
    const m = UPDATED_REF_LINE.exec(line)
    if (m && m[1] && m[2] && m[3]) {
      out.push({ oldSha: m[1], newSha: m[2], ref: m[3] })
    }
  }
  return out
}

register('git.fetch', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  if (params.remote !== undefined && !REMOTE_NAME.test(params.remote)) {
    throw new RpcError(GIT_RPC_CODE, 'Remote name không hợp lệ', {
      gitCode: GitErrorCode.INVALID_REF,
    })
  }

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    const args = ['fetch', '--progress']
    if (params.prune) args.push('--prune')
    if (params.remote) args.push(params.remote)
    else args.push('--all')

    const { stderr, code } = await runGitStreaming({
      workspaceRoot: params.workspaceRoot,
      args,
      op: 'fetch',
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
      const gitCode = mapStderrToCode(stderr)
      throw new RpcError(GIT_RPC_CODE, sanitized || `git fetch exit ${code}`, {
        gitCode,
        stderrSanitized: sanitized,
      })
    }

    return { ok: true, updated: parseUpdatedRefs(stderr) }
  })
})
