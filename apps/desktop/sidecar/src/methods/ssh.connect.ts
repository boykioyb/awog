// Open an interactive SSH shell (ADR 0063 P2). Streams output via ssh:data and
// closure via ssh:exit; host-key prompts arrive as ssh:host-key-prompt. The
// connId is generated sidecar-side and returned to the UI.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { SSH_ID_RE } from '../ssh/schema.js'
import { sshManager } from '../ssh/manager.js'

const Params = z.object({
  hostId: z.string().regex(SSH_ID_RE),
  cols: z.number().int().positive().max(1000),
  rows: z.number().int().positive().max(1000),
})

register('ssh.connect', async (raw): Promise<{ connId: string }> => {
  const params = Params.parse(raw)
  return sshManager.connect(params)
})
