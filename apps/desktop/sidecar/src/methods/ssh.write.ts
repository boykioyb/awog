// Write raw keystrokes to a live SSH shell (ADR 0063 P2). Opaque bytes piped to
// the channel's stdin — no shell concatenation.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sshManager } from '../ssh/manager.js'

const Params = z.object({
  connId: z.string().min(1).max(64),
  data: z.string(),
})

register('ssh.write', (raw): { ok: true } => {
  const params = Params.parse(raw)
  sshManager.write(params.connId, params.data)
  return { ok: true }
})
