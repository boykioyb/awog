// Delete a Source (ADR 0060 P1). Successor to mcp.delete — removes the whole
// per-source folder and purges any `secret:` keychain entries the mcp source
// owned (keyed by source.id, same account layout as before migration).

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'
import { deleteSource, loadSource } from '../sources/store.js'
import { purgeServerSecrets } from '../mcp/secrets.js'
import { deleteToken } from '../sources/oauth-store.js'
import { deleteApiCredential } from '../sources/api-credentials.js'

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
    // Also drop any OAuth token bundle stored under the distinct
    // `awog-source-oauth` service (ADR 0060 D-4) — best-effort, own namespace.
    await deleteToken(source.id)
  }
  if (source && source.type === 'api') {
    // Drop the api credential stored under the `awog-source-api` service (ADR
    // 0060 P3) so a deleted api source leaves no orphan secret — best-effort.
    await deleteApiCredential(source.id)
  }
  return { ok: true }
})
