// `git.branchDelete` — `git branch -d` (safe) or `git branch -D` (force).
// `not fully merged` rejection bubbles up as UNMERGED so the UI can prompt
// for force delete. Per ADR 0017 + spec AC-29.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { assertValidBranchName } from '../git/ref-validate.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  name: z.string().min(1),
  force: z.boolean().optional(),
  // When true, also `git push <remote> --delete <name>` after the local delete
  // succeeds. Remote failure does NOT roll back the local delete — the result
  // surfaces `remoteDeleted: false` + `remoteError` so the UI can warn.
  deleteRemote: z.boolean().optional(),
  remote: z.string().min(1).optional(),
})

interface BranchDeleteResult {
  ok: true
  remoteDeleted: boolean
  remoteError?: string
}

function isUnmergedError(err: unknown): boolean {
  if (!(err instanceof RpcError)) return false
  const data = err.data as { gitCode?: string; stderrSanitized?: string } | undefined
  if (data?.gitCode === GitErrorCode.UNMERGED) return true
  return (data?.stderrSanitized ?? '').toLowerCase().includes('not fully merged')
}

register('git.branchDelete', async (raw): Promise<BranchDeleteResult> => {
  const params = Params.parse(raw)
  assertValidBranchName(params.name)
  const remote = params.remote ?? 'origin'

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    const flag = params.force ? '-D' : '-d'
    try {
      await runGit(params.workspaceRoot, ['branch', flag, params.name])
    } catch (err) {
      if (isUnmergedError(err)) {
        throw new RpcError(GIT_RPC_CODE, 'Branch chưa được merge', {
          gitCode: GitErrorCode.UNMERGED,
        })
      }
      throw err
    }
  })

  let remoteDeleted = false
  let remoteError: string | undefined
  if (params.deleteRemote) {
    try {
      await withWorkspaceLock(params.workspaceRoot, async () => {
        suppressEchoFor(params.workspaceRoot)
        await runGit(params.workspaceRoot, ['push', remote, '--delete', params.name])
      })
      remoteDeleted = true
    } catch (err) {
      remoteError = err instanceof Error ? err.message : String(err)
    }
  }

  emit('git:status:changed', { reason: 'external', workspaceRoot: params.workspaceRoot })
  const out: BranchDeleteResult = { ok: true, remoteDeleted }
  if (remoteError !== undefined) out.remoteError = remoteError
  return out
})
