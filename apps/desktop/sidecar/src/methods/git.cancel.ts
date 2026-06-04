// `git.cancel` — SIGTERM (→ 2s → SIGKILL) the in-flight fetch/pull/push for
// the given workspace. Per ADR 0017 OQ-4 + spec AC-45.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { cancelOp } from '../git/streaming.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  op: z.enum(['fetch', 'pull', 'push']),
})

register('git.cancel', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  return cancelOp(params.workspaceRoot, params.op)
})
