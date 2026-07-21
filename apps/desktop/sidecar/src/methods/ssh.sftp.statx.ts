// Best-effort enrichment of a directory listing with owner/group NAMES + ctime
// (not carried by the SFTP protocol). Shell-backed (stat); paths are shell-quoted
// and the listing degrades to numeric uid/gid on any failure (see ssh/sftp.ts).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpStatx } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  dir: z.string().min(1).max(4096),
  names: z.array(z.string().min(1).max(4096)).max(5000),
})

register('ssh.sftp.statx', async (raw) => {
  const p = Params.parse(raw)
  return sftpStatx(p.connId, p.dir, p.names)
})
