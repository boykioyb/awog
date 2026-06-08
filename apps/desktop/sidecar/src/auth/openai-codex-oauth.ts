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

import { getModels } from '@earendil-works/pi-ai'
import {
  getOAuthApiKey,
  loginOpenAICodex,
  type OAuthAuthInfo,
  type OAuthCredentials,
} from '@earendil-works/pi-ai/oauth'
import type { PiOAuthCredentials } from '../types/shared.js'

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
    return codexSubscriptionModelIds(getModels(OPENAI_CODEX_PROVIDER_ID).map((m) => m.id))
  } catch {
    return []
  }
}

// pi OAuthCredentials is { refresh, access, expires, [extras] } — structurally a
// Record<string, unknown> as far as AWOG storage is concerned. The two aliases
// are the same runtime shape; the cast at the boundary keeps the rest of the
// sidecar on the AWOG-local type without importing pi types everywhere.
function toStored(creds: OAuthCredentials): PiOAuthCredentials {
  return creds as unknown as PiOAuthCredentials
}

function fromStored(creds: PiOAuthCredentials): OAuthCredentials {
  return creds as unknown as OAuthCredentials
}

// Run the browser (loopback) login. `onAuth` fires once pi has built the
// authorize URL and started its localhost callback server (127.0.0.1:1455,
// closed when login settles); the UI opens the URL and the user completes login
// in their browser, after which pi's callback captures the redirect and this
// resolves with the credential blob to persist. NEVER log the blob.
//
// pi's loginOpenAICodex takes no AbortSignal, so we adapt `signal` into the
// `onManualCodeInput` lever: AWOG never shows a manual-paste box, so that promise
// ONLY ever rejects — on abort — which makes pi cancel its wait and throw. The
// `onPrompt` fallback is defensive (e.g. port 1455 busy so no redirect arrives);
// AWOG has no paste UI, so it rejects rather than hang on a never-resolving read.
export async function loginCodex(
  onAuth: (info: OAuthAuthInfo) => void,
  signal: AbortSignal,
): Promise<PiOAuthCredentials> {
  const creds = await loginOpenAICodex({
    onAuth,
    onManualCodeInput: () =>
      new Promise<string>((_resolve, reject) => {
        if (signal.aborted) {
          reject(new Error('Login cancelled'))
          return
        }
        signal.addEventListener('abort', () => reject(new Error('Login cancelled')), {
          once: true,
        })
      }),
    onPrompt: () =>
      Promise.reject(new Error('OpenAI sign-in did not complete in the browser')),
  })
  return toStored(creds)
}

// Resolve the bearer token for a request, auto-refreshing an expired credential.
// Returns the apiKey to send to pi PLUS the (possibly updated) credentials the
// caller must persist back to the account so the next request reuses the fresh
// refresh token. null ⇒ no usable credential. Token + blob NEVER logged.
export async function resolveCodexApiKey(
  creds: PiOAuthCredentials,
): Promise<{ apiKey: string; newCredentials: PiOAuthCredentials } | null> {
  const result = await getOAuthApiKey(OPENAI_CODEX_PROVIDER_ID, {
    [OPENAI_CODEX_PROVIDER_ID]: fromStored(creds),
  })
  if (!result) return null
  return { apiKey: result.apiKey, newCredentials: toStored(result.newCredentials) }
}
