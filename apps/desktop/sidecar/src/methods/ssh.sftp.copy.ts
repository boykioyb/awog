// Copy remote files/dirs (recursive) to a destination. Shell-backed (cp); every
// path is shell-quoted server-side (see ssh/sftp.ts).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpCopy } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  sources: z.array(z.string().min(1).max(4096)).min(1).max(5000),
  dest: z.string().min(1).max(4096),
})

register('ssh.sftp.copy', async (raw) => {
  const p = Params.parse(raw)
  return sftpCopy(p.connId, p.sources, p.dest)
})
