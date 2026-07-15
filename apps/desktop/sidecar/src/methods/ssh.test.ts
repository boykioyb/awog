// Test an SSH host (ADR 0063 P2): connect (auth only), then disconnect. Returns
// a sanitized status; host-key verification still applies during the probe.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { SSH_ID_RE } from '../ssh/schema.js'
import { sshManager } from '../ssh/manager.js'

const Params = z.object({
  hostId: z.string().regex(SSH_ID_RE),
})

register(
  'ssh.test',
  async (raw): Promise<{ status: 'connected' | 'error'; error?: string }> => {
    const params = Params.parse(raw)
    return sshManager.test(params)
  },
)
