import { z } from 'zod'
import { completeSimple } from '@earendil-works/pi-ai/compat'
import { register } from '../transport/rpc.js'
import { ANTHROPIC_API_HEADERS, REQUIRED_HEADERS } from '../auth/anthropic-oauth.js'
import { codexSubscriptionModelIds } from '../auth/openai-codex-oauth.js'
import { findAccount, loadCredentials } from '../credentials/store.js'
import { ensureFreshAccessToken, forceRefresh } from '../credentials/token-manager.js'
import { resolveCredential } from '../credentials/credential-resolver.js'
import { normalizeAnthropicBaseURL, validateCustomEndpoint } from '../credentials/endpoint-guard.js'
import { resolveModel } from '../runtime/model-resolver.js'
import { log } from '../util/logger.js'
import type {
  AccountRecord,
  EndpointApi,
  OAuthTokens,
  ProviderName,
  SessionSettings,
} from '../types/shared.js'

const Params = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  accountId: z.string().min(1),
})

const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const DEFAULT_PING_MODEL = 'claude-haiku-4-5'

// Cheapest catalog model to ping per provider for a built-in API-key test (a
// 1-token completion). Verified against pi getModels(provider).
const PING_MODEL: Record<'openai' | 'google', string> = {
  openai: 'gpt-4.1-nano',
  google: 'gemini-2.0-flash-lite',
}

interface TestErrorPayload {
  code: string
  message: string
}

type TestResult =
  | { ok: true; expiresAt?: number }
  | { ok: false; error: TestErrorPayload }

// ─── OAuth (subscription) ────────────────────────────────────────────────────

async function pingMessagesOAuth(tokens: OAuthTokens): Promise<Response> {
  return fetch(`${DEFAULT_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      ...REQUIRED_HEADERS,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens.accessToken}`,
      'anthropic-version': ANTHROPIC_API_HEADERS.ANTHROPIC_VERSION,
      'anthropic-beta': ANTHROPIC_API_HEADERS.ANTHROPIC_BETA_OAUTH,
    },
    body: JSON.stringify({
      model: DEFAULT_PING_MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  })
}

async function bodySnippet(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text.slice(0, 200)
  } catch {
    return ''
  }
}

async function testOAuth(provider: ProviderName, accountId: string): Promise<TestResult> {
  let tokens: OAuthTokens
  try {
    tokens = await ensureFreshAccessToken(provider, accountId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'AUTH_EXPIRED', message } }
  }

  let res = await pingMessagesOAuth(tokens)
  if (res.status === 401) {
    try {
      tokens = await forceRefresh(provider, accountId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'AUTH_EXPIRED', message } }
    }
    res = await pingMessagesOAuth(tokens)
    if (res.status === 401) {
      return { ok: false, error: { code: 'AUTH_EXPIRED', message: 'Unauthorized after refresh' } }
    }
  }

  if (res.ok) return { ok: true, expiresAt: tokens.expiresAt }

  const snippet = await bodySnippet(res)
  return { ok: false, error: { code: 'TEST_FAILED', message: `HTTP ${res.status}: ${snippet}` } }
}

// ─── API key (built-in Anthropic key OR custom Anthropic-compatible endpoint) ──

async function testApiKey(record: AccountRecord): Promise<TestResult> {
  if (!record.apiKey) {
    return { ok: false, error: { code: 'NOT_SUPPORTED', message: 'Account has no api key' } }
  }

  let baseURL = DEFAULT_BASE_URL
  let model = DEFAULT_PING_MODEL
  const isCustom = !!record.baseURL
  if (record.baseURL) {
    // Normalize (strip trailing /v1) then validate — same transform the runtime
    // applies, so test + runtime hit the identical URL.
    baseURL = normalizeAnthropicBaseURL(record.baseURL)
    try {
      validateCustomEndpoint(baseURL)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'INVALID_ENDPOINT', message } }
    }
    // A custom endpoint won't know the Anthropic model ids — ping with the
    // first model the user configured for it.
    if (!record.models?.length) {
      return { ok: false, error: { code: 'NO_MODEL', message: 'No model configured for endpoint' } }
    }
    model = record.models[0]
  }

  let res: Response
  try {
    res = await fetch(`${baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        ...REQUIRED_HEADERS,
        'Content-Type': 'application/json',
        'x-api-key': record.apiKey,
        'anthropic-version': ANTHROPIC_API_HEADERS.ANTHROPIC_VERSION,
      },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'NETWORK', message } }
  }

  if (res.ok) return { ok: true }

  const snippet = await bodySnippet(res)
  // 404 on a custom endpoint almost always means it doesn't serve the Anthropic
  // Messages API at <base>/v1/messages (wrong base URL, or an OpenAI-only API).
  const hint =
    isCustom && res.status === 404
      ? ' — endpoint must speak the Anthropic Messages API at <base>/v1/messages (enter the base URL without a trailing /v1; OpenAI-compatible endpoints are not supported yet)'
      : ''
  return { ok: false, error: { code: 'TEST_FAILED', message: `HTTP ${res.status}: ${snippet}${hint}` } }
}

// ─── Pi-based test (OpenAI / Google built-in + any custom endpoint) ──────────
// A minimal one-token completion through the Pi runtime exercises the exact path
// the chat/task runtime uses, so a green test means the real model id + key +
// base URL all line up. Covers built-in openai/google AND custom endpoints of
// either wire protocol (anthropic-messages / openai-completions).

const PI_TEST_MAX_TOKENS = 4

function pingModelFor(provider: ProviderName, record: AccountRecord): string {
  if (record.baseURL) {
    // Custom endpoint: ping the first configured model (the endpoint doesn't
    // know catalog ids).
    return record.models?.[0] ?? ''
  }
  if (provider === 'openai' || provider === 'google') return PING_MODEL[provider]
  // anthropic built-in is handled by testApiKey; this path is non-anthropic.
  return DEFAULT_PING_MODEL
}

async function testViaPi(provider: ProviderName, record: AccountRecord): Promise<TestResult> {
  if (!record.apiKey) {
    return { ok: false, error: { code: 'NOT_SUPPORTED', message: 'Account has no api key' } }
  }
  if (record.baseURL && !record.models?.length) {
    return { ok: false, error: { code: 'NO_MODEL', message: 'No model configured for endpoint' } }
  }
  if (record.baseURL) {
    try {
      validateCustomEndpoint(record.baseURL)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'INVALID_ENDPOINT', message } }
    }
  }

  const modelId = pingModelFor(provider, record)
  // resolveModel builds the Pi Model (catalog lookup or custom) + does the same
  // baseURL/api normalization the runtime uses, so the test hits the identical
  // endpoint. level/mode are irrelevant for a 1-token ping.
  const settings: SessionSettings = { provider, modelId, level: 'low', mode: 'ask' }
  let model: ReturnType<typeof resolveModel>['model']
  try {
    model = resolveModel(settings, record).model
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'TEST_FAILED', message } }
  }

  try {
    const result = await completeSimple(
      model,
      { messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }] },
      { apiKey: record.apiKey, maxTokens: PI_TEST_MAX_TOKENS },
    )
    if (result.stopReason === 'error') {
      const api: EndpointApi | undefined = record.baseURL
        ? (record.api ?? (provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions'))
        : undefined
      const hint =
        record.baseURL && api === 'openai-completions'
          ? ' — endpoint must speak the OpenAI Chat Completions API at <base>/chat/completions (base URL usually ends in /v1)'
          : ''
      return {
        ok: false,
        error: { code: 'TEST_FAILED', message: `${result.errorMessage ?? 'model error'}${hint}` },
      }
    }
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'NETWORK', message } }
  }
}

// ─── OpenAI Codex (ChatGPT subscription) OAuth ───────────────────────────────
// Resolve the bearer token via the credential-resolver codex branch (which
// refreshes + persists), then 1-token completion through the openai-codex model
// to exercise the exact runtime path. Token never logged.

async function testCodex(accountId: string): Promise<TestResult> {
  let resolved: Awaited<ReturnType<typeof resolveCredential>>
  try {
    resolved = await resolveCredential('openai', accountId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'AUTH_EXPIRED', message } }
  }
  if (resolved.cred.kind !== 'apikey') {
    return { ok: false, error: { code: 'NOT_SUPPORTED', message: 'Account is not a Codex subscription' } }
  }

  // Ping a subscription-eligible model: account.models is the raw catalog list,
  // which includes API-key-only ids (e.g. gpt-5.3-codex-spark) OpenAI rejects on
  // a ChatGPT account — filter them out before picking one.
  const modelId = codexSubscriptionModelIds(resolved.account.models ?? [])[0]
  if (!modelId) {
    return { ok: false, error: { code: 'NO_MODEL', message: 'No subscription model available' } }
  }
  const settings: SessionSettings = { provider: 'openai', modelId, level: 'low', mode: 'ask' }
  let model: ReturnType<typeof resolveModel>['model']
  try {
    model = resolveModel(settings, resolved.account).model
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'TEST_FAILED', message } }
  }

  try {
    const result = await completeSimple(
      model,
      { messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }] },
      { apiKey: resolved.cred.apiKey, maxTokens: PI_TEST_MAX_TOKENS },
    )
    if (result.stopReason === 'error') {
      return { ok: false, error: { code: 'TEST_FAILED', message: result.errorMessage ?? 'model error' } }
    }
    const piExpires = resolved.account.piOAuth?.expires
    return typeof piExpires === 'number' ? { ok: true, expiresAt: piExpires } : { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'NETWORK', message } }
  }
}

register('accounts.test', async (raw) => {
  const params = Params.parse(raw)
  const data = await loadCredentials()
  const record = findAccount(data, params.provider, params.accountId)
  if (!record) {
    return { ok: false, error: { code: 'NOT_FOUND', message: `Account not found: ${params.accountId}` } }
  }

  let result: TestResult
  if (record.authMode === 'oauth') {
    if (params.provider === 'openai' && record.piOAuth) {
      // ChatGPT Plus/Pro subscription (Codex OAuth).
      result = await testCodex(params.accountId)
    } else if (params.provider !== 'anthropic') {
      result = {
        ok: false,
        error: { code: 'NOT_SUPPORTED', message: `${params.provider} accounts must use an API key` },
      }
    } else if (!record.oauth) {
      result = { ok: false, error: { code: 'NOT_SUPPORTED', message: 'Account has no oauth credentials' } }
    } else {
      result = await testOAuth(params.provider, params.accountId)
    }
  } else if (params.provider === 'anthropic' && (!record.baseURL || record.api !== 'openai-completions')) {
    // Built-in Anthropic key, or a custom Anthropic-compatible endpoint (api
    // undefined ⇒ anthropic-messages for an anthropic account): direct Messages
    // API ping (unchanged, proven path).
    result = await testApiKey(record)
  } else {
    // OpenAI/Google built-in, or any custom OpenAI-compatible endpoint → Pi.
    result = await testViaPi(params.provider, record)
  }

  log.info('account test', {
    provider: params.provider,
    accountId: params.accountId,
    authMode: record.authMode,
    custom: !!record.baseURL,
    ok: result.ok,
  })
  return result
})
