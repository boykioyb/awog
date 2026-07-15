// Create/update an SSH identity (ADR 0063 P0). The private key material /
// passphrase (when pasted inline) are stored separately via ssh.setCredential —
// this persists only metadata + the keyPath (a plaintext filesystem path) + the
// inlineStored/hasPassphrase flags. Timestamps stamped server-side.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { SshIdentityConfigSchema } from '../ssh/schema.js'
import { loadIdentity, saveIdentity } from '../ssh/store.js'

const Params = z.object({
  identity: SshIdentityConfigSchema,
  mode: z.enum(['create', 'update']),
})

register('ssh.identityUpsert', async (raw) => {
  const params = Params.parse(raw)
  const incoming = params.identity

  if (!incoming.keyPath && !incoming.inlineStored) {
    throw new RpcError(-32602, 'identity requires either keyPath or inline-stored key material')
  }

  const existing = await loadIdentity(incoming.id)
  if (params.mode === 'create' && existing) {
    throw new RpcError(-32602, `identity id already exists: ${incoming.id}`)
  }
  if (params.mode === 'update' && !existing) {
    throw new RpcError(-32602, `identity not found: ${incoming.id}`)
  }

  const now = new Date().toISOString()
  const stamped = {
    ...incoming,
    createdAt: existing?.createdAt ?? incoming.createdAt ?? now,
    updatedAt: now,
  }
  await saveIdentity(stamped)
  return { identity: await loadIdentity(incoming.id) }
})
