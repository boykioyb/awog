// Report which archive tools exist on the remote so the UI can grey out
// unavailable compress/extract formats. Constant command, no UI input.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpToolcheck } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
})

register('ssh.sftp.toolcheck', async (raw) => {
  const p = Params.parse(raw)
  return sftpToolcheck(p.connId)
})
