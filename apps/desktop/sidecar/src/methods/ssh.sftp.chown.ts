// Change owner (and optional group) of remote paths. Shell-backed (chown); owner
// /group are charset-validated + shell-quoted server-side (see ssh/sftp.ts).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { sftpChown } from '../ssh/sftp.js'

const Params = z.object({
  connId: z.string().min(1).max(128),
  targets: z.array(z.string().min(1).max(4096)).min(1).max(5000),
  owner: z.string().min(1).max(256),
  group: z.string().max(256).optional(),
  recursive: z.boolean().optional(),
})

register('ssh.sftp.chown', async (raw) => {
  const p = Params.parse(raw)
  return sftpChown(p.connId, p.targets, p.owner, p.group, p.recursive)
})
