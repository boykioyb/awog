// List active port-forwards, optionally scoped to one connection (ADR 0063 P4).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listForwards } from '../ssh/forward.js'

const Params = z.object({
  connId: z.string().min(1).max(128).optional(),
})

register('ssh.forward.list', async (raw) => {
  const p = Params.parse(raw)
  return listForwards(p.connId)
})
