// REST `api` source → Pi AgentTool bridge (ADR 0060 D-8, P3). A `type:'api'`
// source becomes ONE flexible in-process tool named `mcp__<id>__api_<slug>` so
// the existing `mcp__<id>__*` whitelist, the MCP-preference nudge, the trace/step
// mappers, and the future (P4) permission auto-scoping all cover it UNIFORMLY
// with the MCP bridge — the `<id>` segment is the same source id the mcp path
// keys tools on (sessions.send-message.ts / tasks/agent-context.ts).
//
// Mirrors the request-building LOGIC of Craft's
// packages/shared/src/sources/api-tools.ts (buildHeaders / buildUrl / raw-body /
// large-result guard). The request-execution core (`executeApiCall`) is runtime-
// agnostic and shared: the Pi runtime wraps it in an `AgentTool` (here), while the
// Claude Agent SDK runtime wraps the SAME core in a createSdkMcpServer + tool
// (runtime/claude-sdk/api-sdk-server.ts) — so auth/SSRF/cap/oauth logic lives in
// ONE place. This file stays free of any @anthropic-ai/claude-agent-sdk import.
//
// The tool input is a single flexible shape { path, method, params, _intent };
// auth is injected per the source's `authType` (bearer / header / multi-header /
// query / basic / oauth / none). The credential is read FRESH from the keychain
// on every call (sources/api-credentials.ts) so a mid-session credential update
// takes effect without rebuilding the tool. Every request URL is SSRF-guarded
// (invariant 7); large or binary responses are capped/omitted so a huge payload
// can't blow the context window. Credentials/headers are NEVER logged.
//
// authType 'oauth' (ADR 0060 P6): a fresh access token is fetched per call via
// sources/oauth-manager.ts (getFreshToken — auto-refreshes within 5 min of
// expiry) and injected as `Authorization: Bearer <token>`. No token → a clear
// needs_auth result telling the model to run source_oauth_trigger first.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { ssrfCheck } from '../mcp/http-client.js'
import { loadApiCredential, type ApiCredential } from './api-credentials.js'
import { getFreshToken } from './oauth-manager.js'
import { log } from '../util/logger.js'
import type { CompiledApiEndpoint } from '../runtime/permission-types.js'
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

export function buildToolDescription(source: ApiSource): string {
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

// Per-source Explore scoping (ADR 0060 P4): is a call to (method, path) allowed
// by this source's compiled allowedApiEndpoints? GET is ALWAYS allowed (read-only,
// mirrors Craft's isApiEndpointAllowed); a non-GET call must match a rule
// (method + path regex). Empty/absent rules → no gating (allow everything).
// Exported so BOTH runtimes share ONE check: the Pi tool (createApiTool below) and
// the Claude Agent SDK server (runtime/claude-sdk/api-sdk-server.ts) enforce it
// identically before executeApiCall — the P4 endpoint gate lives in one place.
export function isApiCallAllowed(method: string, path: string, rules: CompiledApiEndpoint[]): boolean {
  const upper = method.toUpperCase()
  if (upper === 'GET') return true
  for (const rule of rules) {
    if (rule.method === upper && rule.path.test(path)) return true
  }
  return false
}

// The model-facing message for a call blocked by a source's allowedApiEndpoints
// (ADR 0060 P4). Shared so the Pi tool and the Claude SDK server report the
// blocked call identically. Carries only method/path/source name — no secret.
export function apiEndpointBlockedMessage(source: ApiSource, method: string, path: string): string {
  return `Blocked by source permissions: ${method.toUpperCase()} ${path} is not in "${source.name}"'s allowedApiEndpoints (this source is scoped to GET + its whitelisted write endpoints).`
}

// The path/method/params for one api call. `params` is the request body
// (POST/PUT/PATCH) or query params (GET); it may carry _rawBody/_contentType.
export interface ApiCallInput {
  path: string
  method: string
  params?: Record<string, unknown> | undefined
}

// The runtime-agnostic result of one api call: the (already char-capped) text to
// hand the model + whether it is an error. NEVER carries a credential/header/body
// secret — the auth material is injected into the OUTGOING request only.
export interface ApiCallResult {
  text: string
  isError: boolean
}

// Merge up to two abort signals into one (turn/loop signal + per-call signal) so
// EITHER aborting the fetch below. Returns the lone signal when only one is set,
// undefined when neither — avoiding an unnecessary AbortSignal.any allocation.
function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const list = signals.filter((s): s is AbortSignal => s !== undefined)
  if (list.length === 0) return undefined
  if (list.length === 1) return list[0]
  return AbortSignal.any(list)
}

// Execute ONE api-source request end-to-end and return the model-facing text.
// This is the SHARED request core for BOTH runtimes: the Pi `AgentTool`
// (createApiTool below) and the Claude Agent SDK server
// (runtime/claude-sdk/api-sdk-server.ts) both delegate here, so auth injection,
// SSRF guard, timeout, byte/char cap, binary omission and error shaping live in
// ONE place. Steps: inject auth (oauth token OR stored credential, read FRESH so a
// mid-session update takes effect), build + SSRF-guard the URL, fetch with a hard
// timeout, reject/cap oversized bodies, omit binary, shape errors. The credential
// is injected into the OUTGOING request headers/URL only — it is NEVER returned in
// the text, NEVER logged, and never appears in the caller-supplied args (invariant
// 1). `signal` (turn/loop abort) cancels the in-flight fetch; the 60s timeout
// bounds it either way.
export async function executeApiCall(
  source: ApiSource,
  input: ApiCallInput,
  signal?: AbortSignal,
): Promise<ApiCallResult> {
  const api = source.api
  const { path } = input
  const method = input.method
  const reqParams = input.params

  // Every return goes through clip() so the model-facing text respects the char
  // budget (MAX_RESULT_CHARS) regardless of runtime.
  const result = (text: string, isError = false): ApiCallResult => ({ text: clip(text), isError })

  // OAuth api source (ADR 0060 P6): fetch a fresh Bearer token (auto-refreshed by
  // getFreshToken) and inject it as an Authorization header. No token → needs_auth;
  // tell the model to authenticate first. The token stays in memory here — never
  // logged, never in the returned text.
  let oauthHeaders: Record<string, string> | undefined
  if (api.authType === 'oauth') {
    const token = await getFreshToken(source)
    if (!token) {
      return result(
        `"${source.name}" is not authenticated. Run source_oauth_trigger({ slug: "${source.slug}" }) to sign in, then retry.`,
        true,
      )
    }
    oauthHeaders = { Authorization: `Bearer ${token}` }
  }

  // Credential read FRESH so a mid-session update takes effect. `none`/`oauth` use
  // no stored api credential (oauth injects a Bearer above); a null credential lets
  // the upstream API surface its own 401.
  const cred =
    api.authType === 'none' || api.authType === 'oauth' ? null : await loadApiCredential(source.id)

  const { url, init } = buildApiRequest(api, cred, {
    path,
    method,
    ...(reqParams ? { params: reqParams } : {}),
    ...(oauthHeaders ? { extraHeaders: oauthHeaders } : {}),
  })

  // SSRF-guard every request URL (baseUrl + path + any query auth). L1 input: the
  // model chose path/params, the user chose baseUrl.
  const guard = ssrfCheck(url)
  if (!guard.ok) return result(`Request blocked by SSRF guard: ${guard.reason}.`, true)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), API_CALL_TIMEOUT_MS)
  const onAbort = (): void => ctrl.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })

    // OOM pre-check: reject an oversized body before reading it into memory.
    const cl = res.headers.get('content-length')
    if (cl) {
      const size = Number.parseInt(cl, 10)
      if (Number.isFinite(size) && size > MAX_RESPONSE_BYTES) {
        await res.body?.cancel().catch(() => {})
        return result(
          `Response too large: ${size} bytes exceeds the ${MAX_RESPONSE_BYTES}-byte limit. Request a narrower query or a specific field instead.`,
          true,
        )
      }
    }

    const { text, truncated, binary } = await readCapped(res)
    if (!res.ok) {
      // Error bodies are text — surface the status + a bounded excerpt.
      return result(`API error ${res.status} ${res.statusText}: ${text.slice(0, 2000)}`, true)
    }
    if (binary) {
      const ct = res.headers.get('content-type') ?? 'application/octet-stream'
      return result(
        `(binary response omitted — content-type ${ct}). The API returned non-text data; request a text/JSON representation or a specific field instead.`,
      )
    }
    return result(text + (truncated ? '\n…(truncated)' : ''))
  } catch (err) {
    // Sanitized message only — never leak headers/credentials/body.
    const msg = ctrl.signal.aborted
      ? `timed out after ${API_CALL_TIMEOUT_MS}ms`
      : err instanceof Error
        ? err.message
        : String(err)
    log.warn('api tool request failed', { source: source.slug, err: msg })
    return result(`Request failed: ${msg}`, true)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

// Wrap a shared ApiCallResult as a Pi AgentToolResult WITHOUT re-clipping (the
// text is already char-capped by executeApiCall) so the Pi output is byte-for-byte
// what it produced before this refactor.
function toAgentResult(r: ApiCallResult): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text: r.text }], details: { isError: r.isError } }
}

// Build one api source's flexible tool. Reads its credential fresh per call.
// `endpointRules` (ADR 0060 P4) gate non-GET calls when the source's
// permissions.json declared allowedApiEndpoints; undefined/empty = no gating.
export function createApiTool(
  source: ApiSource,
  loopSignal?: AbortSignal,
  endpointRules?: CompiledApiEndpoint[],
): AgentTool {
  const name = apiToolName(source)
  const description = buildToolDescription(source)

  return {
    name,
    label: `api_${source.slug}`,
    description,
    parameters: apiToolParameters,
    async execute(_toolCallId, rawParams, sig): Promise<AgentToolResult<unknown>> {
      if (sig?.aborted || loopSignal?.aborted) throw new Error(`api_${source.slug} aborted`)

      // `params` arrives typed as unknown (homogeneous AgentTool) — narrow it.
      const p = (rawParams ?? {}) as { path?: unknown; method?: unknown; params?: unknown }
      const path = typeof p.path === 'string' ? p.path : ''
      const method = typeof p.method === 'string' ? p.method : 'GET'
      const reqParams =
        p.params && typeof p.params === 'object' ? (p.params as Record<string, unknown>) : undefined

      // Per-source Explore scoping (ADR 0060 P4): a source that declared
      // allowedApiEndpoints restricts itself to GET + the whitelisted non-GET
      // endpoints. A blocked call returns a clear tool error (never a request).
      // Enforced here on the Pi path (exposure is also filtered upstream); on the
      // Claude SDK path the permission gate (makeBeforeToolCall) is the backstop.
      if (endpointRules && endpointRules.length > 0 && !isApiCallAllowed(method, path, endpointRules)) {
        return textResult(apiEndpointBlockedMessage(source, method, path), true)
      }

      // Delegate the request itself to the shared core (auth/SSRF/cap/oauth). Both
      // the per-call signal and the loop signal abort the in-flight fetch.
      const r = await executeApiCall(
        source,
        { path, method, ...(reqParams ? { params: reqParams } : {}) },
        combineSignals(sig, loopSignal),
      )
      return toAgentResult(r)
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
  // Per-source compiled allowedApiEndpoints (ADR 0060 P4), keyed by source id.
  // A source with an entry gates its non-GET calls to a matching rule.
  endpointRules?: Record<string, CompiledApiEndpoint[]>,
): AgentTool[] {
  if (!apiSources || apiSources.length === 0) return []
  const out: AgentTool[] = []
  for (const source of apiSources) {
    if (!allowed(source.id, `api_${source.slug}`)) continue
    const rules = endpointRules?.[source.id]
    out.push(createApiTool(source, loopSignal, rules))
  }
  return out
}
