// Create/update an SSH host (ADR 0063 P0). Validates + persists only — the
// password (if authMethod === 'password') is stored separately via
// ssh.setCredential and never travels in this payload. Timestamps are stamped
// server-side so the UI can't backdate them.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { SshHostConfigSchema } from '../ssh/schema.js'
import { loadHost, saveHost } from '../ssh/store.js'

const Params = z.object({
  host: SshHostConfigSchema,
  mode: z.enum(['create', 'update']),
})

register('ssh.upsert', async (raw) => {
  const params = Params.parse(raw)
  const incoming = params.host

  // Completeness gate (schema keeps identityId optional so partial drafts
  // round-trip; enforce the auth-method invariant here).
  if (incoming.authMethod === 'key' && !incoming.identityId) {
    throw new RpcError(-32602, "authMethod 'key' requires an identityId")
  }

  const existing = await loadHost(incoming.id)
  if (params.mode === 'create' && existing) {
    throw new RpcError(-32602, `host id already exists: ${incoming.id}`)
  }
  if (params.mode === 'update' && !existing) {
    throw new RpcError(-32602, `host not found: ${incoming.id}`)
  }

  const now = new Date().toISOString()
  const stamped = {
    ...incoming,
    createdAt: existing?.createdAt ?? incoming.createdAt ?? now,
    updatedAt: now,
  }
  await saveHost(stamped)
  return { host: await loadHost(incoming.id) }
})
