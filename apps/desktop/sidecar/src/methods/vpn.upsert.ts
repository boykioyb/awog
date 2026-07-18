// Create/update a VPN profile (ADR 0065 P0). Validates + persists metadata only —
// credentials (if authMode === 'user-pass' / a key passphrase) are stored
// separately via vpn.setCredential and never travel in this payload. Timestamps
// are stamped server-side so the UI can't backdate them.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { VpnProfileConfigSchema } from '../vpn/schema.js'
import type { VpnProfileConfig } from '../vpn/schema.js'
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

  // Runtime-owned fields are NOT accepted from the client (infosec F5 — mass
  // assignment): status/statusError/lastUpAt are written only by VpnManager, and
  // hasUserPass/hasKeyPassphrase are re-hydrated from the keychain at list time.
  // Strip them from the incoming payload, then carry over whatever is persisted (on
  // update) — on create they start clean.
  const {
    status: _status,
    statusError: _statusError,
    lastUpAt: _lastUpAt,
    hasUserPass: _hasUserPass,
    hasKeyPassphrase: _hasKeyPassphrase,
    ...safe
  } = incoming
  const now = new Date().toISOString()
  const stamped: VpnProfileConfig = {
    ...safe,
    hasUserPass: existing?.hasUserPass ?? false,
    hasKeyPassphrase: existing?.hasKeyPassphrase ?? false,
    createdAt: existing?.createdAt ?? incoming.createdAt ?? now,
    updatedAt: now,
    ...(existing?.status ? { status: existing.status } : {}),
    ...(existing?.statusError ? { statusError: existing.statusError } : {}),
    ...(existing?.lastUpAt ? { lastUpAt: existing.lastUpAt } : {}),
  }
  await saveProfile(stamped)
  return { profile: await loadProfile(incoming.id) }
})
