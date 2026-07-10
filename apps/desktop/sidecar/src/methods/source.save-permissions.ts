// Write a Source's permissions.json (ADR 0060, P5 UI parity — the edit affordance
// on the Permissions section of the Craft-style SourceInfoPage). Validates the
// shape with SourcePermissionsSchema before persisting (rejects a malformed body
// with a clear RpcError); write is atomic + sanitized (sanitizeChild(slug) inside
// the store). No secret — permission patterns are scoping rules, never
// credentials. Config itself is edited via source.upsert — no new RPC for it.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { savePermissions } from '../sources/store.js'
import { SOURCE_SLUG_RE, SourcePermissionsSchema } from '../sources/schema.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
  permissions: z.unknown(),
})

register('source.savePermissions', async (raw) => {
  const { slug, permissions } = Params.parse(raw)
  const parsed = SourcePermissionsSchema.safeParse(permissions)
  if (!parsed.success) {
    throw new RpcError(-32602, 'Invalid permissions', {
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    })
  }
  await savePermissions(slug, parsed.data)
  return { ok: true }
})
