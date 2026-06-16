// `git.rebaseAbort` — `git rebase --abort`. Restores HEAD + working tree to the
// pre-rebase state. Refuses cleanly when no rebase is in progress so the UI
// doesn't surface a confusing native git error. Per ADR 0040.
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

async function isRebasing(workspaceRoot: string): Promise<boolean> {
  for (const dir of ['rebase-merge', 'rebase-apply']) {
    try {
      await access(join(workspaceRoot, '.git', dir))
      return true
    } catch {
      // try next
    }
  }
  return false
}

register('git.rebaseAbort', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  if (!(await isRebasing(params.workspaceRoot))) {
    throw new RpcError(GIT_RPC_CODE, 'Không có rebase đang chạy', {
      gitCode: GitErrorCode.INVALID_REF,
    })
  }

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    await runGit(params.workspaceRoot, ['rebase', '--abort'])
  })

  emit('git:status:changed', { reason: 'checkout', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
