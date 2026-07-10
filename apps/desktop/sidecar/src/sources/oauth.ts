// MCP OAuth protocol for remote (http) sources — ADR 0060 D-4, P2.
//
// Mirrors the ALGORITHM of Craft's packages/shared/src/auth/oauth.ts, adapted to
// AWOG infra (reuse auth/pkce.ts + the http-client SSRF policy; no Craft file
// structure, no @modelcontextprotocol/sdk). Pure OAuth protocol only — no store,
// no source status. Orchestration (getFreshToken, status marking, refresh
// dedupe) lives in sources/oauth-manager.ts; the RPCs live in
// methods/source.start-oauth.ts / source.cancel-oauth.ts.
//
// Discovery: RFC 9728 (hit the MCP URL → 401 WWW-Authenticate resource_metadata
// → protected-resource metadata → authorization_servers[0] →
// /.well-known/oauth-authorization-server) with an RFC 8414 fallback (origin
// root + path-scoped). PKCE S256. Dynamic Client Registration (public client,
// token_endpoint_auth_method:'none'; fall back to a fixed client_id on 4xx).
// Loopback callback server on ports 8914–8924, path /oauth/callback, 5-min
// timeout. exchangeCode / refreshToken over the token endpoint.
//
// Security: every OUTBOUND fetch is HTTPS-only + private-IP-blocked (reuse
// blockedHostReason from mcp/http-client.ts) with a 5s discovery timeout. The
// loopback callback binds localhost only. Token strings are never logged.

import { createServer, type Server } from 'node:http'
import { genChallenge, genStateToken, genVerifier } from '../auth/pkce.js'
import { blockedHostReason } from '../mcp/http-client.js'
import { log } from '../util/logger.js'
import type { OAuthTokenBundle } from './oauth-store.js'
import type { ApiSource } from '../types/shared.js'

const CALLBACK_PORT_START = 8914
const CALLBACK_PORT_END = 8924
const CALLBACK_PATH = '/oauth/callback'
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000
const DISCOVERY_TIMEOUT_MS = 5000
const TOKEN_TIMEOUT_MS = 15_000
const CLIENT_NAME = 'AWOG'
// Fixed public-client id used when the server has no registration endpoint or
// gates dynamic registration (4xx). Matches Craft's fallback role.
const FALLBACK_CLIENT_ID = 'awog'

export interface OAuthMetadata {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
}

// Result of a completed authorization: the token bundle + the client id used
// (persisted so refresh reuses the same client). `tokenEndpoint` rides along so
// the caller need not re-discover it immediately after connecting.
export interface OAuthFlowResult {
  tokens: OAuthTokenBundle
  clientId: string
  tokenEndpoint: string
}

// ─── SSRF guard (HTTPS-only + private-IP-blocked) ─────────────────────────────
// Stricter than mcp/http-client.ts's ssrfCheck (which also allows http): OAuth
// discovery/token/registration endpoints must be remote HTTPS.

function guardHttps(rawUrl: string): { ok: boolean; reason?: string } {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'invalid URL' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'URL must use HTTPS' }
  }
  const blocked = blockedHostReason(url.hostname)
  if (blocked) return { ok: false, reason: blocked }
  return { ok: true }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ─── Discovery (RFC 9728 → RFC 8414 fallback) ─────────────────────────────────

interface ProtectedResourceMetadata {
  resource: string
  authorization_servers?: string[]
}

function isProtectedResourceMetadata(data: unknown): data is ProtectedResourceMetadata {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>
  if (typeof obj.resource !== 'string') return false
  if (obj.authorization_servers !== undefined) {
    if (!Array.isArray(obj.authorization_servers)) return false
    if (!obj.authorization_servers.every((s) => typeof s === 'string')) return false
  }
  return true
}

function isOAuthMetadata(data: unknown): data is OAuthMetadata {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>
  return typeof obj.authorization_endpoint === 'string' && typeof obj.token_endpoint === 'string'
}

function normalizeUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

// Parse resource_metadata="..." (or single-quoted) from a WWW-Authenticate header.
function parseResourceMetadataFromHeader(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/resource_metadata\s*=\s*["']([^"']+)["']/)
  return match?.[1] ?? null
}

async function fetchAuthServerMetadata(url: string): Promise<OAuthMetadata | null> {
  const guard = guardHttps(url)
  if (!guard.ok) return null
  try {
    const res = await fetchWithTimeout(url, {}, DISCOVERY_TIMEOUT_MS)
    if (!res.ok) return null
    const data: unknown = await res.json()
    if (isOAuthMetadata(data)) {
      // Validate the endpoints we'll actually use before returning.
      if (!guardHttps(data.authorization_endpoint).ok || !guardHttps(data.token_endpoint).ok) {
        return null
      }
      return data
    }
    return null
  } catch {
    return null
  }
}

async function fetchProtectedResourceAuthServer(metadataUrl: string): Promise<string | null> {
  const guard = guardHttps(metadataUrl)
  if (!guard.ok) return null
  try {
    const res = await fetchWithTimeout(metadataUrl, {}, DISCOVERY_TIMEOUT_MS)
    if (!res.ok) return null
    const data: unknown = await res.json()
    if (!isProtectedResourceMetadata(data) || !data.authorization_servers?.length) return null
    const authServer = data.authorization_servers[0]!
    return guardHttps(authServer).ok ? authServer : null
  } catch {
    return null
  }
}

// RFC 9728: probe the MCP endpoint for a 401 carrying a resource_metadata hint.
async function discoverViaProtectedResource(mcpUrl: string): Promise<OAuthMetadata | null> {
  let res: Response
  try {
    res = await fetchWithTimeout(mcpUrl, { method: 'HEAD' }, DISCOVERY_TIMEOUT_MS)
    if (res.status === 405) {
      res = await fetchWithTimeout(mcpUrl, { method: 'GET' }, DISCOVERY_TIMEOUT_MS)
    }
    if (res.status === 405) {
      // Streamable-HTTP MCP servers only accept POST. Safe here: we only act on a
      // 401, and '{}' is a no-op for a JSON-RPC server (missing required fields).
      res = await fetchWithTimeout(
        mcpUrl,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        DISCOVERY_TIMEOUT_MS,
      )
    }
  } catch {
    return null
  }
  if (res.status !== 401) return null
  const resourceMetadataUrl = parseResourceMetadataFromHeader(res.headers.get('www-authenticate'))
  if (!resourceMetadataUrl || !guardHttps(resourceMetadataUrl).ok) return null
  const authServer = await fetchProtectedResourceAuthServer(resourceMetadataUrl)
  if (!authServer) return null
  return fetchAuthServerMetadata(`${normalizeUrl(authServer)}/.well-known/oauth-authorization-server`)
}

// Discover OAuth metadata for an MCP URL. SSRF-guarded + HTTPS-only throughout.
// Returns null when no compliant metadata is found (server may be public).
export async function discoverMcpOAuth(mcpUrl: string): Promise<OAuthMetadata | null> {
  const guard = guardHttps(mcpUrl)
  if (!guard.ok) {
    log.warn('sources/oauth: discovery URL rejected', { reason: guard.reason })
    return null
  }
  let url: URL
  try {
    url = new URL(mcpUrl)
  } catch {
    return null
  }

  const rfc9728 = await discoverViaProtectedResource(mcpUrl)
  if (rfc9728) return rfc9728

  // RFC 8414 fallback: origin root + path-scoped well-known locations.
  const candidates = [
    `${url.origin}/.well-known/oauth-authorization-server`,
    `${url.origin}/.well-known/oauth-authorization-server${url.pathname}`,
  ]
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const metadata = await fetchAuthServerMetadata(candidate)
    if (metadata) return metadata
  }
  return null
}

// ─── Dynamic Client Registration ──────────────────────────────────────────────

class ClientRegistrationError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ClientRegistrationError'
    if (status !== undefined) this.status = status
  }
}

// True when DCR failed in a way that should fall back to the fixed client id
// (provider intentionally gates registration — 4xx).
function shouldFallbackToFixedClient(error: unknown): boolean {
  return (
    error instanceof ClientRegistrationError &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500
  )
}

async function registerClient(registrationEndpoint: string, redirectUri: string): Promise<string> {
  const guard = guardHttps(registrationEndpoint)
  if (!guard.ok) throw new ClientRegistrationError(`registration endpoint rejected: ${guard.reason}`)
  let res: Response
  try {
    res = await fetchWithTimeout(
      registrationEndpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: CLIENT_NAME,
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
      },
      TOKEN_TIMEOUT_MS,
    )
  } catch (err) {
    throw new ClientRegistrationError(
      `client registration failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ClientRegistrationError(
      `client registration failed: ${text.slice(0, 200)}`,
      res.status,
    )
  }
  const data = (await res.json()) as { client_id?: unknown }
  if (typeof data.client_id !== 'string' || !data.client_id) {
    throw new ClientRegistrationError('client registration response missing client_id')
  }
  return data.client_id
}

// ─── Token endpoint (exchange / refresh) ──────────────────────────────────────

interface TokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  token_type?: unknown
}

function bundleFromTokenResponse(
  data: TokenResponse,
  clientId: string,
  fallbackRefreshToken?: string,
): OAuthTokenBundle {
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('token response missing access_token')
  }
  // Default to 3600s per RFC 6749 so a token with no expires_in is still
  // detected as needing refresh (otherwise it would never refresh).
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  const bundle: OAuthTokenBundle = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
    clientId,
    tokenType: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
  }
  const refresh =
    typeof data.refresh_token === 'string' && data.refresh_token
      ? data.refresh_token
      : fallbackRefreshToken
  if (refresh) bundle.refreshToken = refresh
  return bundle
}

async function postToken(tokenEndpoint: string, params: URLSearchParams): Promise<TokenResponse> {
  const guard = guardHttps(tokenEndpoint)
  if (!guard.ok) throw new Error(`token endpoint rejected: ${guard.reason}`)
  const res = await fetchWithTimeout(
    tokenEndpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    },
    TOKEN_TIMEOUT_MS,
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`token endpoint returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
  }
  return (await res.json()) as TokenResponse
}

async function exchangeCode(
  tokenEndpoint: string,
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string,
  // Confidential-client secret (api.oauth.clientSecret). Omitted for public PKCE
  // clients (mcp DCR / fixed-client flows never send one).
  clientSecret?: string,
): Promise<OAuthTokenBundle> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  })
  if (clientSecret) params.set('client_secret', clientSecret)
  const data = await postToken(tokenEndpoint, params)
  return bundleFromTokenResponse(data, clientId)
}

// Refresh an access token against an already-resolved token endpoint. Returns a
// fresh bundle (carrying the old refresh token forward if the server omits one).
// Used by both the mcp path (endpoint re-discovered) and the generic api-oauth
// path (endpoint from api.oauth.tokenUrl or discovered from api.baseUrl).
export async function refreshOAuthTokenAt(
  tokenEndpoint: string,
  refreshToken: string,
  clientId: string,
  clientSecret?: string,
): Promise<OAuthTokenBundle> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  })
  if (clientSecret) params.set('client_secret', clientSecret)
  const data = await postToken(tokenEndpoint, params)
  return bundleFromTokenResponse(data, clientId, refreshToken)
}

// Refresh an mcp access token via a re-discovered token endpoint. Re-discovery
// keeps the bundle minimal (no persisted token endpoint) and always current.
export async function refreshMcpToken(
  mcpUrl: string,
  refreshToken: string,
  clientId: string,
): Promise<OAuthTokenBundle> {
  const metadata = await discoverMcpOAuth(mcpUrl)
  if (!metadata) throw new Error('could not discover token endpoint for refresh')
  return refreshOAuthTokenAt(metadata.token_endpoint, refreshToken, clientId)
}

// Resolve OAuth server metadata for a generic api-oauth source (ADR 0060 D-4,
// P6): use the explicit api.oauth {authorizationUrl, tokenUrl} block when present
// (both HTTPS + private-IP guarded), else discover from api.baseUrl (RFC 9728 →
// 8414). Returns null when nothing compliant is found. Never throws.
export async function resolveApiOAuthMetadata(source: ApiSource): Promise<OAuthMetadata | null> {
  const oauth = source.api.oauth
  if (oauth) {
    if (!guardHttps(oauth.authorizationUrl).ok || !guardHttps(oauth.tokenUrl).ok) {
      log.warn('sources/oauth: api.oauth endpoint rejected by https guard', { slug: source.slug })
      return null
    }
    return { authorization_endpoint: oauth.authorizationUrl, token_endpoint: oauth.tokenUrl }
  }
  return discoverMcpOAuth(source.api.baseUrl)
}

// ─── Loopback callback server ─────────────────────────────────────────────────

function successPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>AWOG</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0b0b0b;color:#e6e6e6;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center}h1{font-size:20px;margin:0 0 8px}p{opacity:.65;font-size:14px}</style></head>
<body><div class="card"><h1>Connected</h1><p>You can close this tab and return to AWOG.</p></div></body></html>`
}

function errorPage(detail: string): string {
  const safe = detail.replace(/[<>&]/g, '')
  return `<!doctype html><html><head><meta charset="utf-8"><title>AWOG</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0b0b0b;color:#e6e6e6;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center}h1{font-size:20px;margin:0 0 8px}p{opacity:.65;font-size:14px}</style></head>
<body><div class="card"><h1>Authorization failed</h1><p>${safe}</p></div></body></html>`
}

interface CallbackServer {
  port: number
  redirectUri: string
  // Resolves with the authorization code once the browser hits the callback.
  code: Promise<string>
  close: () => void
}

// Bind a callback server on the first free port in the range. The returned
// `code` promise resolves on a valid callback (state matched) or rejects on
// error/mismatch/timeout/abort. `close()` tears it down.
async function startCallbackServer(
  expectedState: string,
  signal: AbortSignal,
): Promise<CallbackServer> {
  let resolveCode!: (code: string) => void
  let rejectCode!: (err: Error) => void
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  let server: Server | null = null
  let timer: NodeJS.Timeout | undefined
  const close = (): void => {
    if (timer) clearTimeout(timer)
    if (server) {
      server.close()
      server = null
    }
    signal.removeEventListener('abort', onAbort)
  }
  function onAbort(): void {
    close()
    rejectCode(new Error('canceled'))
  }

  const handler = (port: number) =>
    createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://localhost:${port}`)
      if (reqUrl.pathname !== CALLBACK_PATH) {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      const error = reqUrl.searchParams.get('error')
      const state = reqUrl.searchParams.get('state')
      const authCode = reqUrl.searchParams.get('code')
      const fail = (detail: string, message: string): void => {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(errorPage(detail))
        close()
        rejectCode(new Error(message))
      }
      if (error) return fail(error, `OAuth error: ${error}`)
      if (state !== expectedState) return fail('State mismatch.', 'OAuth state mismatch')
      if (!authCode) return fail('No authorization code received.', 'no authorization code')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(successPage())
      close()
      resolveCode(authCode)
    })

  for (let port = CALLBACK_PORT_START; port <= CALLBACK_PORT_END; port++) {
    const candidate = handler(port)
    try {
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve, reject) => {
        candidate.once('error', reject)
        candidate.listen(port, 'localhost', () => {
          candidate.removeListener('error', reject)
          resolve()
        })
      })
      server = candidate
      timer = setTimeout(() => {
        close()
        rejectCode(new Error('OAuth timeout — no callback received within 5 minutes'))
      }, CALLBACK_TIMEOUT_MS)
      if (signal.aborted) {
        onAbort()
      } else {
        signal.addEventListener('abort', onAbort, { once: true })
      }
      return { port, redirectUri: `http://localhost:${port}${CALLBACK_PATH}`, code, close }
    } catch (err) {
      candidate.close()
      const isInUse =
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
      if (!isInUse) throw err instanceof Error ? err : new Error(String(err))
    }
  }
  throw new Error(
    `all OAuth callback ports (${CALLBACK_PORT_START}-${CALLBACK_PORT_END}) are in use`,
  )
}

// ─── Full interactive flow ────────────────────────────────────────────────────

export interface RunOAuthFlowOptions {
  // URL to run OAuth metadata discovery against (RFC 9728 → 8414) when `metadata`
  // is not supplied. mcp.url for an mcp source; api.baseUrl for an api-oauth
  // source without an explicit oauth block.
  discoverUrl: string
  // Pre-resolved OAuth server metadata (explicit api.oauth block). When present,
  // discovery is skipped entirely.
  metadata?: OAuthMetadata
  // A previously registered / configured client id to reuse (skips DCR when present).
  existingClientId?: string
  // Confidential-client secret (api.oauth.clientSecret) — sent on token exchange.
  clientSecret?: string
  // Extra authorize-request parameters for generic api-oauth providers.
  scopes?: string[]
  audience?: string
  extraParams?: Record<string, string>
  signal: AbortSignal
  // Called once the authorize URL is built so the caller can surface it to the
  // UI (which opens it in the browser). Carries only the public authorize URL.
  onAuthorizeUrl: (url: string) => void
}

// Discover (or use explicit metadata) → PKCE → start callback → (DCR | fixed
// client) → build authorize URL → hand it to onAuthorizeUrl → await the callback
// code → exchange for tokens. Honors `signal` (cancel closes the callback server
// + rejects). Throws on any failure; the caller classifies cancel vs error.
export async function runOAuthFlow(opts: RunOAuthFlowOptions): Promise<OAuthFlowResult> {
  if (opts.signal.aborted) throw new Error('canceled')

  const metadata = opts.metadata ?? (await discoverMcpOAuth(opts.discoverUrl))
  if (!metadata) {
    throw new Error(`no OAuth metadata found for ${opts.discoverUrl} (server may not require OAuth)`)
  }

  const verifier = genVerifier()
  const challenge = genChallenge(verifier)
  const state = genStateToken()

  // Bind the callback server BEFORE registering the client — the redirect_uri
  // carries the actually-bound port (no check-then-bind TOCTOU race).
  const callback = await startCallbackServer(state, opts.signal)
  try {
    let clientId = opts.existingClientId
    if (!clientId) {
      if (metadata.registration_endpoint) {
        try {
          clientId = await registerClient(metadata.registration_endpoint, callback.redirectUri)
        } catch (err) {
          if (!shouldFallbackToFixedClient(err)) throw err
          clientId = FALLBACK_CLIENT_ID
        }
      } else {
        clientId = FALLBACK_CLIENT_ID
      }
    }

    const authUrl = new URL(metadata.authorization_endpoint)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', callback.redirectUri)
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('code_challenge', challenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    // Generic api-oauth extras (no-op for mcp discovery, which passes none).
    if (opts.scopes && opts.scopes.length > 0) {
      authUrl.searchParams.set('scope', opts.scopes.join(' '))
    }
    if (opts.audience) authUrl.searchParams.set('audience', opts.audience)
    if (opts.extraParams) {
      for (const [key, value] of Object.entries(opts.extraParams)) {
        authUrl.searchParams.set(key, value)
      }
    }

    opts.onAuthorizeUrl(authUrl.toString())

    const code = await callback.code
    const tokens = await exchangeCode(
      metadata.token_endpoint,
      code,
      verifier,
      clientId,
      callback.redirectUri,
      opts.clientSecret,
    )
    return { tokens, clientId, tokenEndpoint: metadata.token_endpoint }
  } finally {
    callback.close()
  }
}
