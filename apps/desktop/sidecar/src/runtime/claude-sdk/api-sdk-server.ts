// Expose AWOG `api` sources (ADR 0060) to the Claude Agent SDK runtime as
// in-process SDK MCP servers, so the anthropic provider gets the SAME flexible
// `api_<slug>` tool the Pi path builds (sources/api-tools.ts). Without this a
// `type:'api'` source is wired only into the Pi runtime and the Claude SDK path
// never sees it.
//
// One source → one SDK MCP server whose map KEY and internal `name` are both the
// source id, holding one tool named `api_<slug>` — so the SDK exposes exactly
// `mcp__<id>__api_<slug>`, matching the Pi tool name (apiToolName) and the
// `mcp__<id>__*` whitelist / permission-gate / trace conventions used uniformly
// across both runtimes.
//
// The tool handler delegates to the SHARED executeApiCall (sources/api-tools.ts):
// auth injection (oauth token OR stored credential), the SSRF guard, the hard
// timeout, the byte + char cap, binary omission and error shaping are byte-identical
// to the Pi path — there is ONE request implementation. The credential is injected
// into the OUTGOING request only; it never appears in the tool result, is never
// logged, and is never present in the tool args (the model chooses only
// path/method/params — no secret transits) (invariant 1). Per-source gating
// (allowedMcpPatterns / trust:'prompt') is enforced by the existing PreToolUse
// permission backstop (runtime/permission.ts makeBeforeToolCall) keyed on the same
// `mcp__<id>__*` name — NOT re-implemented here.
//
// Using createSdkMcpServer here is correct: ADR 0060 D-8 forbade it on the PI path
// (to keep Pi off the Anthropic SDK) — this is the CLAUDE SDK path, where the SDK's
// own in-process tool mechanism is exactly the right vehicle.

import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import {
  apiEndpointBlockedMessage,
  buildToolDescription,
  executeApiCall,
  isApiCallAllowed,
} from '../../sources/api-tools.js'
import type { ApiSourcesConfig, CompiledApiEndpoint } from '../permission-types.js'

// Zod input schema mirroring the Pi TypeBox schema (apiToolParameters): the single
// flexible { path, method, params?, _intent? } shape. The SDK's `tool()` takes a
// zod raw shape; `_intent` is model-facing metadata (unused by the handler, kept
// for parity with the Pi tool).
const apiToolSchema = {
  path: z.string().describe('API endpoint path, e.g. "/search" or "/v1/messages".'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
    .describe('HTTP method — check the source guide for the right method per endpoint.'),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Request body (POST/PUT/PATCH) or query parameters (GET). For a non-JSON body pass { _rawBody: "raw content", _contentType: "text/plain" } — _rawBody is sent as-is without JSON encoding.',
    ),
  _intent: z
    .string()
    .optional()
    .describe('One or two sentences describing what this call is trying to accomplish.'),
}

// Build one in-process SDK MCP server per enabled api source. `apiSources` is
// already whitelist-filtered upstream (parallel to mcpServers), so every entry is
// exposed as-is. Returns {} when there are no api sources; the caller spreads the
// result into `options.mcpServers`. `signal` (the turn abort controller) cancels
// in-flight api fetches on cancellation, matching the Pi path's loop signal.
// `endpointRules` (ADR 0060 P4), keyed by source id, gates a source's NON-GET
// calls to a matching compiled allowedApiEndpoints rule — the SAME isApiCallAllowed
// check the Pi tool runs (createApiTool), so both runtimes enforce P4 identically.
export function buildApiSdkServers(
  apiSources: ApiSourcesConfig | undefined,
  signal?: AbortSignal,
  endpointRules?: Record<string, CompiledApiEndpoint[]>,
): Record<string, McpSdkServerConfigWithInstance> {
  const out: Record<string, McpSdkServerConfigWithInstance> = {}
  if (!apiSources || apiSources.length === 0) return out
  for (const source of apiSources) {
    const rules = endpointRules?.[source.id]
    const apiTool = tool(
      `api_${source.slug}`,
      buildToolDescription(source),
      apiToolSchema,
      async (args) => {
        // Per-source Explore scoping (ADR 0060 P4): a source that declared
        // allowedApiEndpoints restricts itself to GET + its whitelisted non-GET
        // endpoints. Enforced here BEFORE the request with the SAME shared check
        // as the Pi path; a blocked call returns a clear tool error, never a fetch.
        if (rules && rules.length > 0 && !isApiCallAllowed(args.method, args.path, rules)) {
          return {
            content: [
              { type: 'text' as const, text: apiEndpointBlockedMessage(source, args.method, args.path) },
            ],
            isError: true,
          }
        }
        const r = await executeApiCall(
          source,
          { path: args.path, method: args.method, params: args.params },
          signal,
        )
        return { content: [{ type: 'text' as const, text: r.text }], isError: r.isError }
      },
    )
    out[source.id] = createSdkMcpServer({ name: source.id, version: '1.0.0', tools: [apiTool] })
  }
  return out
}
