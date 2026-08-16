// OpenAI Codex (ChatGPT Plus/Pro subscription) OAuth — thin seam over pi's
// browser (loopback) flow (ADR 0029). Mirrors auth/anthropic-oauth.ts but
// delegates the actual protocol to @earendil-works/pi-ai/oauth, which owns the
// PKCE handshake, the localhost callback server, and token exchange. We only:
//   - run the login and surface the authorize URL to the UI (it opens it),
//   - refresh + resolve the bearer token at request time via getOAuthApiKey.
//
// Why browser, not device-code: OpenAI gates the device-code path behind a
// per-account "device code authentication" toggle in ChatGPT security settings;
// the browser/loopback flow (the default `codex login`) needs no such toggle.
//
// The credential blob pi returns (OAuthCredentials) is stored VERBATIM as
// AccountRecord.piOAuth — it carries provider extras (chatgpt_account_id, etc.)
// pi needs. SECRET — never logged, never sent to the UI.

import { getModels } from '@earendil-works/pi-ai/compat'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import type { Api, Model, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai'
import type { OAuthAuthInfo } from '@earendil-works/pi-ai/oauth'
import type { PiOAuthCredentials } from '../types/shared.js'

// pi 0.84 replaced the free `loginOpenAICodex`/`getOAuthApiKey` helpers with a
// per-provider `OAuthAuth` object (login/refresh/toAuth) reachable through the
// provider factory. We use just that object — NOT pi's `Models` collection —
// because AWOG owns credential storage (multi-account per provider, which pi's
// one-credential-per-provider CredentialStore can't express).
function codexOAuth(): OAuthAuth {
  const oauth = openaiCodexProvider().auth.oauth
  if (!oauth) throw new Error('pi openai-codex provider exposes no OAuth auth')
  return oauth
}

// pi's login prompts for a method first; AWOG only ever runs the browser
// (loopback) flow, so we answer that select with 'browser'. Value mirrors pi's
// OPENAI_CODEX_BROWSER_LOGIN_METHOD (auth/oauth/openai-codex.ts).
const BROWSER_LOGIN_METHOD = 'browser'

// Refresh margin — treat a token expiring within this window as expired so a
// long turn doesn't start with a credential that dies mid-request.
const REFRESH_MARGIN_MS = 60_000

// Pi provider id for the ChatGPT subscription path (verified via
// getOAuthProvider/getModels — models live under api 'openai-codex-responses').
export const OPENAI_CODEX_PROVIDER_ID = 'openai-codex'

// Models pi lists under 'openai-codex' that OpenAI rejects on a ChatGPT
// subscription (those models are API-key billing only). Verified at runtime:
//   "The 'gpt-5.3-codex-spark' model is not supported when using Codex with a
//    ChatGPT account."
// Applied on the READ path (toSafe + accounts.test) so the model picker never
// offers an unusable model and existing connected accounts self-heal without
// reconnecting. Update this set if OpenAI changes the gating.
const CODEX_API_ONLY_MODEL_IDS = new Set<string>(['gpt-5.3-codex-spark'])

// Keep only the codex models usable with a ChatGPT subscription, preserving the
// catalog order. Input is the raw `getModels('openai-codex')` id list.
export function codexSubscriptionModelIds(ids: readonly string[]): string[] {
  return ids.filter((id) => !CODEX_API_ONLY_MODEL_IDS.has(id))
}

// All codex models usable on a ChatGPT subscription (full catalog minus the
// API-key-only ones). Used to seed a connection's models at sign-in and to reset
// a curated list back to "all available". Best-effort: empty on catalog failure.
export function availableCodexModelIds(): string[] {
  try {
    const models = getModels(OPENAI_CODEX_PROVIDER_ID) as readonly Model<Api>[]
    return codexSubscriptionModelIds(models.map((m) => m.id))
  } catch {
    return []
  }
}

// pi OAuthCredentials is { refresh, access, expires, [extras] } — structurally a
// Record<string, unknown> as far as AWOG storage is concerned. The two aliases
// are the same runtime shape; the cast at the boundary keeps the rest of the
// sidecar on the AWOG-local type without importing pi types everywhere.
function toStored(creds: OAuthCredential): PiOAuthCredentials {
  return creds as unknown as PiOAuthCredentials
}

function fromStored(creds: PiOAuthCredentials): OAuthCredential {
  return creds as unknown as OAuthCredential
}

// Run the browser (loopback) login. `onAuth` fires once pi has built the
// authorize URL and started its localhost callback server (127.0.0.1:1455,
// closed when login settles); the UI opens the URL and the user completes login
// in their browser, after which pi's callback captures the redirect and this
// resolves with the credential blob to persist. NEVER log the blob.
//
// pi's login drives everything through one `prompt()` lever:
//   - the `select` step picks the flow → we always answer 'browser',
//   - the `manual_code` step races the callback server → AWOG has no paste UI,
//     so it only ever REJECTS (on abort or when its own signal fires), which is
//     what makes pi cancel its wait and throw. That is the cancel path.
export async function loginCodex(
  onAuth: (info: OAuthAuthInfo) => void,
  signal: AbortSignal,
): Promise<PiOAuthCredentials> {
  const creds = await codexOAuth().login({
    signal,
    notify: (event) => {
      // Only the authorize URL is surfaced (public, no secret). Device-code and
      // progress events can't occur on the browser flow we select.
      if (event.type === 'auth_url') {
        onAuth({
          url: event.url,
          ...(event.instructions !== undefined ? { instructions: event.instructions } : {}),
        })
      }
    },
    prompt: (prompt) => {
      if (prompt.type === 'select') return Promise.resolve(BROWSER_LOGIN_METHOD)
      // manual_code (or anything else): never answered — reject on abort, and on
      // pi's own per-prompt signal when the callback server wins the race.
      return new Promise<string>((_resolve, reject) => {
        const cancel = (): void => reject(new Error('Login cancelled'))
        if (signal.aborted) return cancel()
        signal.addEventListener('abort', cancel, { once: true })
        prompt.signal?.addEventListener('abort', cancel, { once: true })
      })
    },
  })
  return toStored(creds)
}

// Resolve the bearer token for a request, auto-refreshing an expired credential.
// Returns the apiKey to send to pi PLUS the (possibly updated) credentials the
// caller must persist back to the account so the next request reuses the fresh
// refresh token. null ⇒ no usable credential. Token + blob NEVER logged.
//
// pi 0.84 moved this behind `Models.getAuth()` (refresh under a store lock).
// AWOG keeps its own storage, so we run the same two steps directly: refresh
// when the token is at/near expiry, then derive the request auth via toAuth.
export async function resolveCodexApiKey(
  creds: PiOAuthCredentials,
): Promise<{ apiKey: string; newCredentials: PiOAuthCredentials } | null> {
  const oauth = codexOAuth()
  let credential = fromStored(creds)
  if (!credential.refresh || !credential.access) return null
  if (credential.expires <= Date.now() + REFRESH_MARGIN_MS) {
    credential = await oauth.refresh(credential, AbortSignal.timeout(30_000))
  }
  const auth = await oauth.toAuth(credential)
  if (!auth.apiKey) return null
  return { apiKey: auth.apiKey, newCredentials: toStored(credential) }
}
