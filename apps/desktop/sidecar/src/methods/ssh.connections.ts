// List live SSH connections (ADR 0063 P2). Non-secret: only connId + hostId.

import { register } from '../transport/rpc.js'
import { sshManager, type SshConnectionRef } from '../ssh/manager.js'

register('ssh.connections', (): { connections: SshConnectionRef[] } => {
  return { connections: sshManager.list() }
})
