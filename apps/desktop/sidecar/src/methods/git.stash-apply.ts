// `git.stashApply` — `git stash apply stash@{N}`. Same semantics as pop but
// keeps the entry. Conflict → `hasConflict: true` for UI routing.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { asConflictError } from '../git/conflict-state.js'
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
}

register('git.stashApply', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const ref = `stash@{${params.index}}`

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    const r = await runGit(params.workspaceRoot, ['stash', 'apply', ref], {
      throwOnNonZero: false,
    })

    // Conflicts come back as the same MERGE_CONFLICT envelope every other
    // conflict-capable op throws (merge / rebase / cherry-pick / revert / pull),
    // so the UI has ONE thing to branch on. This used to resolve with a
    // `hasConflict` flag instead — a second contract for the same situation,
    // decided by grepping the output for the word "conflict", which git
    // translates on a non-English machine.
    const conflict = await asConflictError(params.workspaceRoot, undefined, 'Stash conflict')
    if (conflict) {
      emit('git:status:changed', { reason: 'stash', workspaceRoot: params.workspaceRoot })
      throw conflict
    }
    if (r.code !== 0) {
      throw new RpcError(GIT_RPC_CODE, (r.stderr || '').trim() || 'git stash apply thất bại', {
        gitCode: GitErrorCode.UNKNOWN,
      })
    }

    emit('git:status:changed', { reason: 'stash', workspaceRoot: params.workspaceRoot })
    return { ok: true as const }
  })
})
