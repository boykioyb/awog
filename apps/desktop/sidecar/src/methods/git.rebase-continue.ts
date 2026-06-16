// `git.rebaseContinue` — resume an in-progress rebase after conflicts are
// resolved (`git rebase --continue`). May surface another MERGE_CONFLICT if a
// later commit conflicts. Refuses cleanly when no rebase is in progress.
// Per ADR 0040.
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode, sanitizeStderr } from '../git/error-map.js'
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

const NUL = String.fromCharCode(0)

async function getConflictedFiles(workspaceRoot: string): Promise<string[]> {
  try {
    const r = await runGit(
      workspaceRoot,
      ['status', '--porcelain=v2', '-z', '--untracked-files=no'],
      { throwOnNonZero: false },
    )
    const out: string[] = []
    for (const entry of r.stdout.split(NUL)) {
      if (!entry.startsWith('u ')) continue
      const lastSpace = entry.lastIndexOf(' ')
      if (lastSpace > 0) out.push(entry.slice(lastSpace + 1))
    }
    return out
  } catch {
    return []
  }
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
      const data = (err as RpcError).data as { stderrSanitized?: string } | undefined
      const stderr = data?.stderrSanitized ?? ''
      if (/CONFLICT/i.test(stderr) || /could not apply/i.test(stderr) || /resolve all conflicts/i.test(stderr)) {
        const files = await getConflictedFiles(params.workspaceRoot)
        throw new RpcError(GIT_RPC_CODE, 'Rebase conflict', {
          gitCode: GitErrorCode.MERGE_CONFLICT,
          files,
          rebase: true,
          stderrSanitized: sanitizeStderr(stderr),
        })
      }
      throw err
    }

    const head = await runGit(params.workspaceRoot, ['rev-parse', 'HEAD'])
    const sha = head.stdout.trim()
    const sha7 = sha.slice(0, 7)
    emit('git:status:changed', { reason: 'commit', workspaceRoot: params.workspaceRoot })
    return { ok: true, sha, sha7 }
  })
})
