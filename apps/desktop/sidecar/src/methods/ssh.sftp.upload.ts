// Upload a local file (home-dir sandboxed) to a remote path (ADR 0063 P3).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpUpload } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  localPath: z.string().min(1).max(4096),
  remotePath: z.string().min(1).max(4096),
})

register('ssh.sftp.upload', async (raw) => {
  const p = Params.parse(raw)
  return sftpUpload(p.connId, p.localPath, p.remotePath)
})
