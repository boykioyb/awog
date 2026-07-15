// List a remote directory over an open SSH connection (ADR 0063 P3).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpList } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  path: z.string().min(1).max(4096),
})

register('ssh.sftp.list', async (raw) => {
  const p = Params.parse(raw)
  return sftpList(p.connId, p.path)
})
