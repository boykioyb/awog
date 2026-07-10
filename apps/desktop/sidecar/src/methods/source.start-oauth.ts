// Start an OAuth authorization for a remote (http) MCP source — ADR 0060 D-4,
// P2. Successor pattern to auth.start-oauth-codex.ts: a LONG-LIVED RPC that
// returns only after the user authorizes in their browser (a loopback callback
// captures the redirect) or the flow is cancelled.
//
// It discovers the OAuth metadata, starts the callback server, builds the
// authorize URL, and emits `source.oauth-url { slug, url }` so the UI can open
// it in the browser (the UI opens it via shell.openExternal — the sidecar never
// opens a browser itself, matching the codex flow + invariant 4). On the
// callback it exchanges the code for tokens, stores them in the OS keychain
// (sources/oauth-store.ts — NEVER config.json), marks the source
// connected/authenticated, and returns a status-only result. The token itself
// never crosses the RPC boundary (invariant 1).
//
// Cancel: source.cancelOAuth with the same slug aborts the shared flow
// controller → the callback server closes + rejects → this RPC throws CANCELED.
//
// Idempotent success: if a valid (or refreshable) token already exists, it
// returns { ok:true, alreadyAuthenticated:true } without opening a browser.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { emit } from '../transport/stdio.js'
import { putFlow, removeFlow } from '../auth/oauth-flow-store.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'
import { loadSource, saveSource } from '../sources/store.js'
import { runOAuthFlow } from '../sources/oauth.js'
import { saveToken } from '../sources/oauth-store.js'
import { getFreshToken } from '../sources/oauth-manager.js'
import { log } from '../util/logger.js'
import type { McpSource } from '../types/shared.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
})

// Namespace the flow key away from codex/anthropic flows in the shared
// oauth-flow-store (start + cancel use the same derivation).
export function oauthFlowKey(slug: string): string {
  return `source-oauth:${slug}`
}

register('source.startOAuth', async (raw) => {
  const { slug } = Params.parse(raw)

  const source = await loadSource(slug)
  if (!source) throw new RpcError(-32602, `source not found: ${slug}`)
  if (source.type !== 'mcp') {
    throw new RpcError(-32602, `source ${slug} is not an mcp source`)
  }
  const transport = source.mcp.transport ?? 'http'
  if (transport === 'stdio') {
    throw new RpcError(-32602, `source ${slug} uses stdio transport — no OAuth`)
  }
  if (source.mcp.authType !== 'oauth') {
    throw new RpcError(-32602, `source ${slug} is not configured for OAuth (authType != oauth)`)
  }
  if (!source.mcp.url) {
    throw new RpcError(-32602, `source ${slug} has no mcp.url`)
  }
  const mcpUrl = source.mcp.url

  // Already have a usable (or refreshable) token → silent success, no browser.
  const existing = await getFreshToken(source)
  if (existing) {
    log.info('source.startOAuth: already authenticated', { slug })
    return { ok: true, alreadyAuthenticated: true, status: 'connected' as const }
  }

  const controller = new AbortController()
  const flowKey = oauthFlowKey(slug)
  putFlow(flowKey, controller)
  log.info('source.startOAuth: flow started', { slug })

  try {
    const result = await runOAuthFlow({
      mcpUrl,
      ...(source.mcp.clientId ? { existingClientId: source.mcp.clientId } : {}),
      signal: controller.signal,
      onAuthorizeUrl: (url) => emit('source.oauth-url', { slug, url }),
    })

    // Persist tokens to the keychain (never to disk/config).
    await saveToken(source.id, result.tokens)

    // Persist the (non-secret) client id so refresh reuses it, and flip status.
    const next: McpSource = {
      ...source,
      mcp: { ...source.mcp, clientId: result.clientId },
      isAuthenticated: true,
      connectionStatus: 'connected',
      updatedAt: Date.now(),
    }
    delete next.connectionError
    await saveSource(next)

    log.info('source.startOAuth: connected', { slug })
    return { ok: true, alreadyAuthenticated: false, status: 'connected' as const }
  } catch (err) {
    if (controller.signal.aborted) {
      throw new RpcError(-32023, 'CANCELED')
    }
    const message = err instanceof Error ? err.message : String(err)
    // Mark needs_auth so the UI reflects the failed attempt. Token strings never
    // appear in OAuth errors, but keep the surface minimal.
    try {
      const next: McpSource = {
        ...source,
        isAuthenticated: false,
        connectionStatus: 'needs_auth',
        connectionError: message,
        updatedAt: Date.now(),
      }
      await saveSource(next)
    } catch {
      // best effort — a persist failure must not mask the OAuth error
    }
    log.warn('source.startOAuth: failed', { slug, err: message })
    return { ok: false, status: 'needs_auth' as const, error: message }
  } finally {
    removeFlow(flowKey)
  }
})
