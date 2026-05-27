import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { findAccount, loadCredentials, saveCredentials } from '../credentials/store.js'
import { log } from '../util/logger.js'

const Params = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  accountId: z.string().min(1).nullable(),
})

register('accounts.setActive', async (raw) => {
  const params = Params.parse(raw)
  const data = await loadCredentials()
  if (params.accountId !== null && !findAccount(data, params.provider, params.accountId)) {
    throw new RpcError(-32004, `Account not found: ${params.provider}/${params.accountId}`)
  }
  data.providers[params.provider].activeAccountId = params.accountId
  await saveCredentials(data)
  log.info('active account changed', {
    provider: params.provider,
    accountId: params.accountId,
  })
  return { ok: true }
})
