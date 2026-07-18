// Read-only: return every persisted VPN profile (ADR 0065 P0). No secret is
// included — credentials live in the keychain and are never round-tripped. The
// hasUserPass / hasKeyPassphrase flags are hydrated from the keychain (existence
// only, never the values) so the UI shows an accurate "credential set" state
// regardless of what the on-disk config claims. Live status (P1) layers on later.

import { register } from '../transport/rpc.js'
import { listProfiles } from '../vpn/store.js'
import { vpnCredentialFlags } from '../vpn/credentials.js'

register('vpn.list', async () => {
  const profiles = await listProfiles()
  const hydrated = await Promise.all(
    profiles.map(async (p) => ({ ...p, ...(await vpnCredentialFlags(p.id)) })),
  )
  return { profiles: hydrated }
})
