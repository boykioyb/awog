// Create/update a VPN profile (ADR 0065 P0). Validates + persists metadata only —
// credentials (if authMode === 'user-pass' / a key passphrase) are stored
// separately via vpn.setCredential and never travel in this payload. Timestamps
// are stamped server-side so the UI can't backdate them.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { VpnProfileConfigSchema } from '../vpn/schema.js'
import { loadProfile, saveProfile } from '../vpn/store.js'

const Params = z.object({
  profile: VpnProfileConfigSchema,
  mode: z.enum(['create', 'update']),
})

register('vpn.upsert', async (raw) => {
  const params = Params.parse(raw)
  const incoming = params.profile

  const existing = await loadProfile(incoming.id)
  if (params.mode === 'create' && existing) {
    throw new RpcError(-32602, `vpn profile id already exists: ${incoming.id}`)
  }
  if (params.mode === 'update' && !existing) {
    throw new RpcError(-32602, `vpn profile not found: ${incoming.id}`)
  }

  const now = new Date().toISOString()
  const stamped = {
    ...incoming,
    createdAt: existing?.createdAt ?? incoming.createdAt ?? now,
    updatedAt: now,
  }
  await saveProfile(stamped)
  return { profile: await loadProfile(incoming.id) }
})
