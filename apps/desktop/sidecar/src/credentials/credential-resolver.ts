// Credential resolution for the Pi runtime (ADR 0026 Phase A/B, ADR 0029).
//
// Single seam every runtime call-site goes through to obtain a usable
// credential. Replaces the resolveAccount + ensureFreshAccessToken pair that was
// duplicated across call-sites.
//
//   - OAuth accounts   → refresh via token-manager, return the access token.
//   - API-key accounts → return the stored key verbatim (+ baseURL/api for
//     custom endpoints).
//
// The Pi runtime receives the credential in-process (model-resolver →
// AgentLoopConfig.apiKey/getApiKey) — no subprocess env, no SDK.

import { RpcError } from '../transport/rpc.js'
import { findAccount, loadCredentials, saveCredentials } from './store.js'
import { normalizeAnthropicBaseURL } from './endpoint-guard.js'
import { ensureFreshAccessToken } from './token-manager.js'
import { resolveCodexApiKey } from '../auth/openai-codex-oauth.js'
import { log } from '../util/logger.js'
import type {
  AccountRecord,
  EndpointApi,
  PiOAuthCredentials,
  ProviderName,
} from '../types/shared.js'

// A resolved credential ready for the Pi runtime. `api` (ADR 0029 Phase C3) is
// the wire protocol a custom endpoint speaks; undefined ⇒ the model-resolver
// infers it from the provider. `codex` (ADR 0029 — ChatGPT subscription) flags a
// bearer token from the pi-managed OpenAI Codex OAuth flow: the runtime must
// resolve the model from the 'openai-codex' provider (api openai-codex-
// responses), not the pay-as-you-go OpenAI completions catalog.
export type Credential =
  | { kind: 'oauth'; accessToken: string }
  | { kind: 'apikey'; apiKey: string; baseURL?: string; api?: EndpointApi; codex?: boolean }

// Pick the AccountRecord for {provider, accountId} from our credentials store.
// Kept exported because account.usage.ts / accounts.test.ts need the raw record.
// All three providers are supported (ADR 0029 Phase C3); openai/google are
// apikey-only — OAuth for them is rejected at resolveCredential.
export async function resolveAccount(
  provider: ProviderName,
  accountId: string | undefined,
): Promise<AccountRecord> {
  const data = await loadCredentials()
  const bucket = data.providers[provider]
  const id = accountId ?? bucket.activeAccountId
  if (!id) throw new RpcError(-32012, 'NO_ACTIVE_ACCOUNT')
  const acc = bucket.accounts.find((a) => a.id === id)
  if (!acc) throw new RpcError(-32013, `account not found: ${id}`)
  // oauth account is usable with either AWOG anthropic tokens OR a pi-managed
  // OAuth blob (codex subscription). apikey account needs a stored key.
  const hasOauth = acc.authMode === 'oauth' && (!!acc.oauth || !!acc.piOAuth)
  const hasApiKey = acc.authMode === 'apikey' && !!acc.apiKey
  if (!hasOauth && !hasApiKey) {
    throw new RpcError(-32014, 'account has no usable credentials')
  }
  return acc
}

// Persist the refreshed pi OAuth credentials back to the account so the next
// request reuses the rotated refresh token (version++ for optimistic reads).
// Failure to persist must NOT block the request (we already have a valid token);
// log and continue. Blob never logged.
async function persistPiOAuth(
  provider: ProviderName,
  accountId: string,
  next: PiOAuthCredentials,
): Promise<void> {
  try {
    const data = await loadCredentials()
    const record = findAccount(data, provider, accountId)
    if (!record) return
    record.piOAuth = next
    record.version += 1
    await saveCredentials(data)
  } catch (err) {
    log.warn('persist pi oauth credentials failed', {
      provider,
      accountId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

// How much token life a caller that CANNOT re-resolve mid-turn must start with.
// The Claude SDK path hands the token to a subprocess through its env once per
// turn (runtime/claude-sdk/shared.ts buildSdkEnv) and has no way to swap it
// afterwards, so a turn outliving the token gets a hard 401 with nothing to
// retry. One hour comfortably covers the longest turn the SDK path allows
// (background work caps at 15 minutes) while still refreshing only about once
// per token lifetime. The Pi path does not need this — its getApiKey closure
// re-resolves on every provider request (runtime/model-resolver.ts).
export const FROZEN_TOKEN_MIN_LIFETIME_MS = 60 * 60 * 1000

// Resolve account + its usable credential in one call. OAuth accounts refresh
// their access token here; apikey accounts return the stored key (no refresh).
// `minTokenLifetimeMs` lets a caller that freezes the token demand more runway
// than the token-manager's default refresh buffer.
export async function resolveCredential(
  provider: ProviderName,
  accountId: string | undefined,
  minTokenLifetimeMs?: number,
): Promise<{ account: AccountRecord; cred: Credential }> {
  const account = await resolveAccount(provider, accountId)
  if (account.authMode === 'apikey') {
    if (!account.apiKey) throw new RpcError(-32014, 'account has no api key')
    const cred: Credential = { kind: 'apikey', apiKey: account.apiKey }
    if (account.baseURL) {
      // The wire protocol decides how the base URL is normalised. Anthropic-
      // messages endpoints want the ROOT (the SDK/Pi appends /v1/messages), so
      // strip a trailing /v1 (idempotent — older records re-add cleanly). OpenAI-
      // completions endpoints want the base WITH /v1 (Pi appends /chat/
      // completions), so pass through verbatim. `api` undefined ⇒ infer from
      // provider (anthropic → messages, else completions).
      const api: EndpointApi =
        account.api ?? (provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions')
      cred.baseURL = api === 'anthropic-messages' ? normalizeAnthropicBaseURL(account.baseURL) : account.baseURL
      cred.api = api
    }
    return { account, cred }
  }
  // OpenAI Codex subscription (ChatGPT Plus/Pro) — pi-managed OAuth (ADR 0029).
  // pi's getOAuthApiKey auto-refreshes an expired token and returns the bearer
  // apiKey + updated credentials to persist. Flag `codex` so the model-resolver
  // routes to the openai-codex provider/models, not pay-as-you-go completions.
  if (provider === 'openai' && account.piOAuth) {
    const resolved = await resolveCodexApiKey(account.piOAuth)
    if (!resolved) {
      throw new RpcError(-32020, 'AUTH_EXPIRED: reconnect ChatGPT via Settings')
    }
    // Persist the rotated credentials (fire-and-forget; never blocks the request).
    await persistPiOAuth(provider, account.id, resolved.newCredentials)
    account.piOAuth = resolved.newCredentials
    return { account, cred: { kind: 'apikey', apiKey: resolved.apiKey, codex: true } }
  }
  // Anthropic Claude Pro/Max subscription — AWOG-managed OAuth token-manager.
  if (provider !== 'anthropic') {
    throw new RpcError(-32011, `${provider} accounts must connect with an API key`)
  }
  const tokens = await ensureFreshAccessToken(provider, account.id, minTokenLifetimeMs)
  return { account, cred: { kind: 'oauth', accessToken: tokens.accessToken } }
}
