// Start a port-forward (local/remote/dynamic) over an open SSH connection
// (ADR 0063 P4). Local/dynamic bind 127.0.0.1 by default (invariant 6).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { PortForwardSchema } from '../ssh/schema.js'
import { startForward } from '../ssh/forward.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  forward: PortForwardSchema,
})

register('ssh.forward.start', async (raw) => {
  const p = Params.parse(raw)
  return startForward(p.connId, p.forward)
})
