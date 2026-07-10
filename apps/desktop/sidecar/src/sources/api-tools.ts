// REST `api` source → Pi AgentTool bridge (ADR 0060 D-8, P3). A `type:'api'`
// source becomes ONE flexible in-process tool named `mcp__<id>__api_<slug>` so
// the existing `mcp__<id>__*` whitelist, the MCP-preference nudge, the trace/step
// mappers, and the future (P4) permission auto-scoping all cover it UNIFORMLY
// with the MCP bridge — the `<id>` segment is the same source id the mcp path
// keys tools on (sessions.send-message.ts / tasks/agent-context.ts).
//
// Mirrors the request-building LOGIC of Craft's
// packages/shared/src/sources/api-tools.ts (buildHeaders / buildUrl / raw-body /
// large-result guard), but built with Pi's `AgentTool` — NOT
// @anthropic-ai/claude-agent-sdk's createSdkMcpServer (ADR 0029 / ADR 0060 D-8).
//
// The tool input is a single flexible shape { path, method, params, _intent };
// auth is injected per the source's `authType` (bearer / header / multi-header /
// query / basic / none). The credential is read FRESH from the keychain on every
// call (sources/api-credentials.ts) so a mid-session credential update takes
// effect without rebuilding the tool. Every request URL is SSRF-guarded
// (invariant 7); large or binary responses are capped/omitted so a huge payload
// can't blow the context window. Credentials/headers are NEVER logged.
//
// authType 'oauth' is DEFERRED to P6: the tool registers but returns a clear
// "not supported yet" so the model gets feedback instead of a missing tool
// (generic api OAuth is intentionally not wired here).

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { ssrfCheck } from '../mcp/http-client.js'
import { loadApiCredential, type ApiCredential } from './api-credentials.js'
import { log } from '../util/logger.js'
import type { ApiSource, ApiSourceBlock } from '../types/shared.js'

// Whole-request budget for one api call.
const API_CALL_TIMEOUT_MS = 60_000
// OOM safety: refuse a response whose declared content-length exceeds this
// before reading, and stop reading the stream past it.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
// Cap the text handed back to the model from one call (matches the mcp bridge's
// MCP_RESULT_MAX_CHARS) so a large response can't blow the context window.
const MAX_RESULT_CHARS = 64 * 1024

// Predicate: is `mcp__<serverId>__<toolName>` allowed this turn? Same signature
// the mcp bridge uses (buildMcpAllowed in runtime/tools/index.ts), so the api
// tool passes through the identical allowedTools / disabledTools / bypass filter.
export type ApiToolAllowed = (serverId: string, toolName: string) => boolean

// EXACT name `mcp__<id>__api_<slug>`. `<id>` (no `__`) + `api_<slug>` (slug has
// no underscore) split cleanly on `__` for the trace/step mappers.
export function apiToolName(source: ApiSource): string {
  return `mcp__${source.id}__api_${source.slug}`
}

// Build an Authorization header value for bearer-style auth. `authScheme`
// undefined → "Bearer <token>"; a custom scheme → "<scheme> <token>"; an empty
// string → the raw token (APIs that expect no prefix). Nullish-coalescing keeps
// "" distinct from undefined (mirrors Craft's buildAuthorizationHeader).
function buildAuthorizationHeader(authScheme: string | undefined, token: string): string {
  const scheme = authScheme ?? 'Bearer'
  return scheme ? `${scheme} ${token}` : token
}

// The lone secret string for value-shaped credentials (bearer / single header /
// query); '' for absent or non-value credentials.
function credentialString(cred: ApiCredential | null): string {
  return cred && cred.type === 'value' ? cred.value : ''
}

// Build request headers, injecting auth + the source's default headers. Query
// auth is applied in buildUrl, not here. Never logs values.
function buildHeaders(api: ApiSourceBlock, cred: ApiCredential | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(api.defaultHeaders ?? {}),
  }
  switch (api.authType) {
    case 'basic':
      if (cred && cred.type === 'basic') {
        const encoded = Buffer.from(`${cred.username}:${cred.password}`).toString('base64')
        headers.Authorization = `Basic ${encoded}`
      }
      return headers
    case 'header':
      // Multi-header credential (authType 'header' + headerNames) → merge each
      // pair; single header → the api-key header (default x-api-key).
      if (cred && cred.type === 'multi-header') {
        Object.assign(headers, cred.headers)
      } else {
        const value = credentialString(cred)
        if (value) headers[api.headerName || 'x-api-key'] = value
      }
      return headers
    case 'bearer': {
      const token = credentialString(cred)
      if (token) headers.Authorization = buildAuthorizationHeader(api.authScheme, token)
      return headers
    }
    case 'query':
    case 'none':
    case 'oauth':
    default:
      return headers
  }
}

// Build the full request URL: trailing-slash-safe join of baseUrl + path, then
// query-param auth (when applicable) + GET query params.
function buildUrl(
  api: ApiSourceBlock,
  path: string,
  method: string,
  params: Record<string, unknown> | undefined,
  cred: ApiCredential | null,
): string {
  const base = api.baseUrl.endsWith('/') ? api.baseUrl.slice(0, -1) : api.baseUrl
  const rel = path.startsWith('/') ? path : `/${path}`
  let url = `${base}${rel}`

  const apiKey = credentialString(cred)
  if (api.authType === 'query' && apiKey) {
    const sep = url.includes('?') ? '&' : '?'
    url += `${sep}${encodeURIComponent(api.queryParam || 'api_key')}=${encodeURIComponent(apiKey)}`
  }

  if (method === 'GET' && params && Object.keys(params).length > 0) {
    const usp = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue
      usp.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
    }
    const qs = usp.toString()
    if (qs) {
      const sep = url.includes('?') ? '&' : '?'
      url += `${sep}${qs}`
    }
  }
  return url
}

export interface ApiRequestSpec {
  path: string
  method: string
  params?: Record<string, unknown> | undefined
  // Extra headers merged last (e.g. testEndpoint.headers). Never carries secrets.
  extraHeaders?: Record<string, string> | undefined
}

export interface BuiltApiRequest {
  url: string
  init: RequestInit
}

// Build a fetch request for an api source. Shared by the runtime tool AND
// source.test so both inject auth identically. For a non-GET call, a
// `params._rawBody` string is sent as-is (Content-Type from `params._contentType`,
// default text/plain); otherwise `params` is JSON-encoded as the body.
export function buildApiRequest(
  api: ApiSourceBlock,
  cred: ApiCredential | null,
  spec: ApiRequestSpec,
): BuiltApiRequest {
  const url = buildUrl(api, spec.path, spec.method, spec.params, cred)
  const headers: Record<string, string> = { ...buildHeaders(api, cred), ...(spec.extraHeaders ?? {}) }
  const init: RequestInit = { method: spec.method, headers }

  if (spec.method !== 'GET' && spec.params && Object.keys(spec.params).length > 0) {
    const rawBody = spec.params._rawBody
    if (typeof rawBody === 'string') {
      init.body = rawBody
      headers['Content-Type'] =
        typeof spec.params._contentType === 'string' ? spec.params._contentType : 'text/plain'
    } else {
      init.body = JSON.stringify(spec.params)
    }
  }
  return { url, init }
}

function clip(text: string): string {
  return text.length <= MAX_RESULT_CHARS ? text : `${text.slice(0, MAX_RESULT_CHARS)}\n…(truncated)`
}

function textResult(text: string, isError = false): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text: clip(text) }], details: { isError } }
}

// Read the response body up to a byte cap without buffering the whole stream,
// then flag binary content (a NUL byte in the first slice) so raw bytes never
// get dumped into the model context.
async function readCapped(
  res: Response,
): Promise<{ text: string; truncated: boolean; binary: boolean }> {
  const reader = res.body?.getReader()
  if (!reader) return { text: '', truncated: false, binary: false }
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    total += value.length
    if (total >= MAX_RESPONSE_BYTES) {
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
  }
  const buf = Buffer.concat(chunks).subarray(0, MAX_RESPONSE_BYTES)
  const binary = buf.subarray(0, 8192).includes(0)
  return { text: binary ? '' : buf.toString('utf8'), truncated, binary }
}

function buildToolDescription(source: ApiSource): string {
  const api = source.api
  const authNote =
    api.authType === 'none'
      ? 'No authentication is required.'
      : 'Authentication is injected automatically — just pass path, method, and params.'
  return `Make authenticated requests to the ${source.name} API (${api.baseUrl}). ${authNote}
Pass { path, method, params }. For a non-JSON request body use params: { _rawBody: "raw content", _contentType: "text/plain" } — _rawBody is sent as-is. Large or binary responses are capped/omitted.`
}

// The single flexible tool input, mirroring Craft's { path, method, params,
// _intent }. `params` is a free-form object (request body for POST/PUT/PATCH,
// query params for GET; may carry _rawBody/_contentType).
const apiToolParameters = Type.Object({
  path: Type.String({
    description: 'API endpoint path, e.g. "/search" or "/v1/messages".',
  }),
  method: Type.Union(
    [
      Type.Literal('GET'),
      Type.Literal('POST'),
      Type.Literal('PUT'),
      Type.Literal('DELETE'),
      Type.Literal('PATCH'),
    ],
    { description: 'HTTP method — check the source guide for the right method per endpoint.' },
  ),
  params: Type.Optional(
    Type.Unsafe<Record<string, unknown>>({
      type: 'object',
      description:
        'Request body (POST/PUT/PATCH) or query parameters (GET). For a non-JSON body pass { _rawBody: "raw content", _contentType: "text/plain" } — _rawBody is sent as-is without JSON encoding.',
    }),
  ),
  _intent: Type.Optional(
    Type.String({
      description: 'One or two sentences describing what this call is trying to accomplish.',
    }),
  ),
})

// Build one api source's flexible tool. Reads its credential fresh per call.
export function createApiTool(source: ApiSource, loopSignal?: AbortSignal): AgentTool {
  const name = apiToolName(source)
  const api = source.api
  const description = buildToolDescription(source)

  return {
    name,
    label: `api_${source.slug}`,
    description,
    parameters: apiToolParameters,
    async execute(_toolCallId, rawParams, sig): Promise<AgentToolResult<unknown>> {
      if (sig?.aborted || loopSignal?.aborted) throw new Error(`api_${source.slug} aborted`)

      // OAuth api sources are deferred to P6 — no generic api OAuth wired here.
      if (api.authType === 'oauth') {
        return textResult(
          `OAuth API sources are not supported yet (phase P6). Configure a bearer/header/query/basic credential for "${source.name}", or use an MCP source with OAuth.`,
          true,
        )
      }

      // `params` arrives typed as unknown (homogeneous AgentTool) — narrow it.
      const p = (rawParams ?? {}) as { path?: unknown; method?: unknown; params?: unknown }
      const path = typeof p.path === 'string' ? p.path : ''
      const method = typeof p.method === 'string' ? p.method : 'GET'
      const reqParams =
        p.params && typeof p.params === 'object' ? (p.params as Record<string, unknown>) : undefined

      // Credential read FRESH so a mid-session update takes effect. `none` needs
      // none; a null credential lets the upstream API surface its own 401.
      const cred = api.authType === 'none' ? null : await loadApiCredential(source.id)

      const { url, init } = buildApiRequest(api, cred, {
        path,
        method,
        ...(reqParams ? { params: reqParams } : {}),
      })

      // SSRF-guard every request URL (baseUrl + path + any query auth). L1 input:
      // the model chose path/params, the user chose baseUrl.
      const guard = ssrfCheck(url)
      if (!guard.ok) {
        return textResult(`Request blocked by SSRF guard: ${guard.reason}.`, true)
      }

      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), API_CALL_TIMEOUT_MS)
      const onAbort = (): void => ctrl.abort()
      sig?.addEventListener('abort', onAbort, { once: true })
      loopSignal?.addEventListener('abort', onAbort, { once: true })
      try {
        const res = await fetch(url, { ...init, signal: ctrl.signal })

        // OOM pre-check: reject an oversized body before reading it into memory.
        const cl = res.headers.get('content-length')
        if (cl) {
          const size = Number.parseInt(cl, 10)
          if (Number.isFinite(size) && size > MAX_RESPONSE_BYTES) {
            await res.body?.cancel().catch(() => {})
            return textResult(
              `Response too large: ${size} bytes exceeds the ${MAX_RESPONSE_BYTES}-byte limit. Request a narrower query or a specific field instead.`,
              true,
            )
          }
        }

        const { text, truncated, binary } = await readCapped(res)
        if (!res.ok) {
          // Error bodies are text — surface the status + a bounded excerpt.
          return textResult(`API error ${res.status} ${res.statusText}: ${text.slice(0, 2000)}`, true)
        }
        if (binary) {
          const ct = res.headers.get('content-type') ?? 'application/octet-stream'
          return textResult(
            `(binary response omitted — content-type ${ct}). The API returned non-text data; request a text/JSON representation or a specific field instead.`,
          )
        }
        return textResult(text + (truncated ? '\n…(truncated)' : ''))
      } catch (err) {
        // Sanitized message only — never leak headers/credentials/body.
        const msg = ctrl.signal.aborted
          ? `timed out after ${API_CALL_TIMEOUT_MS}ms`
          : err instanceof Error
            ? err.message
            : String(err)
        log.warn('api tool request failed', { source: source.slug, err: msg })
        return textResult(`Request failed: ${msg}`, true)
      } finally {
        clearTimeout(timer)
        sig?.removeEventListener('abort', onAbort)
        loopSignal?.removeEventListener('abort', onAbort)
      }
    },
  }
}

// Build the api toolset for a turn: one tool per allowed, enabled api source.
// `allowed` is the same predicate the mcp bridge uses, keyed by (sourceId,
// `api_<slug>`) → `mcp__<id>__api_<slug>`, so allowedTools/disabledTools/bypass
// filter api tools identically to mcp tools.
export function createApiToolDefinitions(
  apiSources: ApiSource[] | undefined,
  allowed: ApiToolAllowed,
  loopSignal?: AbortSignal,
): AgentTool[] {
  if (!apiSources || apiSources.length === 0) return []
  const out: AgentTool[] = []
  for (const source of apiSources) {
    if (!allowed(source.id, `api_${source.slug}`)) continue
    out.push(createApiTool(source, loopSignal))
  }
  return out
}
