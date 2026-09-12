// `git.stashPop` — `git stash pop stash@{N}`. Per ADR 0017 + spec AC-24.
// On conflict git KEEPS the stash entry (so nothing is lost) — `stashKept`
// says so, and the entry is still in the list afterwards.
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

register('git.stashPop', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const ref = `stash@{${params.index}}`

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    const r = await runGit(params.workspaceRoot, ['stash', 'pop', ref], {
      throwOnNonZero: false,
    })

    // Conflicts come back as the same MERGE_CONFLICT envelope every other
    // conflict-capable op throws (merge / rebase / cherry-pick / revert / pull),
    // so the UI has ONE thing to branch on. This used to resolve with a
    // `hasConflict` flag instead — a second contract for the same situation,
    // decided by grepping the output for the word "conflict", which git
    // translates on a non-English machine.
    const conflict = await asConflictError(params.workspaceRoot, undefined, 'Stash conflict', { stashKept: true })
    if (conflict) {
      emit('git:status:changed', { reason: 'stash', workspaceRoot: params.workspaceRoot })
      throw conflict
    }
    if (r.code !== 0) {
      throw new RpcError(GIT_RPC_CODE, (r.stderr || '').trim() || 'git stash pop thất bại', {
        gitCode: GitErrorCode.UNKNOWN,
      })
    }

    emit('git:status:changed', { reason: 'stash', workspaceRoot: params.workspaceRoot })
    return { ok: true as const }
  })
})
