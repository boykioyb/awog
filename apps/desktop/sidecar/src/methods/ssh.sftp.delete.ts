// Delete a remote file or directory (recursive optional) (ADR 0063 P3).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpDelete } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  path: z.string().min(1).max(4096),
  recursive: z.boolean().optional(),
})

register('ssh.sftp.delete', async (raw) => {
  const p = Params.parse(raw)
  return sftpDelete(p.connId, p.path, p.recursive ?? false)
})
