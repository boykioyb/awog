// Stop a running port-forward by id (ADR 0063 P4).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { stopForward } from '../ssh/forward.js'

const Params = z.object({
  forwardId: z.string().min(1).max(128),
})

register('ssh.forward.stop', async (raw) => {
  const p = Params.parse(raw)
  return stopForward(p.forwardId)
})
