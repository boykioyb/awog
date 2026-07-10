// OAuth token orchestration for remote (http) MCP sources — ADR 0060 D-4, P2.
//
// Sits between the token store (oauth-store.ts) + protocol (oauth.ts) and the
// runtime resolvers. Mirrors Craft's TokenRefreshManager LOGIC (refresh within 5
// min of expiry, dedupe concurrent refreshes per source id, 5-min cooldown after
// a failure) as module-level singletons — the sidecar is a single long-lived
// process, so per-id state is naturally shared.
//
// `getFreshToken` is called PER TURN by both resolvers (sessions.send-message.ts
// + tasks/agent-context.ts). On a valid token it just returns it (a keychain
// read, no disk write). It only writes the source config when a refresh actually
// happens (→ connected) or unrecoverably fails (→ needs_auth), so the common
// path stays cheap.
//
// Invariant 1: the returned token is injected into the mcp `headers` map the
// runtime consumes — it never appears in an RPC response or a log line.

import { saveSource } from './store.js'
import {
  isTokenExpired,
  loadToken,
  saveToken,
  tokenNeedsRefresh,
  type OAuthTokenBundle,
} from './oauth-store.js'
import { refreshMcpToken, refreshOAuthTokenAt, resolveApiOAuthMetadata } from './oauth.js'
import { log } from '../util/logger.js'
import type { ApiSource, McpSource, SourceConnectionStatus } from '../types/shared.js'

// Cooldown after a failed refresh so a broken token doesn't hammer the endpoint
// every turn (mirrors Craft's DEFAULT_COOLDOWN_MS).
const COOLDOWN_MS = 5 * 60 * 1000

// In-flight refreshes keyed by source id — collapses concurrent refreshes (e.g.
// several tools firing at once) into one network round-trip.
const pendingRefreshes = new Map<string, Promise<string | null>>()
// Last failure timestamp per source id → cooldown gate.
const failedAt = new Map<string, number>()

function inCooldown(id: string): boolean {
  const last = failedAt.get(id)
  return last !== undefined && Date.now() - last < COOLDOWN_MS
}

// A source whose OAuth token bundle this module manages: an oauth remote-mcp
// source or a generic api-oauth source (ADR 0060 D-4). local + non-oauth kinds
// never reach here.
type OAuthSource = McpSource | ApiSource

// Persist a status transition onto the source config. Best-effort — a write
// failure must not break the turn (the runtime still has the in-memory token).
async function markStatus(
  source: OAuthSource,
  status: SourceConnectionStatus,
  opts: { authenticated: boolean; error?: string },
): Promise<void> {
  try {
    const next = {
      ...source,
      connectionStatus: status,
      isAuthenticated: opts.authenticated,
      updatedAt: Date.now(),
    }
    if (opts.error) next.connectionError = opts.error
    else delete next.connectionError
    await saveSource(next)
  } catch (err) {
    log.warn('sources/oauth: failed to persist status', {
      id: source.id,
      status,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

async function doRefreshMcp(source: McpSource, bundle: OAuthTokenBundle): Promise<string | null> {
  const url = source.mcp.url
  const clientId = bundle.clientId ?? source.mcp.clientId
  // Can't refresh without a refresh token + client id + url → treat as needing
  // re-auth if the current token is already expired, else keep using it.
  if (!bundle.refreshToken || !clientId || !url) {
    if (isTokenExpired(bundle)) {
      failedAt.set(source.id, Date.now())
      await markStatus(source, 'needs_auth', {
        authenticated: false,
        error: 'Token expired and cannot be refreshed — reconnect.',
      })
      return null
    }
    return bundle.accessToken
  }

  try {
    const next = await refreshMcpToken(url, bundle.refreshToken, clientId)
    await saveToken(source.id, next)
    failedAt.delete(source.id)
    await markStatus(source, 'connected', { authenticated: true })
    log.info('sources/oauth: refreshed token', { id: source.id })
    return next.accessToken
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    failedAt.set(source.id, Date.now())
    await markStatus(source, 'needs_auth', {
      authenticated: false,
      error: `Token refresh failed: ${message}`,
    })
    log.warn('sources/oauth: refresh failed', { id: source.id, err: message })
    return null
  }
}

// Generic api-oauth refresh (ADR 0060 P6). Resolves the token endpoint from the
// explicit api.oauth block or by re-discovering from api.baseUrl, then refreshes.
async function doRefreshApi(source: ApiSource, bundle: OAuthTokenBundle): Promise<string | null> {
  const clientId = bundle.clientId ?? source.api.oauth?.clientId
  if (!bundle.refreshToken || !clientId) {
    if (isTokenExpired(bundle)) {
      failedAt.set(source.id, Date.now())
      await markStatus(source, 'needs_auth', {
        authenticated: false,
        error: 'Token expired and cannot be refreshed — reconnect.',
      })
      return null
    }
    return bundle.accessToken
  }

  try {
    const metadata = await resolveApiOAuthMetadata(source)
    if (!metadata) throw new Error('could not resolve token endpoint for refresh')
    const next = await refreshOAuthTokenAt(
      metadata.token_endpoint,
      bundle.refreshToken,
      clientId,
      source.api.oauth?.clientSecret,
    )
    await saveToken(source.id, next)
    failedAt.delete(source.id)
    await markStatus(source, 'connected', { authenticated: true })
    log.info('sources/oauth: refreshed api token', { id: source.id })
    return next.accessToken
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    failedAt.set(source.id, Date.now())
    await markStatus(source, 'needs_auth', {
      authenticated: false,
      error: `Token refresh failed: ${message}`,
    })
    log.warn('sources/oauth: api refresh failed', { id: source.id, err: message })
    return null
  }
}

function doRefresh(source: OAuthSource, bundle: OAuthTokenBundle): Promise<string | null> {
  return source.type === 'api' ? doRefreshApi(source, bundle) : doRefreshMcp(source, bundle)
}

// Return a valid access token for an oauth source (remote mcp OR generic api),
// refreshing when within 5 min of expiry. Dedupes concurrent refreshes per id;
// respects a post-failure cooldown. Returns null when there is no usable token
// (source should be treated as needs_auth). Never throws.
export async function getFreshToken(source: OAuthSource): Promise<string | null> {
  const bundle = await loadToken(source.id)
  if (!bundle) return null

  if (!tokenNeedsRefresh(bundle)) return bundle.accessToken

  // In cooldown after a recent failure → serve the current token if still valid,
  // else give up (null) until the cooldown lapses.
  if (inCooldown(source.id)) {
    return isTokenExpired(bundle) ? null : bundle.accessToken
  }

  const existing = pendingRefreshes.get(source.id)
  if (existing) return existing

  const promise = doRefresh(source, bundle).finally(() => {
    pendingRefreshes.delete(source.id)
  })
  pendingRefreshes.set(source.id, promise)
  return promise
}

// True when a source is an oauth-authenticated remote MCP source (the only kind
// that gets a Bearer token injected). stdio + bearer + none are untouched.
export function isOAuthMcpSource(source: McpSource): boolean {
  const transport = source.mcp.transport ?? 'http'
  return transport !== 'stdio' && source.mcp.authType === 'oauth'
}

// Layer a fresh `Authorization: Bearer <token>` on top of the already-expanded
// static headers for an oauth mcp source. No-op for non-oauth sources or when no
// token is available (the handshake then 401s → surfaced as needs_auth). Shared
// by BOTH runtime resolvers so chat + tasks inject identically.
export async function applyOAuthAuthorization(
  source: McpSource,
  headers: Record<string, string>,
): Promise<Record<string, string>> {
  if (!isOAuthMcpSource(source)) return headers
  const token = await getFreshToken(source)
  if (!token) return headers
  return { ...headers, Authorization: `Bearer ${token}` }
}
