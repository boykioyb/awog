// `git.mergeAbort` — `git merge --abort`. Restores HEAD + working tree to
// pre-merge state. Refuses cleanly when no merge is in progress so the UI
// doesn't surface a confusing native git error. Per ADR 0017 + spec AC-36.
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({ workspaceRoot: z.string().min(1) })

async function isMerging(workspaceRoot: string): Promise<boolean> {
  try {
    await access(join(workspaceRoot, '.git', 'MERGE_HEAD'))
    return true
  } catch {
    return false
  }
}

register('git.mergeAbort', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  if (!(await isMerging(params.workspaceRoot))) {
    throw new RpcError(GIT_RPC_CODE, 'Không có merge đang chạy', {
      gitCode: GitErrorCode.INVALID_REF,
    })
  }

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    await runGit(params.workspaceRoot, ['merge', '--abort'])
  })

  emit('git:status:changed', { reason: 'checkout', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
