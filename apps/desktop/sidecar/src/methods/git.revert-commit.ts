// `git.revertCommit` — create an inverse commit. With `noCommit: true` the
// inverse is staged but not committed (so the user can amend the message).
// Conflicts surface as MERGE_CONFLICT. Per ADR 0017.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { asConflictError } from '../git/conflict-state.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { emit } from '../transport/stdio.js'

const SHA_RE = /^[a-fA-F0-9]{4,40}$/

const Params = z.object({
  workspaceRoot: z.string().min(1),
  sha: z.string(),
  noCommit: z.boolean().optional(),
})

interface Result {
  ok: true
  sha?: string
  sha7?: string
}

register('git.revertCommit', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  if (!SHA_RE.test(params.sha)) {
    throw new RpcError(GIT_RPC_CODE, 'Invalid sha', { gitCode: GitErrorCode.INVALID_REF })
  }

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    const args = ['revert']
    if (params.noCommit) args.push('--no-commit')
    else args.push('--no-edit')
    args.push(params.sha)

    try {
      await runGit(params.workspaceRoot, args)
    } catch (err) {
      const conflict = await asConflictError(params.workspaceRoot, err, 'Merge conflict')
      if (conflict) throw conflict
      throw err
    }

    emit('git:status:changed', { reason: 'commit', workspaceRoot: params.workspaceRoot })

    if (params.noCommit) {
      // No new commit was created — caller will compose the message and run
      // `git.commit` next.
      return { ok: true }
    }
    const head = await runGit(params.workspaceRoot, ['rev-parse', 'HEAD'])
    const sha = head.stdout.trim()
    return { ok: true, sha, sha7: sha.slice(0, 7) }
  })
})
