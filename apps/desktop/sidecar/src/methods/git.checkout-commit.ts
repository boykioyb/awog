// `git.checkoutCommit` — detach HEAD at the given sha. Mirrors the dirty-tree
// handling from `git.branchCheckout`: on refusal we enrich the error with the
// unstaged + untracked file list so the UI can render GitDirtyCheckoutModal.
// Per ADR 0017.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { parsePorcelainV2 } from '../git/parser.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import type { GitFileStatus } from '../git/types.js'
import { emit } from '../transport/stdio.js'

const SHA_RE = /^[a-fA-F0-9]{4,40}$/

const Params = z.object({
  workspaceRoot: z.string().min(1),
  sha: z.string(),
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
  return parsePorcelainV2(r.stdout).files
}

register('git.checkoutCommit', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  if (!SHA_RE.test(params.sha)) {
    throw new RpcError(GIT_RPC_CODE, 'Invalid sha', { gitCode: GitErrorCode.INVALID_REF })
  }

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    try {
      await runGit(params.workspaceRoot, ['checkout', params.sha])
    } catch (err) {
      if (isDirtyTreeError(err)) {
        const files = await collectDirtyFiles(params.workspaceRoot).catch(
          () => [] as GitFileStatus[],
        )
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
