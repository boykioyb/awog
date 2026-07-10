// Toggle deny state for a single tool inside a Source (ADR 0060 P1). Successor
// to mcp.toggle-tool — persists into the config's `deniedTools` array. Runtime
// filtering (when an agent calls the tool) is wired via the whitelist resolvers;
// this method just owns the persisted list.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'
import { loadSource, saveSource } from '../sources/store.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
  toolName: z.string().min(1).max(200),
  denied: z.boolean(),
})

register('source.toggleTool', async (raw) => {
  const { slug, toolName, denied } = Params.parse(raw)
  const source = await loadSource(slug)
  if (!source) throw new RpcError(-32602, `source not found: ${slug}`)

  const current = new Set(source.deniedTools ?? [])
  const wasDenied = current.has(toolName)
  if (denied === wasDenied) return { source }
  if (denied) current.add(toolName)
  else current.delete(toolName)

  const next = {
    ...source,
    deniedTools: current.size > 0 ? [...current].sort() : undefined,
    updatedAt: Date.now(),
  }
  await saveSource(next)
  return { source: await loadSource(slug) }
})
