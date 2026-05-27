import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { exchangeCode } from '../auth/anthropic-oauth.js'
import { takeState } from '../auth/state-store.js'
import { loadCredentials, saveCredentials, toSafe } from '../credentials/store.js'
import { log } from '../util/logger.js'
import type { AccountRecord, OAuthTokens } from '../types/shared.js'

const Params = z.object({
  state: z.string().min(1),
  code: z.string().min(1),
  label: z.string().trim().min(1).optional(),
})

function newAccountId(): string {
  return `acc_${randomBytes(8).toString('hex')}`
}

function emailLocalPart(email: string | undefined): string {
  if (!email) return 'account'
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

register('auth.completeOAuth', async (raw) => {
  const params = Params.parse(raw)

  const stored = takeState(params.state)
  if (!stored) throw new RpcError(-32001, 'state_expired')

  const response = await exchangeCode(params.code, stored.verifier, params.state)

  const tokens: OAuthTokens = {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Date.now() + response.expires_in * 1000,
  }
  if (response.scope) tokens.scope = response.scope
  if (response.token_uuid) tokens.tokenUuid = response.token_uuid

  const orgName = response.organization?.name ?? 'Anthropic'
  const local = emailLocalPart(response.account?.email_address)
  const defaultLabel = `${orgName} (${local})`

  const record: AccountRecord = {
    id: newAccountId(),
    label: params.label ?? defaultLabel,
    authMode: 'oauth',
    oauth: tokens,
    version: 0,
    createdAt: new Date().toISOString(),
  }
  if (response.organization) record.organization = response.organization
  if (response.account) {
    record.account = {
      uuid: response.account.uuid,
      email: response.account.email_address,
    }
  }

  const data = await loadCredentials()
  data.providers.anthropic.accounts.push(record)
  if (data.providers.anthropic.activeAccountId === null) {
    data.providers.anthropic.activeAccountId = record.id
  }
  await saveCredentials(data)

  log.info('oauth account added', {
    provider: 'anthropic',
    accountId: record.id,
    org: record.organization?.name,
  })

  return toSafe(record)
})
