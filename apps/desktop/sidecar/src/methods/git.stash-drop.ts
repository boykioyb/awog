// `git.stashDrop` — `git stash drop stash@{N}`. No working-tree change so we
// emit with reason `external` (refresh stash list, not status diff). Per ADR
// 0017 + spec AC-25.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  index: z.number().int().nonnegative(),
})

register('git.stashDrop', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  const ref = `stash@{${params.index}}`

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    await runGit(params.workspaceRoot, ['stash', 'drop', ref])
  })

  emit('git:status:changed', { reason: 'external', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
