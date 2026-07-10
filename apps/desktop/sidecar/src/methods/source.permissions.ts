// Read a Source's parsed permissions.json (ADR 0060, P5 UI parity — the
// Permissions section of the Craft-style SourceInfoPage). Read-only: returns the
// zod-parsed SourcePermissions (allowedMcpPatterns / allowedApiEndpoints /
// allowedBashPatterns / allowedWritePaths) or null when the source declares no
// permissions.json. No mutation, no secret — permission patterns are scoping
// rules, never credentials.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { readPermissions } from '../sources/store.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
})

register('source.permissions', async (raw) => {
  const { slug } = Params.parse(raw)
  const permissions = await readPermissions(slug)
  return { permissions }
})
