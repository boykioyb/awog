// `git.merge` — merge a branch into the current HEAD. Conflicts surface as the
// standard MERGE_CONFLICT envelope so the UI routes into the conflict resolver
// (same shape as `git.cherryPick`). Per ADR 0040.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { asConflictError } from '../git/conflict-state.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { emit } from '../transport/stdio.js'

// Allowlist for refs coming from the UI: typical git-ref chars only, no leading
// dash (option injection) and no `..` (range/traversal). Args go through an
// array (never a shell string), so this is defense in depth.
const SAFE_REF_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/

const Params = z.object({
  workspaceRoot: z.string().min(1),
  branch: z.string().min(1),
})

interface Result {
  ok: true
  fastForward: boolean
  sha: string
  sha7: string
}

register('git.merge', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  if (!SAFE_REF_RE.test(params.branch)) {
    throw new RpcError(GIT_RPC_CODE, 'Invalid branch ref', { gitCode: GitErrorCode.INVALID_REF })
  }

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    let fastForward = false
    try {
      // `--no-edit` keeps the default merge-commit message (never opens an editor
      // that would hang the headless git process).
      const r = await runGit(params.workspaceRoot, ['merge', '--no-edit', params.branch])
      fastForward = /fast-forward/i.test(r.stdout)
    } catch (err) {
      const conflict = await asConflictError(params.workspaceRoot, err, 'Merge conflict')
      if (conflict) throw conflict
      throw err
    }

    const head = await runGit(params.workspaceRoot, ['rev-parse', 'HEAD'])
    const sha = head.stdout.trim()
    const sha7 = sha.slice(0, 7)
    emit('git:status:changed', { reason: 'commit', workspaceRoot: params.workspaceRoot })
    return { ok: true, fastForward, sha, sha7 }
  })
})
