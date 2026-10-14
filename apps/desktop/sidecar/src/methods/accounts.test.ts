import { z } from 'zod'
import { completeSimple } from '@earendil-works/pi-ai/compat'
import { register, RpcError } from '../transport/rpc.js'
import { codexSubscriptionModelIds } from '../auth/openai-codex-oauth.js'
import { findAccount, loadCredentials } from '../credentials/store.js'
import { ensureFreshAccessToken } from '../credentials/token-manager.js'
import { resolveCredential } from '../credentials/credential-resolver.js'
import { normalizeAnthropicBaseURL, validateCustomEndpoint } from '../credentials/endpoint-guard.js'
import { complete } from '../runtime/complete.js'
import { resolveModel } from '../runtime/model-resolver.js'
import { log } from '../util/logger.js'
import type { AccountRecord, EndpointApi, ProviderName, SessionSettings } from '../types/shared.js'

const Params = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  accountId: z.string().min(1),
})

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

type TestResult = { ok: true; expiresAt?: number } | { ok: false; error: TestErrorPayload }

// ─── OAuth (subscription) ────────────────────────────────────────────────────

async function testViaClaude(record: AccountRecord): Promise<TestResult> {
  let modelId = DEFAULT_PING_MODEL
  if (record.baseURL) {
    // Same transform the runtime applies, so test + runtime hit the identical URL.
    const baseURL = normalizeAnthropicBaseURL(record.baseURL)
    try {
      validateCustomEndpoint(baseURL)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'INVALID_ENDPOINT', message } }
    }
    // A custom endpoint won't know the Anthropic model ids — ping with the
    // first model the user configured for it.
    const [first] = record.models ?? []
    if (!first) {
      return {
        ok: false,
        error: {
          code: 'NO_MODEL',
          message: 'No model configured for endpoint',
        },
      }
    }
    modelId = first
  } else if (record.authMode !== 'oauth' && !record.apiKey) {
    return {
      ok: false,
      error: { code: 'NOT_SUPPORTED', message: 'Account has no api key' },
    }
  }

  try {
    await complete({
      provider: 'anthropic',
      accountId: record.id,
      modelId,
      systemPrompt: 'Reply with one word.',
      prompt: 'hi',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof RpcError && err.code === -32020) {
      return { ok: false, error: { code: 'AUTH_EXPIRED', message } }
    }
    // 404 on a custom endpoint almost always means it doesn't serve the Anthropic
    // Messages API at <base>/v1/messages (wrong base URL, or an OpenAI-only API).
    const hint =
      record.baseURL && /\b404\b/.test(message)
        ? ' — endpoint must speak the Anthropic Messages API at <base>/v1/messages (enter the base URL without a trailing /v1; OpenAI-compatible endpoints are not supported yet)'
        : ''
    return {
      ok: false,
      error: { code: 'TEST_FAILED', message: `${message}${hint}` },
    }
  }

  if (record.authMode === 'oauth') {
    // complete() refreshed the token if needed; read the (possibly new) expiry.
    const tokens = await ensureFreshAccessToken('anthropic', record.id)
    return { ok: true, expiresAt: tokens.expiresAt }
  }
  return { ok: true }
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
      result = await testViaClaude(record)
    }
  } else if (params.provider === 'anthropic' && (!record.baseURL || record.api !== 'openai-completions')) {
    // Built-in Anthropic key, or a custom Anthropic-compatible endpoint (api
    // undefined ⇒ anthropic-messages for an anthropic account): Claude Agent SDK.
    result = await testViaClaude(record)
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
