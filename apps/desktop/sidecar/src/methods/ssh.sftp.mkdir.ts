// Create a remote directory (ADR 0063 P3).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpMkdir } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  path: z.string().min(1).max(4096),
})

register('ssh.sftp.mkdir', async (raw) => {
  const p = Params.parse(raw)
  return sftpMkdir(p.connId, p.path)
})
