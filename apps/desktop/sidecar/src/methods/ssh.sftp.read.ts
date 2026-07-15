// Read a capped slice of a remote file (base64) for preview (ADR 0063 P3).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpRead } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  path: z.string().min(1).max(4096),
  maxBytes: z.number().int().positive().max(5_000_000).optional(),
})

register('ssh.sftp.read', async (raw) => {
  const p = Params.parse(raw)
  return sftpRead(p.connId, p.path, p.maxBytes)
})
