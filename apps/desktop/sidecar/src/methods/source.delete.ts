// Delete a Source (ADR 0060 P1). Successor to mcp.delete — removes the whole
// per-source folder and purges any `secret:` keychain entries the mcp source
// owned (keyed by source.id, same account layout as before migration).

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'
import { deleteSource, loadSource } from '../sources/store.js'
import { purgeServerSecrets } from '../mcp/secrets.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
})

register('source.delete', async (raw) => {
  const { slug } = Params.parse(raw)
  // Load first so we can purge the source's `secret:` references from the OS
  // keychain before removing the folder. Missing config → nothing to purge.
  const source = await loadSource(slug)
  await deleteSource(slug)
  if (source && source.type === 'mcp') {
    await purgeServerSecrets(source.id, source.mcp.env, source.mcp.headers)
  }
  return { ok: true }
})
