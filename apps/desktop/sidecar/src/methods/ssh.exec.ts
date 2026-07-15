// Run a one-shot command over an existing SSH connection (ADR 0063 P2). Returns
// captured stdout/stderr + exit code.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sshManager } from '../ssh/manager.js'

const Params = z.object({
  connId: z.string().min(1).max(64),
  command: z.string().min(1).max(100_000),
})

register(
  'ssh.exec',
  async (raw): Promise<{ stdout: string; stderr: string; code: number }> => {
    const params = Params.parse(raw)
    return sshManager.exec(params.connId, params.command)
  },
)
