// Store an SSH credential in the OS keychain (ADR 0063). Companion to
// ssh.upsert / ssh.identityUpsert (which persist non-secret config). The secret
// NEVER touches a config file and is NEVER echoed back — the RPC returns only
// { ok } (invariant 1). scope+mode are cross-checked so a host only ever holds
// a password and an identity only ever holds a passphrase / inline key.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { SSH_ID_RE } from '../ssh/schema.js'
import { keychainStatus } from '../credentials/keychain.js'
import { saveSshCredential } from '../ssh/credentials.js'
import type { SshCredential } from '../ssh/schema.js'

const Params = z.object({
  scope: z.enum(['host', 'identity']),
  id: z.string().regex(SSH_ID_RE),
  mode: z.enum(['password', 'passphrase', 'inline-key']),
  password: z.string().min(1).max(16_384).optional(),
  passphrase: z.string().min(1).max(16_384).optional(),
  privateKey: z.string().min(1).max(65_536).optional(),
})

register('ssh.setCredential', async (raw) => {
  const params = Params.parse(raw)

  // Cross-check scope vs mode: hosts authenticate with a password; identities
  // with a passphrase (for a keyPath file) or inline key material.
  if (params.scope === 'host' && params.mode !== 'password') {
    throw new RpcError(-32602, "host scope only accepts mode 'password'")
  }
  if (params.scope === 'identity' && params.mode === 'password') {
    throw new RpcError(-32602, "identity scope accepts mode 'passphrase' or 'inline-key'")
  }

  const status = await keychainStatus()
  if (!status.available) {
    throw new RpcError(
      -32024,
      `keychain unavailable: ${status.error ?? 'native binding missing — run `pnpm install` in apps/desktop/sidecar'}`,
    )
  }

  let cred: SshCredential
  switch (params.mode) {
    case 'password':
      if (params.password === undefined) throw new RpcError(-32602, "mode 'password' requires password")
      cred = { type: 'password', password: params.password }
      break
    case 'passphrase':
      if (params.passphrase === undefined)
        throw new RpcError(-32602, "mode 'passphrase' requires passphrase")
      cred = { type: 'passphrase', passphrase: params.passphrase }
      break
    case 'inline-key':
      if (params.privateKey === undefined)
        throw new RpcError(-32602, "mode 'inline-key' requires privateKey")
      cred = {
        type: 'inline-key',
        privateKey: params.privateKey,
        ...(params.passphrase ? { passphrase: params.passphrase } : {}),
      }
      break
  }

  await saveSshCredential(params.scope, params.id, cred)
  // Status only — never echo the secret (invariant 1).
  return { ok: true }
})
