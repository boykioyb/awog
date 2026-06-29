import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { exchangeCode } from '../auth/anthropic-oauth.js'
import { takeState } from '../auth/state-store.js'
import { loadCredentials, saveCredentials, toSafe } from '../credentials/store.js'
import { invalidateCache } from '../credentials/token-manager.js'
import { log } from '../util/logger.js'
import type { AccountRecord, OAuthTokens } from '../types/shared.js'

const Params = z.object({
  state: z.string().min(1),
  code: z.string().min(1),
  label: z.string().trim().min(1).optional(),
  // Re-authentication: when the user signs in again to refresh an expired
  // account, replace that account's credentials in place (same id, preserves the
  // active selection) instead of pushing a duplicate row.
  replaceAccountId: z.string().min(1).optional(),
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
  const account = response.account
    ? { uuid: response.account.uuid, email: response.account.email_address }
    : undefined

  const data = await loadCredentials()
  const accounts = data.providers.anthropic.accounts

  // Re-auth path: refresh the credentials of an existing oauth account in place.
  const existing = params.replaceAccountId
    ? accounts.find((a) => a.id === params.replaceAccountId && a.authMode === 'oauth')
    : undefined

  let record: AccountRecord
  if (existing) {
    existing.oauth = tokens
    if (params.label) existing.label = params.label
    if (response.organization) existing.organization = response.organization
    else delete existing.organization
    if (account) existing.account = account
    else delete existing.account
    existing.version += 1
    record = existing
  } else {
    record = {
      id: newAccountId(),
      label: params.label ?? defaultLabel,
      authMode: 'oauth',
      oauth: tokens,
      version: 0,
      createdAt: new Date().toISOString(),
    }
    if (response.organization) record.organization = response.organization
    if (account) record.account = account
    accounts.push(record)
    if (data.providers.anthropic.activeAccountId === null) {
      data.providers.anthropic.activeAccountId = record.id
    }
  }

  await saveCredentials(data)

  // Drop any cached tokens for this account: after re-auth the old refresh token
  // has been rotated away, so a stale cache entry would make the next
  // ensureFreshAccessToken refresh with a now-invalid token (AUTH_EXPIRED).
  invalidateCache('anthropic', record.id)

  log.info(existing ? 'oauth account re-authenticated' : 'oauth account added', {
    provider: 'anthropic',
    accountId: record.id,
    org: record.organization?.name,
  })

  return toSafe(record)
})
