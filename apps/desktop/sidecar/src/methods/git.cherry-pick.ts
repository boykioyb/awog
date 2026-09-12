// `git.cherryPick` — apply a commit on top of HEAD. Conflicts surface as the
// standard MERGE_CONFLICT envelope so the UI can route into the conflict
// resolver. Per ADR 0017.
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
})

interface Result {
  ok: true
  sha: string
  sha7: string
}

register('git.cherryPick', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  if (!SHA_RE.test(params.sha)) {
    throw new RpcError(GIT_RPC_CODE, 'Invalid sha', { gitCode: GitErrorCode.INVALID_REF })
  }

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    try {
      await runGit(params.workspaceRoot, ['cherry-pick', params.sha])
    } catch (err) {
      const conflict = await asConflictError(params.workspaceRoot, err, 'Merge conflict')
      if (conflict) throw conflict
      throw err
    }

    const head = await runGit(params.workspaceRoot, ['rev-parse', 'HEAD'])
    const sha = head.stdout.trim()
    const sha7 = sha.slice(0, 7)

    emit('git:status:changed', { reason: 'commit', workspaceRoot: params.workspaceRoot })
    return { ok: true, sha, sha7 }
  })
})
