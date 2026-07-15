// SSH credential persistence — ADR 0063.
//
// A host authenticates with a password, or via an identity (a private key that
// may carry a passphrase, or pasted-inline key material). Every one of those is
// a secret and lives ONLY in the OS keychain — never in ssh-hosts/<id>.json,
// ssh-identities/<id>.json, an RPC payload/response, or a log line (invariant 1).
//
// A DISTINCT service namespace (`awog-ssh`) keeps it from colliding with
// `awog-mcp` / `awog-source-*`. Account = `<scope>/<id>` where scope is `host`
// or `identity` (mirrors the `<serverId>/<key>` account form of MCP secrets), so
// host id `foo` and identity id `foo` never overwrite each other. One keychain
// entry per entity holds the credential as a tagged-union JSON blob.

import { deleteKeychainValue, getKeychainValue, setKeychainValue } from '../credentials/keychain.js'
import { log } from '../util/logger.js'
import { SshCredentialSchema } from './schema.js'
import type { SshCredential } from './schema.js'

const SSH_SERVICE = 'awog-ssh'

export type SshCredentialScope = 'host' | 'identity'

function accountFor(scope: SshCredentialScope, id: string): string {
  return `${scope}/${id}`
}

// Load the stored credential for an entity, or null if none / corrupt. Never
// throws — a keychain miss is a normal "no credential".
export async function loadSshCredential(
  scope: SshCredentialScope,
  id: string,
): Promise<SshCredential | null> {
  const raw = await getKeychainValue(SSH_SERVICE, accountFor(scope, id))
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    const res = SshCredentialSchema.safeParse(parsed)
    if (!res.success) {
      log.warn('ssh: stored credential has unexpected shape', { scope, id })
      return null
    }
    return res.data
  } catch (err) {
    log.warn('ssh: failed to parse stored credential', {
      scope,
      id,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// Persist a credential. Throws only if the keychain binding is unavailable
// (callers surface that as a clear error). The value never enters a log line.
export async function saveSshCredential(
  scope: SshCredentialScope,
  id: string,
  cred: SshCredential,
): Promise<void> {
  const parsed = SshCredentialSchema.parse(cred)
  await setKeychainValue(SSH_SERVICE, accountFor(scope, id), JSON.stringify(parsed))
}

// Remove a stored credential (best-effort). Wired into ssh.delete /
// ssh.identityDelete so a removed entity leaves no orphan secret behind.
export async function deleteSshCredential(
  scope: SshCredentialScope,
  id: string,
): Promise<boolean> {
  return deleteKeychainValue(SSH_SERVICE, accountFor(scope, id))
}

// True when a credential is stored (does NOT read the value). Used to decide
// needs-auth vs a live probe.
export async function hasSshCredential(
  scope: SshCredentialScope,
  id: string,
): Promise<boolean> {
  return (await getKeychainValue(SSH_SERVICE, accountFor(scope, id))) !== null
}
