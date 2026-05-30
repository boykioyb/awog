import { z } from 'zod'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { parsePorcelainV2 } from '../git/parser.js'
import { attachGitWatcher } from '../git/watcher.js'
import { GitErrorCode } from '../git/error-map.js'
import type { GitStatus } from '../git/types.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  includeIgnored: z.boolean().optional(),
})

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

register('git.status', async (raw): Promise<GitStatus> => {
  const params = Params.parse(raw)
  const args = [
    'status',
    '--porcelain=v2',
    '-z',
    '--branch',
    '--untracked-files=all',
  ]
  if (params.includeIgnored) args.push('--ignored')

  // Bắt NO_REPO sớm: workspace tồn tại nhưng chưa init Git → propagate
  // RpcError với code NO_REPO để UI render empty state + CTA init.
  let result
  try {
    result = await runGit(params.workspaceRoot, args)
  } catch (err) {
    if (err instanceof RpcError) {
      const data = err.data as { gitCode?: string } | undefined
      if (data?.gitCode === GitErrorCode.NO_REPO) throw err
    }
    throw err
  }
  const parsed = parsePorcelainV2(result.stdout)

  const gitDir = join(params.workspaceRoot, '.git')
  const [isMerging, isRebaseMerge, isRebaseApply] = await Promise.all([
    exists(join(gitDir, 'MERGE_HEAD')),
    exists(join(gitDir, 'rebase-merge')),
    exists(join(gitDir, 'rebase-apply')),
  ])

  // Lazy-attach the watcher on first status call per workspace.
  attachGitWatcher(params.workspaceRoot)

  const conflictedCount = parsed.files.filter((f) => f.changeType === 'conflicted').length

  const status: GitStatus = {
    branch: parsed.branch,
    detached: parsed.detached,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    files: parsed.files,
    isMerging,
    isRebasing: isRebaseMerge || isRebaseApply,
    conflictedCount,
  }
  if (parsed.detachedAt !== undefined) status.detachedAt = parsed.detachedAt
  return status
})
