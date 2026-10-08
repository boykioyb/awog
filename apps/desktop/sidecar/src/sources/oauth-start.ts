// Shared source-OAuth start orchestration (ADR 0060 D-4, P2/P6). Extracted so
// BOTH the long-lived `source.startOAuth` RPC (methods/source.start-oauth.ts) and
// the agent-callable `source_oauth_trigger` tool (runtime/tools/source-tools.ts)
// drive the SAME flow — no copy-paste, one place that registers the cancellable
// flow, runs the loopback OAuth dance, persists the token to the keychain, and
// flips the source status.
//
// Supports two source kinds:
//   - mcp (transport http/sse, authType 'oauth'): discover from mcp.url.
//   - api (authType 'oauth'): explicit api.oauth {authorizationUrl, tokenUrl,
//     clientId, ...} when present, else discover from api.baseUrl (RFC 9728/8414).
//
// Invariant 1: the token never leaves the sidecar — it goes to the OS keychain
// (sources/oauth-store.ts) and is never returned, logged, or emitted. Only the
// public authorize URL is surfaced (via onAuthorizeUrl → the UI opens it).

import { putFlow, removeFlow } from '../auth/oauth-flow-store.js'
import { resolveSecretValue } from '../mcp/secrets.js'
import { loadSource, saveSource } from './store.js'
import { runOAuthFlow, type OAuthMetadata } from './oauth.js'
import { saveToken } from './oauth-store.js'
import { getFreshToken } from './oauth-manager.js'
import { log } from '../util/logger.js'
import type { ApiSource, McpSource, SourceConfig, SourceConnectionStatus } from '../types/shared.js'

// Namespace the flow key away from codex/anthropic flows in the shared
// oauth-flow-store (start + cancel derive it the same way).
export function oauthFlowKey(slug: string): string {
  return `source-oauth:${slug}`
}

// Resolved OAuth flow parameters for a source. `metadata` present → skip
// discovery (explicit api.oauth); absent → discover from `discoverUrl`.
export interface OAuthTarget {
  discoverUrl: string
  metadata?: OAuthMetadata
  existingClientId?: string
  clientSecret?: string
  scopes?: string[]
  audience?: string
  extraParams?: Record<string, string>
}

// Every scope Slack's hosted MCP server advertises (the `scopes_supported` of
// https://mcp.slack.com/.well-known/oauth-authorization-server). Slack's MCP
// authorize endpoint is `oauth/v2_user/authorize` and accepts ONLY `user_scope`
// (comma-joined) — a bare `scope` or no scope at all fails with
// "Invalid permissions requested / No scopes requested". Override per source
// via `mcp.oauthParams.user_scope` when the registered Slack app has a smaller
// scope set enabled.
const SLACK_MCP_USER_SCOPES = [
  'canvases:read',
  'canvases:write',
  'channels:history',
  'channels:read',
  'channels:write',
  'chat:write',
  'emoji:read',
  'files:read',
  'files:write',
  'groups:history',
  'groups:read',
  'groups:write',
  'im:history',
  'im:read',
  'im:write',
  'lists:read',
  'lists:write',
  'mpim:history',
  'mpim:read',
  'mpim:write',
  'reactions:read',
  'reactions:write',
  'search:read.files',
  'search:read.im',
  'search:read.mpim',
  'search:read.private',
  'search:read.public',
  'search:read.users',
  'users:read',
  'users:read.email',
].join(',')

// Classify a source as OAuth-capable and resolve its flow parameters, or explain
// why it is not an OAuth source. Both the RPC (→ RpcError) and the tool (→ tool
// error text) call this so their validation stays identical.
export function resolveOAuthTarget(
  source: SourceConfig,
): { ok: true; target: OAuthTarget } | { ok: false; error: string } {
  if (source.type === 'mcp') {
    const transport = source.mcp.transport ?? 'http'
    if (transport === 'stdio') {
      return { ok: false, error: `source '${source.slug}' uses stdio transport — no OAuth` }
    }
    if (source.mcp.authType !== 'oauth') {
      return {
        ok: false,
        error: `source '${source.slug}' is not configured for OAuth (mcp.authType != oauth)`,
      }
    }
    if (!source.mcp.url) {
      return { ok: false, error: `source '${source.slug}' has no mcp.url` }
    }
    const target: OAuthTarget = { discoverUrl: source.mcp.url }
    if (source.mcp.clientId) target.existingClientId = source.mcp.clientId
    if (source.mcp.oauthParams) target.extraParams = { ...source.mcp.oauthParams }
    // Slack's hosted MCP only mints USER tokens — send `user_scope`, and default
    // it to everything the server advertises when the source doesn't say.
    if (source.provider === 'slack' && !target.extraParams?.user_scope) {
      target.extraParams = { ...target.extraParams, user_scope: SLACK_MCP_USER_SCOPES }
    }
    return { ok: true, target }
  }

  if (source.type === 'api') {
    if (source.api.authType !== 'oauth') {
      return {
        ok: false,
        error: `source '${source.slug}' is not configured for OAuth (api.authType != oauth)`,
      }
    }
    const oauth = source.api.oauth
    const target: OAuthTarget = { discoverUrl: source.api.baseUrl }
    if (oauth) {
      target.metadata = {
        authorization_endpoint: oauth.authorizationUrl,
        token_endpoint: oauth.tokenUrl,
      }
      target.existingClientId = oauth.clientId
      if (oauth.clientSecret) target.clientSecret = oauth.clientSecret
      if (oauth.scopes) target.scopes = oauth.scopes
      if (oauth.audience) target.audience = oauth.audience
      if (oauth.extraParams) target.extraParams = oauth.extraParams
    }
    return { ok: true, target }
  }

  return { ok: false, error: `source '${source.slug}' (local) does not support OAuth` }
}

export interface SourceOAuthStartResult {
  ok: boolean
  alreadyAuthenticated: boolean
  status: SourceConnectionStatus
  error?: string
  // True when the flow was cancelled via source.cancelOAuth (caller maps to CANCELED).
  canceled?: boolean
}

// Flip a source to connected + persist the (non-secret) client id for mcp so a
// later refresh reuses the DCR-registered id. api-oauth carries its client id in
// the token bundle (+ optionally api.oauth.clientId), so no config write is
// needed beyond the status.
function markConnected(source: McpSource | ApiSource, clientId: string): McpSource | ApiSource {
  const now = Date.now()
  const next =
    source.type === 'mcp'
      ? { ...source, mcp: { ...source.mcp, clientId }, isAuthenticated: true, updatedAt: now }
      : { ...source, isAuthenticated: true, updatedAt: now }
  next.connectionStatus = 'connected'
  delete next.connectionError
  return next
}

// Run the full interactive OAuth flow for a source (mcp OR api). Registers a
// cancellable flow keyed by slug (so source.cancelOAuth can abort it), runs the
// loopback dance, persists the token to the keychain, and flips the source
// status. If a valid/refreshable token already exists, returns immediately
// without opening a browser. Never throws — returns a status-only result.
export async function startSourceOAuth(
  slug: string,
  onAuthorizeUrl: (url: string) => void,
): Promise<SourceOAuthStartResult> {
  const source = await loadSource(slug)
  if (!source) {
    return { ok: false, alreadyAuthenticated: false, status: 'untested', error: `source not found: ${slug}` }
  }
  if (source.type === 'local') {
    return {
      ok: false,
      alreadyAuthenticated: false,
      status: source.connectionStatus ?? 'untested',
      error: `source '${slug}' (local) does not support OAuth`,
    }
  }
  // source is now McpSource | ApiSource.
  const resolved = resolveOAuthTarget(source)
  if (!resolved.ok) {
    return {
      ok: false,
      alreadyAuthenticated: false,
      status: source.connectionStatus ?? 'untested',
      error: resolved.error,
    }
  }
  const oauthSource = source
  const target = resolved.target

  // OAuth client_secret lives as a `secret:KEY` keychain ref in config (mcp
  // field; api.oauth copy already sits on target) — resolve to plaintext for
  // the token exchange. A missing entry surfaces as an auth failure at the
  // provider's token endpoint.
  if (source.type === 'mcp' && source.mcp.clientSecret) {
    target.clientSecret = source.mcp.clientSecret
  }
  const resolvedSecret = await resolveSecretValue(source.id, target.clientSecret)
  if (resolvedSecret) target.clientSecret = resolvedSecret

  // Already have a usable (or refreshable) token → silent success, no browser.
  const existing = await getFreshToken(oauthSource)
  if (existing) {
    log.info('startSourceOAuth: already authenticated', { slug })
    return { ok: true, alreadyAuthenticated: true, status: 'connected' }
  }

  const controller = new AbortController()
  const flowKey = oauthFlowKey(slug)
  putFlow(flowKey, controller)
  log.info('startSourceOAuth: flow started', { slug, type: source.type })

  try {
    const result = await runOAuthFlow({
      discoverUrl: target.discoverUrl,
      ...(target.metadata ? { metadata: target.metadata } : {}),
      ...(target.existingClientId ? { existingClientId: target.existingClientId } : {}),
      ...(target.clientSecret ? { clientSecret: target.clientSecret } : {}),
      ...(target.scopes ? { scopes: target.scopes } : {}),
      ...(target.audience ? { audience: target.audience } : {}),
      ...(target.extraParams ? { extraParams: target.extraParams } : {}),
      signal: controller.signal,
      onAuthorizeUrl,
    })

    // Persist tokens to the keychain (never to disk/config).
    await saveToken(source.id, result.tokens)
    await saveSource(markConnected(oauthSource, result.clientId))

    log.info('startSourceOAuth: connected', { slug })
    return { ok: true, alreadyAuthenticated: false, status: 'connected' }
  } catch (err) {
    if (controller.signal.aborted) {
      return {
        ok: false,
        alreadyAuthenticated: false,
        status: source.connectionStatus ?? 'needs_auth',
        canceled: true,
      }
    }
    const message = err instanceof Error ? err.message : String(err)
    // Mark needs_auth so the UI reflects the failed attempt. Token strings never
    // appear in OAuth errors, but keep the surface minimal (best-effort persist).
    try {
      await saveSource({
        ...oauthSource,
        isAuthenticated: false,
        connectionStatus: 'needs_auth',
        connectionError: message,
        updatedAt: Date.now(),
      })
    } catch {
      // A persist failure must not mask the OAuth error.
    }
    log.warn('startSourceOAuth: failed', { slug, err: message })
    return { ok: false, alreadyAuthenticated: false, status: 'needs_auth', error: message }
  } finally {
    removeFlow(flowKey)
  }
}
