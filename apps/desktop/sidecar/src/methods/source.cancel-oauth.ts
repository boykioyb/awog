// Cancel an in-flight source OAuth authorization — ADR 0060 D-4, P2. Mirrors
// auth.cancel-oauth.ts: aborts the AbortController registered under the source's
// flow key by source.startOAuth, which closes the loopback callback server and
// rejects the code promise → the start RPC throws CANCELED. Idempotent: returns
// { ok, found } so the UI can ignore a stale cancel without error.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { cancelFlow } from '../auth/oauth-flow-store.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'
import { oauthFlowKey } from './source.start-oauth.js'
import { log } from '../util/logger.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
})

register('source.cancelOAuth', (raw) => {
  const { slug } = Params.parse(raw)
  const found = cancelFlow(oauthFlowKey(slug))
  log.info('source.cancelOAuth requested', { slug, found })
  return { ok: true, found }
})
