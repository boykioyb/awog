import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { ANTHROPIC_API_HEADERS, REQUIRED_HEADERS } from '../auth/anthropic-oauth.js'
import { findAccount, loadCredentials } from '../credentials/store.js'
import { ensureFreshAccessToken, forceRefresh } from '../credentials/token-manager.js'
import { log } from '../util/logger.js'
import type { OAuthTokens, ProviderName } from '../types/shared.js'

const Params = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  accountId: z.string().min(1),
})

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

interface TestErrorPayload {
  code: string
  message: string
}

type TestResult =
  | { ok: true; expiresAt: number }
  | { ok: false; error: TestErrorPayload }

async function pingMessages(tokens: OAuthTokens): Promise<Response> {
  return fetch(MESSAGES_URL, {
    method: 'POST',
    headers: {
      ...REQUIRED_HEADERS,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens.accessToken}`,
      'anthropic-version': ANTHROPIC_API_HEADERS.ANTHROPIC_VERSION,
      'anthropic-beta': ANTHROPIC_API_HEADERS.ANTHROPIC_BETA_OAUTH,
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
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

async function testAnthropic(provider: ProviderName, accountId: string): Promise<TestResult> {
  let tokens: OAuthTokens
  try {
    tokens = await ensureFreshAccessToken(provider, accountId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'AUTH_EXPIRED', message } }
  }

  let res = await pingMessages(tokens)
  if (res.status === 401) {
    try {
      tokens = await forceRefresh(provider, accountId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'AUTH_EXPIRED', message } }
    }
    res = await pingMessages(tokens)
    if (res.status === 401) {
      return {
        ok: false,
        error: { code: 'AUTH_EXPIRED', message: 'Unauthorized after refresh' },
      }
    }
  }

  if (res.ok) return { ok: true, expiresAt: tokens.expiresAt }

  const snippet = await bodySnippet(res)
  return {
    ok: false,
    error: { code: 'TEST_FAILED', message: `HTTP ${res.status}: ${snippet}` },
  }
}

register('accounts.test', async (raw) => {
  const params = Params.parse(raw)
  const data = await loadCredentials()
  const record = findAccount(data, params.provider, params.accountId)
  if (!record) {
    return {
      ok: false,
      error: { code: 'NOT_FOUND', message: `Account not found: ${params.accountId}` },
    }
  }
  if (params.provider !== 'anthropic') {
    return {
      ok: false,
      error: { code: 'NOT_SUPPORTED', message: `Test not implemented for ${params.provider}` },
    }
  }
  if (record.authMode !== 'oauth' || !record.oauth) {
    return {
      ok: false,
      error: { code: 'NOT_SUPPORTED', message: 'Only OAuth accounts are testable for now' },
    }
  }

  const result = await testAnthropic(params.provider, params.accountId)
  log.info('account test', {
    provider: params.provider,
    accountId: params.accountId,
    ok: result.ok,
  })
  return result
})
