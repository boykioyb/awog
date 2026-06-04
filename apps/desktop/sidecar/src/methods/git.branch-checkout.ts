// `git.branchCheckout` — switch HEAD to `name`. On dirty-tree refusal we
// enrich the error with the unstaged + untracked file list so the UI can
// render `GitDirtyCheckoutModal` with actionable choices (Stash / Force /
// Cancel). Per ADR 0017 + spec AC-26..AC-31 + Flow 4.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { parsePorcelainV2 } from '../git/parser.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { assertValidBranchName } from '../git/ref-validate.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import type { GitFileStatus } from '../git/types.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  name: z.string().min(1),
  force: z.boolean().optional(),
})

const DIRTY_HINTS = [
  'would be overwritten',
  'local changes',
  'would overwrite untracked',
]

function isDirtyTreeError(err: unknown): boolean {
  if (!(err instanceof RpcError)) return false
  const data = err.data as { gitCode?: string; stderrSanitized?: string } | undefined
  if (data?.gitCode === GitErrorCode.DIRTY_TREE) return true
  const stderr = (data?.stderrSanitized ?? '').toLowerCase()
  return DIRTY_HINTS.some((h) => stderr.includes(h))
}

async function collectDirtyFiles(workspaceRoot: string): Promise<GitFileStatus[]> {
  const r = await runGit(workspaceRoot, [
    'status',
    '--porcelain=v2',
    '-z',
    '--branch',
    '--untracked-files=all',
  ])
  const parsed = parsePorcelainV2(r.stdout)
  return parsed.files
}

register('git.branchCheckout', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  assertValidBranchName(params.name)

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    const args = ['checkout']
    if (params.force) args.push('-f')
    args.push(params.name)
    try {
      await runGit(params.workspaceRoot, args)
    } catch (err) {
      if (isDirtyTreeError(err)) {
        const files = await collectDirtyFiles(params.workspaceRoot).catch(() => [] as GitFileStatus[])
        throw new RpcError(GIT_RPC_CODE, 'Working tree dirty', {
          gitCode: GitErrorCode.DIRTY_TREE,
          files,
        })
      }
      throw err
    }
  })

  emit('git:status:changed', { reason: 'checkout', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
