// `git.rebaseSkip` — drop the conflicting commit and carry on (`git rebase --skip`).
// Refuses cleanly when no rebase is in progress so the UI can't fire it into
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

register('git.rebaseSkip', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  if ((await pendingOpOf(params.workspaceRoot)) !== 'rebase') {
    throw new RpcError(GIT_RPC_CODE, 'Không có rebase đang chạy', {
      gitCode: GitErrorCode.INVALID_REF,
    })
  }

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    try {
      await runGit(params.workspaceRoot, ['rebase', '--skip'])
    } catch (err) {
      const conflict = await asConflictError(params.workspaceRoot, err, 'Rebase conflict', { rebase: true })
      if (conflict) throw conflict
      throw err
    }
    emit('git:status:changed', { reason: 'commit', workspaceRoot: params.workspaceRoot })
    return { ok: true }
  })
})
