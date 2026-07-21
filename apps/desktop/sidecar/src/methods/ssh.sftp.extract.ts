// Extract a remote archive. Shell-backed; the format is derived from the archive
// extension server-side and every path is shell-quoted (see ssh/sftp.ts).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpExtract } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  cwd: z.string().min(1).max(4096),
  archive: z.string().min(1).max(4096),
  dest: z.string().min(1).max(4096).optional(),
})

register('ssh.sftp.extract', async (raw) => {
  const p = Params.parse(raw)
  return sftpExtract(p.connId, p.cwd, p.archive, p.dest)
})
