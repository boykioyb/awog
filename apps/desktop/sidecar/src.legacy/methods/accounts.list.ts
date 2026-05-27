import { register } from '../transport/rpc.js'
import { loadCredentials, toSafe } from '../credentials/store.js'
import type { AccountSafe, ProviderName } from '../types/shared.js'

interface SafeBucket {
  accounts: AccountSafe[]
  activeAccountId: string | null
}

register('accounts.list', async () => {
  const data = await loadCredentials()
  const providers = {} as Record<ProviderName, SafeBucket>
  for (const name of ['anthropic', 'openai', 'google'] as const) {
    providers[name] = {
      accounts: data.providers[name].accounts.map(toSafe),
      activeAccountId: data.providers[name].activeAccountId,
    }
  }
  return { providers }
})
