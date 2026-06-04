import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadCredentials, saveCredentials } from '../credentials/store.js'
import { invalidateCache } from '../credentials/token-manager.js'
import { log } from '../util/logger.js'

const Params = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  accountId: z.string().min(1),
})

register('accounts.remove', async (raw) => {
  const params = Params.parse(raw)
  const data = await loadCredentials()
  const bucket = data.providers[params.provider]
  const index = bucket.accounts.findIndex((a) => a.id === params.accountId)
  if (index < 0) {
    throw new RpcError(-32004, `Account not found: ${params.provider}/${params.accountId}`)
  }
  bucket.accounts.splice(index, 1)
  if (bucket.activeAccountId === params.accountId) {
    bucket.activeAccountId = null
  }
  await saveCredentials(data)
  invalidateCache(params.provider, params.accountId)
  log.info('account removed', { provider: params.provider, accountId: params.accountId })
  return { ok: true }
})
