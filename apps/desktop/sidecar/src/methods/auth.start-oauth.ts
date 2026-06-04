import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { buildAuthorizeUrl } from '../auth/anthropic-oauth.js'
import { genChallenge, genStateToken, genVerifier } from '../auth/pkce.js'
import { putState } from '../auth/state-store.js'
import { log } from '../util/logger.js'

const Params = z.object({
  provider: z.string(),
})

register('auth.startOAuth', (raw) => {
  const params = Params.parse(raw)
  if (params.provider !== 'anthropic') {
    throw new RpcError(-32602, `OAuth not supported for provider: ${params.provider}`)
  }

  const verifier = genVerifier()
  const challenge = genChallenge(verifier)
  const state = genStateToken()

  putState(state, verifier)
  const authUrl = buildAuthorizeUrl(state, challenge)

  log.info('oauth flow started', { provider: params.provider, state })
  return { state, authUrl }
})
