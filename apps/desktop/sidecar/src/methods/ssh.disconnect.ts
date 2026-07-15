// Close a live SSH connection (ADR 0063 P2). Idempotent — a stale connId is a
// no-op. The disconnect surfaces to the UI as an ssh:status-changed event.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sshManager } from '../ssh/manager.js'

const Params = z.object({
  connId: z.string().min(1).max(64),
})

register('ssh.disconnect', (raw): { ok: true } => {
  const params = Params.parse(raw)
  sshManager.disconnect(params.connId)
  return { ok: true }
})
