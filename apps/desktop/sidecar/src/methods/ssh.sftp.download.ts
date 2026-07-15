// Download a remote file to a local path (home-dir sandboxed) (ADR 0063 P3).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpDownload } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  remotePath: z.string().min(1).max(4096),
  localPath: z.string().min(1).max(4096),
})

register('ssh.sftp.download', async (raw) => {
  const p = Params.parse(raw)
  return sftpDownload(p.connId, p.remotePath, p.localPath)
})
