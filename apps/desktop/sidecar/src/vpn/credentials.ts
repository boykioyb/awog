// VPN credential persistence — ADR 0065.
//
// A VPN profile may authenticate with a username/password and/or a private-key
// passphrase. Each is a secret and lives ONLY in the OS keychain — never in
// vpn-profiles/<id>.json, an RPC payload/response, a log line, or on disk as a
// temp file (invariant 1). At connect time (P1) they are pushed to openvpn via
// its management interface, not an --auth-user-pass file.
//
// A DISTINCT service namespace (`awog-vpn`) keeps it from colliding with
// `awog-ssh` / `awog-mcp` / `awog-source-*`. Account = `vpn/<id>`. One keychain
// entry per profile holds the credential as a JSON blob.

import { deleteKeychainValue, getKeychainValue, setKeychainValue } from '../credentials/keychain.js'
import { log } from '../util/logger.js'
import { VpnCredentialSchema } from './schema.js'
import type { VpnCredential } from './schema.js'

const VPN_SERVICE = 'awog-vpn'

function accountFor(id: string): string {
  return `vpn/${id}`
}

// Load the stored credential for a profile, or null if none / corrupt. Never
// throws — a keychain miss is a normal "no credential".
export async function loadVpnCredential(id: string): Promise<VpnCredential | null> {
  const raw = await getKeychainValue(VPN_SERVICE, accountFor(id))
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    const res = VpnCredentialSchema.safeParse(parsed)
    if (!res.success) {
      log.warn('vpn: stored credential has unexpected shape', { id })
      return null
    }
    return res.data
  } catch (err) {
    log.warn('vpn: failed to parse stored credential', {
      id,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// Persist a credential. Throws only if the keychain binding is unavailable
// (callers surface that as a clear error). The value never enters a log line.
export async function saveVpnCredential(id: string, cred: VpnCredential): Promise<void> {
  const parsed = VpnCredentialSchema.parse(cred)
  await setKeychainValue(VPN_SERVICE, accountFor(id), JSON.stringify(parsed))
}

// Remove a stored credential (best-effort). Wired into vpn.delete so a removed
// profile leaves no orphan secret behind.
export async function deleteVpnCredential(id: string): Promise<boolean> {
  return deleteKeychainValue(VPN_SERVICE, accountFor(id))
}

// Which credential kinds are stored — booleans only, never the values. Used to
// hydrate the profile's hasUserPass / hasKeyPassphrase UI flags at list time.
export async function vpnCredentialFlags(
  id: string,
): Promise<{ hasUserPass: boolean; hasKeyPassphrase: boolean }> {
  const cred = await loadVpnCredential(id)
  return {
    hasUserPass: !!cred && (!!cred.username || !!cred.password),
    hasKeyPassphrase: !!cred && !!cred.keyPassphrase,
  }
}
