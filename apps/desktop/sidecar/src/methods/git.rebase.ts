// `git.rebase` — replay the current branch onto another ref (non-interactive).
// Conflicts surface as the MERGE_CONFLICT envelope; the UI then finalizes via
// `git.rebaseContinue` / `git.rebaseAbort` (not `git commit`). Per ADR 0040.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { asConflictError } from '../git/conflict-state.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { emit } from '../transport/stdio.js'

const SAFE_REF_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/

const Params = z.object({
  workspaceRoot: z.string().min(1),
  onto: z.string().min(1),
})

interface Result {
  ok: true
  sha: string
  sha7: string
}

register('git.rebase', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  if (!SAFE_REF_RE.test(params.onto)) {
    throw new RpcError(GIT_RPC_CODE, 'Invalid ref', { gitCode: GitErrorCode.INVALID_REF })
  }

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    try {
      await runGit(params.workspaceRoot, ['rebase', params.onto])
    } catch (err) {
      const conflict = await asConflictError(params.workspaceRoot, err, 'Rebase conflict', { rebase: true })
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
