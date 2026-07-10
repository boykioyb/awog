// List a Source's tools with per-source permission status (ADR 0060, P5 UI parity
// — the Tools section of the Craft-style SourceInfoPage; successor to Craft's
// GET_MCP_TOOLS). Read-only.
//
// Per source kind:
//   - mcp   → live handshake via the SAME path as source.test (`testSource`,
//             which injects the oauth Bearer token / expands `secret:` env|header
//             refs and runs mcpManager.test → tools/list). Unlike source.test this
//             does NOT persist the outcome / auto-enable — the only possible write
//             is the oauth token-lifecycle status transition inside getFreshToken
//             (identical to every turn), never a test verdict. A connection failure
//             (or an oauth source with no valid token) yields { tools: [] } (+ an
//             optional `error`), never a throw.
//   - api   → the single synthetic flexible tool `mcp__<id>__api_<slug>`.
//   - local → no tools.
//
// `name` is the AWOG-canonical tool identity `mcp__<id>__<tool>` (the same string
// used by the whitelist / trace mappers / permission patterns — the UI may strip
// the `mcp__<id>__` prefix for display). `allowed` is whether the tool passes THIS
// source's own permissions.json auto-scope (sources/gate.ts): no permissions.json
// → all allowed (a source can only ever whitelist its own tools).
//
// Invariant 1: only tool names + descriptions cross the boundary — never a token,
// header value, or env secret.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadSource } from '../sources/store.js'
import { resolveSourceGate } from '../sources/gate.js'
import { testSource } from '../sources/test.js'
import { apiToolName } from '../sources/api-tools.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
})

// One row for the UI Tools section. `name` = `mcp__<id>__<tool>` (canonical).
interface SourceToolInfo {
  name: string
  description: string
  allowed: boolean
}

// A tool is allowed when the source declared no allowedMcpPatterns (empty gate →
// everything) OR its full name matches one of the auto-scoped patterns.
function isAllowed(fullName: string, patterns: RegExp[]): boolean {
  return patterns.length === 0 || patterns.some((re) => re.test(fullName))
}

register('source.tools', async (raw) => {
  const { slug } = Params.parse(raw)
  const source = await loadSource(slug)
  if (!source) throw new RpcError(-32602, `source not found: ${slug}`)

  // local sources contribute filesystem context, not callable tools.
  if (source.type === 'local') {
    return { tools: [] as SourceToolInfo[] }
  }

  // api source → the one flexible tool it becomes at runtime (sources/api-tools).
  // GET is always allowed and non-GET is gated per-call, so the tool itself is
  // always listed as allowed at this granularity.
  if (source.type === 'api') {
    const tool: SourceToolInfo = {
      name: apiToolName(source),
      description: `REST API tool for ${source.name} (${source.api.baseUrl}).`,
      allowed: true,
    }
    return { tools: [tool] }
  }

  // mcp source → live handshake (read-only reuse of the source.test path).
  const outcome = await testSource(source)
  const rawTools = outcome.tools ?? []
  if (rawTools.length === 0) {
    // Unreachable / needs_auth / no tools — surface the reason, don't throw.
    const result: { tools: SourceToolInfo[]; error?: string } = { tools: [] }
    if (outcome.error) result.error = outcome.error
    return result
  }

  const gate = await resolveSourceGate(source)
  const tools: SourceToolInfo[] = rawTools.map((t) => {
    const name = `mcp__${source.id}__${t.name}`
    return { name, description: t.description, allowed: isAllowed(name, gate.mcpToolPatterns) }
  })
  return { tools }
})
