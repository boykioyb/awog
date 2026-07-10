// Enable/disable a Source (ADR 0060 P1). Successor to mcp.toggle — persist-only
// (no process lifecycle to reconcile; the runtime bridge connects lazily and
// only for enabled mcp sources).

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'
import { loadSource, saveSource } from '../sources/store.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
  enabled: z.boolean(),
})

register('source.toggle', async (raw) => {
  const { slug, enabled } = Params.parse(raw)
  const source = await loadSource(slug)
  if (!source) throw new RpcError(-32602, `source not found: ${slug}`)
  if (source.enabled === enabled) return { source }
  const next = { ...source, enabled, updatedAt: Date.now() }
  await saveSource(next)
  return { source: await loadSource(slug) }
})
