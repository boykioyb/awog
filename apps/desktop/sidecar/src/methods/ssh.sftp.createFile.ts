// Create a new empty remote file (fails if the path already exists).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpCreateFile } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  path: z.string().min(1).max(4096),
})

register('ssh.sftp.createFile', async (raw) => {
  const p = Params.parse(raw)
  return sftpCreateFile(p.connId, p.path)
})
