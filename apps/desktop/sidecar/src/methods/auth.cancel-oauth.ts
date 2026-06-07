import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { cancelFlow } from '../auth/oauth-flow-store.js'
import { log } from '../util/logger.js'

// Cancel an in-flight OAuth login (ADR 0029). Aborts the AbortController
// registered under flowId by auth.startOAuthCodex, which makes loginCodex's
// onManualCodeInput lever reject → pi cancels its callback wait → the start RPC
// throws CANCELED. Idempotent: returns { ok, found } so the UI can ignore a
// stale cancel without error.
const Params = z.object({
  flowId: z.string().min(1),
})

register('auth.cancelOAuth', (raw) => {
  const params = Params.parse(raw)
  const found = cancelFlow(params.flowId)
  log.info('oauth flow cancel requested', { flowId: params.flowId, found })
  return { ok: true, found }
})
