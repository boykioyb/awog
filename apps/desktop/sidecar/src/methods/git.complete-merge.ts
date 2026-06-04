// `git.completeMerge` — finish an in-progress merge with `git commit`.
// Refuses if there are still unresolved conflicts (defense in depth: even if
// the UI thinks resolution is done, sidecar re-checks via `diff --name-only
// --diff-filter=U`). Per ADR 0017 + spec AC-35.
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  message: z.string().optional(),
})

interface Result {
  sha: string
  sha7: string
}

async function isMerging(workspaceRoot: string): Promise<boolean> {
  try {
    await access(join(workspaceRoot, '.git', 'MERGE_HEAD'))
    return true
  } catch {
    return false
  }
}

register('git.completeMerge', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  if (!(await isMerging(params.workspaceRoot))) {
    throw new RpcError(GIT_RPC_CODE, 'Không có merge đang chạy', {
      gitCode: GitErrorCode.INVALID_REF,
    })
  }

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)

    const remaining = await runGit(params.workspaceRoot, [
      'diff',
      '--name-only',
      '--diff-filter=U',
    ])
    const files = remaining.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (files.length > 0) {
      throw new RpcError(GIT_RPC_CODE, `Còn ${files.length} file conflict chưa resolve`, {
        gitCode: GitErrorCode.MERGE_CONFLICT,
        files,
      })
    }

    const trimmed = params.message?.trim() ?? ''
    if (trimmed.length > 0) {
      await runGit(params.workspaceRoot, ['commit', '-F', '-'], { stdin: trimmed })
    } else {
      await runGit(params.workspaceRoot, ['commit', '--no-edit'])
    }

    const head = await runGit(params.workspaceRoot, ['rev-parse', 'HEAD'])
    const sha = head.stdout.trim()
    const sha7 = sha.slice(0, 7)

    emit('git:status:changed', { reason: 'commit', workspaceRoot: params.workspaceRoot })
    return { sha, sha7 }
  })
})
