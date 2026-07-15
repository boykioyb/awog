// Resize the PTY window of a live SSH shell (ADR 0063 P2).

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sshManager } from '../ssh/manager.js'

const Params = z.object({
  connId: z.string().min(1).max(64),
  cols: z.number().int().positive().max(1000),
  rows: z.number().int().positive().max(1000),
})

register('ssh.resize', (raw): { ok: true } => {
  const params = Params.parse(raw)
  sshManager.resize(params.connId, params.cols, params.rows)
  return { ok: true }
})
