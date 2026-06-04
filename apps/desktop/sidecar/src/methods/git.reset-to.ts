// `git.resetTo` — move HEAD (and optionally index + working tree) to the
// target sha. `--hard` is destructive; UI MUST gate behind an explicit confirm
// with an additional acknowledgement checkbox. Per ADR 0017.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { emit } from '../transport/stdio.js'

const SHA_RE = /^[a-fA-F0-9]{4,40}$/

const Params = z.object({
  workspaceRoot: z.string().min(1),
  sha: z.string(),
  mode: z.enum(['soft', 'mixed', 'hard']),
})

register('git.resetTo', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  if (!SHA_RE.test(params.sha)) {
    throw new RpcError(GIT_RPC_CODE, 'Invalid sha', { gitCode: GitErrorCode.INVALID_REF })
  }

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    await runGit(params.workspaceRoot, ['reset', `--${params.mode}`, params.sha])
  })

  emit('git:status:changed', { reason: 'checkout', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
