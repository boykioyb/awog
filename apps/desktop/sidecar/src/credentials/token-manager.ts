import { refreshTokens } from '../auth/anthropic-oauth.js'
import { log } from '../util/logger.js'
import { fingerprint } from './fingerprint.js'
import {
  findAccount,
  loadCredentials,
  saveCredentials,
} from './store.js'
import type { OAuthTokens, ProviderName } from '../types/shared.js'

// Default floor: refresh when the token has under 5 minutes left. Enough for a
// caller that can re-resolve per request (the Pi runtime's getApiKey closure).
const REFRESH_BUFFER_MS = 5 * 60 * 1000

const cache = new Map<string, OAuthTokens>()
const inflight = new Map<string, Promise<OAuthTokens>>()

function cacheKey(provider: ProviderName, accountId: string): string {
  return `${provider}:${accountId}`
}

function needsRefresh(tokens: OAuthTokens, minLifetimeMs: number): boolean {
  return tokens.expiresAt - Date.now() < minLifetimeMs
}

async function persistTokens(
  provider: ProviderName,
  accountId: string,
  next: OAuthTokens,
): Promise<void> {
  const data = await loadCredentials()
  const record = findAccount(data, provider, accountId)
  if (!record) throw new Error(`Account not found: ${provider}/${accountId}`)
  record.oauth = next
  record.version += 1
  await saveCredentials(data)
}

async function performRefresh(
  provider: ProviderName,
  accountId: string,
  current: OAuthTokens,
): Promise<OAuthTokens> {
  log.info('refreshing oauth tokens', {
    provider,
    accountId,
    oldFingerprint: fingerprint(current.refreshToken),
  })
  const next = await refreshTokens(current.refreshToken)
  await persistTokens(provider, accountId, next)
  cache.set(cacheKey(provider, accountId), next)
  log.info('oauth tokens refreshed', {
    provider,
    accountId,
    newFingerprint: fingerprint(next.refreshToken),
    expiresAt: next.expiresAt,
  })
  return next
}

// `minLifetimeMs` is how much life the CALLER needs the token to still have.
// A caller that can re-resolve mid-flight is fine with the small default; one
// that freezes the token for a whole turn (the Claude SDK path hands it to a
// subprocess via env and cannot swap it afterwards) must ask for more, or a long
// turn will die on a 401 it has no way to recover from.
export async function ensureFreshAccessToken(
  provider: ProviderName,
  accountId: string,
  minLifetimeMs: number = REFRESH_BUFFER_MS,
): Promise<OAuthTokens> {
  if (provider !== 'anthropic') {
    throw new Error(`Token refresh not supported for provider: ${provider}`)
  }
  const key = cacheKey(provider, accountId)
  let tokens = cache.get(key)
  if (!tokens) {
    const data = await loadCredentials()
    const record = findAccount(data, provider, accountId)
    if (!record || !record.oauth) {
      throw new Error(`OAuth tokens missing for ${provider}/${accountId}`)
    }
    tokens = record.oauth
    cache.set(key, tokens)
  }
  if (!needsRefresh(tokens, minLifetimeMs)) return tokens

  const pending = inflight.get(key)
  if (pending) return pending

  const job = performRefresh(provider, accountId, tokens).finally(() => {
    inflight.delete(key)
  })
  inflight.set(key, job)
  return job
}

// Force a refresh regardless of expiry (e.g. after a 401 from the API).
export async function forceRefresh(
  provider: ProviderName,
  accountId: string,
): Promise<OAuthTokens> {
  if (provider !== 'anthropic') {
    throw new Error(`Token refresh not supported for provider: ${provider}`)
  }
  const key = cacheKey(provider, accountId)
  const pending = inflight.get(key)
  if (pending) return pending

  const data = await loadCredentials()
  const record = findAccount(data, provider, accountId)
  if (!record || !record.oauth) {
    throw new Error(`OAuth tokens missing for ${provider}/${accountId}`)
  }
  const job = performRefresh(provider, accountId, record.oauth).finally(() => {
    inflight.delete(key)
  })
  inflight.set(key, job)
  return job
}

export function invalidateCache(provider: ProviderName, accountId: string): void {
  cache.delete(cacheKey(provider, accountId))
}
