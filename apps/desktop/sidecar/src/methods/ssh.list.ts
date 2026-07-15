// Read-only: return every persisted SSH host + identity config (ADR 0063 P0).
// No secret is included — passwords/passphrases/keys live in the keychain and
// are never round-tripped. Live connection status (P2) layers on separately.

import { register } from '../transport/rpc.js'
import { listHosts, listIdentities } from '../ssh/store.js'

register('ssh.list', async () => {
  const [hosts, identities] = await Promise.all([listHosts(), listIdentities()])
  return { hosts, identities }
})
