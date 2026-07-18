// Store a VPN credential in the OS keychain (ADR 0065). Companion to vpn.upsert
// (which persists non-secret config). The secret NEVER touches a config file or
// disk and is NEVER echoed back — the RPC returns only { ok } (invariant 1). At
// connect time (P1) the credential is pushed to openvpn via its management
// interface, not an --auth-user-pass file.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { VPN_ID_RE } from '../vpn/schema.js'
import { keychainStatus } from '../credentials/keychain.js'
import { saveVpnCredential } from '../vpn/credentials.js'

const Params = z.object({
  id: z.string().regex(VPN_ID_RE),
  // All optional, but at least one must be present (checked below + by the
  // credential schema's refine). Clearing a field means: omit it.
  username: z.string().min(1).max(1024).optional(),
  password: z.string().min(1).max(16_384).optional(),
  keyPassphrase: z.string().min(1).max(16_384).optional(),
})

register('vpn.setCredential', async (raw) => {
  const params = Params.parse(raw)

  if (!params.username && !params.password && !params.keyPassphrase) {
    throw new RpcError(-32602, 'at least one of username / password / keyPassphrase is required')
  }

  const status = await keychainStatus()
  if (!status.available) {
    throw new RpcError(
      -32024,
      `keychain unavailable: ${status.error ?? 'native binding missing — run `pnpm install` in apps/desktop/sidecar'}`,
    )
  }

  await saveVpnCredential(params.id, {
    ...(params.username ? { username: params.username } : {}),
    ...(params.password ? { password: params.password } : {}),
    ...(params.keyPassphrase ? { keyPassphrase: params.keyPassphrase } : {}),
  })
  // Status only — never echo the secret (invariant 1).
  return { ok: true }
})
