// Create/update a Source (ADR 0060 P1). Successor to mcp.upsert — writes the
// per-source folder ~/.awog/sources/<slug>/config.json. No process lifecycle:
// status is derived from source.test/auth, so upsert only validates + persists
// (secret env/headers are keychainized by saveSource). Any valid kind is stored;
// only `mcp` carries a runtime today (api/local land in phases P3/P4).

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { SourceConfigSchema } from '../sources/schema.js'
import { loadSource, saveSource } from '../sources/store.js'

const Params = z.object({
  source: SourceConfigSchema,
  mode: z.enum(['create', 'update']),
})

register('source.upsert', async (raw) => {
  const params = Params.parse(raw)
  const incoming = params.source

  // Kind-specific completeness checks (schema keeps per-block fields optional so
  // partial drafts round-trip; the transport gate is enforced here).
  if (incoming.type === 'mcp') {
    const transport = incoming.mcp.transport ?? 'http'
    if (transport === 'sse') {
      // SSE is deprecated by the MCP spec (replaced by Streamable HTTP) and the
      // runtime bridge only speaks stdio/http — reject early with a clear hint.
      throw new RpcError(-32602, 'sse transport not supported — use http instead')
    }
    if (transport === 'stdio' && !incoming.mcp.command) {
      throw new RpcError(-32602, 'stdio transport requires mcp.command')
    }
    if (transport === 'http' && !incoming.mcp.url) {
      throw new RpcError(-32602, 'http transport requires mcp.url')
    }
  }

  const existing = await loadSource(incoming.slug)
  if (params.mode === 'create' && existing) {
    throw new RpcError(-32602, `source slug already exists: ${incoming.slug}`)
  }
  if (params.mode === 'update' && !existing) {
    throw new RpcError(-32602, `source not found: ${incoming.slug}`)
  }

  await saveSource(incoming)

  // Reload so the caller sees the canonical persisted form (secret env/headers
  // rewritten to `secret:KEY` references by saveSource's keychainize).
  return { source: await loadSource(incoming.slug) }
})
