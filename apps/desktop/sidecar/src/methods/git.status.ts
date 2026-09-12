import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { parsePorcelainV2 } from '../git/parser.js'
import { attachGitWatcher } from '../git/watcher.js'
import { GitErrorCode } from '../git/error-map.js'
import { pendingOpOf } from '../git/conflict-state.js'
import type { GitStatus } from '../git/types.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  includeIgnored: z.boolean().optional(),
})

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

  const pendingOp = await pendingOpOf(params.workspaceRoot)

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
    // Kept as derived booleans so existing call sites keep working; `pendingOp`
    // is the one that can also say cherry-pick / revert.
    isMerging: pendingOp === 'merge',
    isRebasing: pendingOp === 'rebase',
    pendingOp,
    conflictedCount,
  }
  if (parsed.detachedAt !== undefined) status.detachedAt = parsed.detachedAt
  return status
})
