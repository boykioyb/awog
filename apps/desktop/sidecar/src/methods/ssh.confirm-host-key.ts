// Answer a parked host-key prompt (ADR 0063 P2, TOFU). Resolves ssh2's held
// verify callback: accept → continue the handshake; accept+remember → also
// append the key to ~/.ssh/known_hosts; reject → fail the handshake cleanly.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sshManager } from '../ssh/manager.js'

const Params = z.object({
  connId: z.string().min(1).max(64),
  accept: z.boolean(),
  remember: z.boolean(),
})

register('ssh.confirmHostKey', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  await sshManager.confirmHostKey(params.connId, params.accept, params.remember)
  return { ok: true }
})
