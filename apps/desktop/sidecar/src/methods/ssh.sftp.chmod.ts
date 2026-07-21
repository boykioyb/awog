// Change permission bits on a remote path over native SFTP (no shell).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpChmod } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  path: z.string().min(1).max(4096),
  // Standard POSIX permission range (includes setuid/setgid/sticky bits).
  mode: z.number().int().min(0).max(0o7777),
})

register('ssh.sftp.chmod', async (raw) => {
  const p = Params.parse(raw)
  return sftpChmod(p.connId, p.path, p.mode)
})
