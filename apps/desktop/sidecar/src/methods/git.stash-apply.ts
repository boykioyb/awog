// `git.stashApply` — `git stash apply stash@{N}`. Same semantics as pop but
// keeps the entry. Conflict → `hasConflict: true` for UI routing.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  index: z.number().int().nonnegative(),
})

interface Result {
  ok: true
  hasConflict: boolean
}

register('git.stashApply', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const ref = `stash@{${params.index}}`

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    const r = await runGit(params.workspaceRoot, ['stash', 'apply', ref], {
      throwOnNonZero: false,
    })
    const stderr = r.stderr || ''
    const stdout = r.stdout || ''
    const conflict = /conflict/i.test(stderr) || /conflict/i.test(stdout)

    if (r.code !== 0 && !conflict) {
      throw new RpcError(GIT_RPC_CODE, stderr.trim() || 'git stash apply thất bại', {
        gitCode: GitErrorCode.UNKNOWN,
      })
    }

    emit('git:status:changed', { reason: 'stash', workspaceRoot: params.workspaceRoot })
    return { ok: true as const, hasConflict: conflict }
  })
})
