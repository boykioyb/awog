// `git.cherryPickAbort` — restore the pre-cherry-pick state (`git cherry-pick --abort`).
// Refuses cleanly when no cherry-pick is in progress so the UI can't fire it into
// the void. Per ADR 0040.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { asConflictError, pendingOpOf } from '../git/conflict-state.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({ workspaceRoot: z.string().min(1) })

register('git.cherryPickAbort', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  if ((await pendingOpOf(params.workspaceRoot)) !== 'cherry-pick') {
    throw new RpcError(GIT_RPC_CODE, 'Không có cherry-pick đang chạy', {
      gitCode: GitErrorCode.INVALID_REF,
    })
  }

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    try {
      await runGit(params.workspaceRoot, ['cherry-pick', '--abort'])
    } catch (err) {
      const conflict = await asConflictError(params.workspaceRoot, err, 'Merge conflict')
      if (conflict) throw conflict
      throw err
    }
    emit('git:status:changed', { reason: 'commit', workspaceRoot: params.workspaceRoot })
    return { ok: true }
  })
})
