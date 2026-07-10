// Start an OAuth authorization for a Source — ADR 0060 D-4, P2 (remote mcp) + P6
// (generic api-oauth). Successor pattern to auth.start-oauth-codex.ts: a
// LONG-LIVED RPC that returns only after the user authorizes in their browser (a
// loopback callback captures the redirect) or the flow is cancelled.
//
// The heavy lifting lives in sources/oauth-start.ts (startSourceOAuth) so the
// agent-callable `source_oauth_trigger` tool drives the identical flow. This RPC
// only validates the request (→ RpcError on a bad source), wires the
// `source.oauth-url { slug, url }` event so the UI opens the authorize URL (the
// sidecar never opens a browser itself — invariant 4), and maps the shared
// result onto the RPC contract. The token itself never crosses the RPC boundary
// (invariant 1).
//
// Cancel: source.cancelOAuth with the same slug aborts the shared flow
// controller → the callback server closes + rejects → this RPC throws CANCELED.
//
// Idempotent success: a valid (or refreshable) token already present returns
// { ok:true, alreadyAuthenticated:true } without opening a browser.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { emit } from '../transport/stdio.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'
import { loadSource } from '../sources/store.js'
import { resolveOAuthTarget, startSourceOAuth } from '../sources/oauth-start.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
})

register('source.startOAuth', async (raw) => {
  const { slug } = Params.parse(raw)

  // Validate up-front so a bad source is a proper -32602 (bad request) rather
  // than a flow-level {ok:false}. startSourceOAuth re-checks defensively.
  const source = await loadSource(slug)
  if (!source) throw new RpcError(-32602, `source not found: ${slug}`)
  const resolved = resolveOAuthTarget(source)
  if (!resolved.ok) throw new RpcError(-32602, resolved.error)

  const result = await startSourceOAuth(slug, (url) => emit('source.oauth-url', { slug, url }))

  if (result.canceled) throw new RpcError(-32023, 'CANCELED')
  if (result.ok) {
    return {
      ok: true,
      alreadyAuthenticated: result.alreadyAuthenticated,
      status: 'connected' as const,
    }
  }
  return { ok: false, status: result.status, error: result.error }
})
