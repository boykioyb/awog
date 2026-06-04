import { RpcError } from '../transport/rpc.js'
import type { OAuthTokens } from '../types/shared.js'

export const ANTHROPIC_OAUTH = {
  AUTH_URL: 'https://claude.ai/oauth/authorize',
  TOKEN_URL: 'https://platform.claude.com/v1/oauth/token',
  REDIRECT_URI: 'https://console.anthropic.com/oauth/code/callback',
  CLIENT_ID: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  SCOPES: 'org:create_api_key user:profile user:inference',
} as const

export const ANTHROPIC_API_HEADERS = {
  ANTHROPIC_VERSION: '2023-06-01',
  ANTHROPIC_BETA_OAUTH: 'oauth-2025-04-20',
} as const

// Token endpoint rejects requests without this exact User-Agent (429 otherwise).
export const REQUIRED_HEADERS = {
  'User-Agent': 'claude-cli/1.0.0 (external, cli)',
  Accept: 'application/json',
} as const

export interface AnthropicTokenResponse {
  token_type: string
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
  token_uuid?: string
  organization?: { uuid: string; name: string }
  account?: { uuid: string; email_address: string }
}

export function buildAuthorizeUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ANTHROPIC_OAUTH.CLIENT_ID,
    redirect_uri: ANTHROPIC_OAUTH.REDIRECT_URI,
    scope: ANTHROPIC_OAUTH.SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${ANTHROPIC_OAUTH.AUTH_URL}?${params.toString()}`
}

function mapAnthropicErrorCode(status: number, errorType?: string): string {
  if (errorType === 'invalid_grant') return 'code_invalid'
  if (errorType === 'invalid_request') return 'code_invalid'
  if (status === 401 || status === 403) return 'code_invalid'
  if (status === 410) return 'code_expired'
  return 'token_exchange_failed'
}

interface AnthropicErrorBody {
  error?: string
  error_description?: string
  type?: string
  message?: string
}

async function postToken(body: Record<string, string>): Promise<AnthropicTokenResponse> {
  const res = await fetch(ANTHROPIC_OAUTH.TOKEN_URL, {
    method: 'POST',
    headers: {
      ...REQUIRED_HEADERS,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    let parsed: AnthropicErrorBody | undefined
    try {
      parsed = JSON.parse(text) as AnthropicErrorBody
    } catch {
      parsed = undefined
    }
    const errorType = parsed?.error ?? parsed?.type
    const code = mapAnthropicErrorCode(res.status, errorType)
    const detail = parsed?.error_description ?? parsed?.message ?? text.slice(0, 200)
    throw new RpcError(-32002, `${code}: ${detail}`, { status: res.status })
  }

  return (await res.json()) as AnthropicTokenResponse
}

export async function exchangeCode(
  code: string,
  codeVerifier: string,
  state: string,
): Promise<AnthropicTokenResponse> {
  // Anthropic's token endpoint requires `state` echoed back in the body
  // (verified empirically in M0; rejects "Invalid request format" otherwise).
  return postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: ANTHROPIC_OAUTH.REDIRECT_URI,
    client_id: ANTHROPIC_OAUTH.CLIENT_ID,
    code_verifier: codeVerifier,
    state,
  })
}

export async function refreshTokens(refreshToken: string): Promise<OAuthTokens> {
  const res = await postToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: ANTHROPIC_OAUTH.CLIENT_ID,
  })
  const tokens: OAuthTokens = {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    expiresAt: Date.now() + res.expires_in * 1000,
  }
  if (res.scope) tokens.scope = res.scope
  if (res.token_uuid) tokens.tokenUuid = res.token_uuid
  return tokens
}
