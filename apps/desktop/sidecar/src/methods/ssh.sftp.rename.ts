// Rename / move a remote path (ADR 0063 P3).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpRename } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  from: z.string().min(1).max(4096),
  to: z.string().min(1).max(4096),
})

register('ssh.sftp.rename', async (raw) => {
  const p = Params.parse(raw)
  return sftpRename(p.connId, p.from, p.to)
})
