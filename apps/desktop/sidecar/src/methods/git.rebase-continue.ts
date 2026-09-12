// `git.rebaseContinue` — resume an in-progress rebase after conflicts are
// resolved (`git rebase --continue`). May surface another MERGE_CONFLICT if a
// later commit conflicts. Refuses cleanly when no rebase is in progress.
// Per ADR 0040.
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { asConflictError } from '../git/conflict-state.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({ workspaceRoot: z.string().min(1) })

interface Result {
  ok: true
  sha: string
  sha7: string
}

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

register('git.rebaseContinue', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  if (!(await isRebasing(params.workspaceRoot))) {
    throw new RpcError(GIT_RPC_CODE, 'Không có rebase đang chạy', {
      gitCode: GitErrorCode.INVALID_REF,
    })
  }

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    try {
      // `core.editor=true` makes git use the `true` command as the editor so
      // `--continue` reuses the existing commit message instead of hanging on
      // an interactive editor.
      await runGit(params.workspaceRoot, ['-c', 'core.editor=true', 'rebase', '--continue'])
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
