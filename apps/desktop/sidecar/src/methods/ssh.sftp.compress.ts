// Compress remote entries into an archive. Shell-backed (zip/tar/rar/7z); the
// format is an allowlist enum and every path is shell-quoted (see ssh/sftp.ts).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpCompress } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  cwd: z.string().min(1).max(4096),
  format: z.enum(['zip', 'tar.gz', 'tar.bz2', 'tar.xz', 'rar', '7z']),
  entries: z.array(z.string().min(1).max(4096)).min(1).max(5000),
  archiveName: z.string().min(1).max(4096),
})

register('ssh.sftp.compress', async (raw) => {
  const p = Params.parse(raw)
  return sftpCompress(p.connId, p.cwd, p.format, p.entries, p.archiveName)
})
