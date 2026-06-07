// Resolve an AWOG {provider, accountId, modelId} + AccountRecord into a Pi
// `Model<Api>` plus a `getApiKey` closure that re-resolves the credential fresh
// on every turn (correct for short-lived OAuth tokens).
//
// Three shapes (ADR 0029 Phase C3 — multi-provider):
//   - Built-in Anthropic: getModel('anthropic', id) after AWOG alias + 1M-beta
//     rewrite. OAuth or API key.
//   - Built-in OpenAI / Google: getModel(provider, id) from Pi's catalog. API
//     key only.
//   - Custom endpoint (account.baseURL set): build a custom Pi Model pointing at
//     that base URL. `api` = account.api ?? (anthropic → anthropic-messages,
//     else openai-completions). These expose their own model ids that are NOT in
//     Pi's catalog, so we cannot use getModel for them.

import { getModel, type Api, type Model } from '@earendil-works/pi-ai'
import { RpcError } from '../transport/rpc.js'
import { resolveCredential } from '../credentials/credential-resolver.js'
import {
  isAnthropicModel,
  normalizeModelId,
  resolveModelRequest,
} from '../providers/anthropic/models-map.js'
import { log } from '../util/logger.js'
import type { AccountRecord, EndpointApi, SessionSettings } from '../types/shared.js'

// Conservative fallbacks for a custom endpoint's Model object. The endpoint's
// real provider enforces its own limits; these are generous defaults.
const CUSTOM_CONTEXT_WINDOW = 200_000
const CUSTOM_MAX_TOKENS = 8_192

export interface ResolvedModel {
  model: Model<Api>
  // Re-resolves the credential each turn. NEVER throws — on failure it logs (no
  // token) and returns undefined so the agent loop can surface a clean auth
  // error from the provider instead of crashing (AgentLoopConfig.getApiKey).
  getApiKey: (provider: string) => Promise<string | undefined>
}

// Infer the wire protocol for a custom endpoint when the user did not pick one.
// Anthropic → Messages API; everything else → OpenAI Chat Completions.
function inferApi(provider: SessionSettings['provider'], explicit: EndpointApi | undefined): EndpointApi {
  return explicit ?? (provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions')
}

// Build a custom Pi Model for a user-supplied endpoint. The model id is passed
// through verbatim (settings.modelId). reasoning:false → thinking degrades off
// (custom endpoints don't advertise a reasoning capability). For openai-
// completions Pi auto-detects compat from the baseUrl, so `compat` is left
// unset.
function buildCustomModel(
  modelId: string,
  baseURL: string,
  api: EndpointApi,
  provider: SessionSettings['provider'],
): Model<Api> {
  return {
    id: modelId,
    name: modelId,
    api,
    provider,
    baseUrl: baseURL,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: CUSTOM_CONTEXT_WINDOW,
    maxTokens: CUSTOM_MAX_TOKENS,
  }
}

// Resolve the built-in Anthropic Model from Pi's catalog. AWOG ids map 1:1 to
// Pi catalog ids after alias normalisation + the 1M rewrite.
function buildAnthropicModel(modelId: string): Model<Api> {
  const normalized = normalizeModelId(modelId)
  const { model: apiModel, betas } = resolveModelRequest(normalized)
  let model: Model<Api>
  try {
    // getModel is typed against the literal catalog keys; apiModel is a runtime
    // string already validated via isAnthropicModel upstream. Cast at the
    // boundary — getModel throws if the id is genuinely unknown to Pi.
    model = getModel('anthropic', apiModel as never) as Model<Api>
  } catch {
    throw new RpcError(-32015, `unknown anthropic model: ${modelId}`)
  }
  // Apply the 1M-context beta via model.headers (Pi has no betas field). Clone
  // so we never mutate Pi's cached catalog object.
  if (betas && betas.length) {
    return {
      ...model,
      headers: { ...(model.headers ?? {}), 'anthropic-beta': betas.join(',') },
    }
  }
  return model
}

// Resolve a built-in OpenAI / Google Model from Pi's catalog. The id must exist
// in getModels(provider) (the UI catalog is reconciled to real Pi ids).
function buildCatalogModel(provider: 'openai' | 'google', modelId: string): Model<Api> {
  try {
    return getModel(provider, modelId as never) as Model<Api>
  } catch {
    throw new RpcError(-32015, `unknown ${provider} model: ${modelId}`)
  }
}

// Pi provider id for the ChatGPT Plus/Pro subscription path (api 'openai-codex-
// responses'). An OAuth OpenAI account resolves its model here instead of the
// pay-as-you-go OpenAI completions catalog (ADR 0029). The bearer token comes
// from credential-resolver's codex branch (getOAuthApiKey).
const OPENAI_CODEX_PROVIDER_ID = 'openai-codex'

// Resolve a ChatGPT subscription (Codex) Model from Pi's catalog. Ids come from
// getModels('openai-codex') (e.g. gpt-5.5, gpt-5.4); the API-key-only ones (e.g.
// gpt-5.3-codex-spark) are filtered out of account.models before reaching the UI
// (see codexSubscriptionModelIds), so the picker only surfaces usable models.
function buildCodexModel(modelId: string): Model<Api> {
  try {
    return getModel(OPENAI_CODEX_PROVIDER_ID, modelId as never) as Model<Api>
  } catch {
    throw new RpcError(-32015, `unknown ChatGPT subscription model: ${modelId}`)
  }
}

// Whether an OpenAI account uses the ChatGPT subscription (Codex) OAuth path
// rather than a pay-as-you-go API key.
function isCodexAccount(provider: SessionSettings['provider'], account: AccountRecord): boolean {
  return provider === 'openai' && account.authMode === 'oauth' && !!account.piOAuth
}

export function resolveModel(settings: SessionSettings, account: AccountRecord): ResolvedModel {
  let model: Model<Api>
  if (account.baseURL) {
    // Custom endpoint: trust the user-supplied model id; no catalog lookup.
    const api = inferApi(settings.provider, account.api)
    model = buildCustomModel(settings.modelId, account.baseURL, api, settings.provider)
  } else if (isCodexAccount(settings.provider, account)) {
    // ChatGPT Plus/Pro subscription: resolve from the openai-codex catalog. The
    // bearer token is supplied per-turn by getApiKey (codex branch below).
    model = buildCodexModel(settings.modelId)
  } else if (settings.provider === 'anthropic') {
    if (!isAnthropicModel(normalizeModelId(settings.modelId))) {
      throw new RpcError(-32015, `unknown anthropic model: ${settings.modelId}`)
    }
    model = buildAnthropicModel(settings.modelId)
  } else {
    model = buildCatalogModel(settings.provider, settings.modelId)
  }

  // Refresh the credential per turn. OAuth tokens are short-lived; re-resolving
  // here (vs caching the first token) means a long tool-execution phase can
  // still get a fresh token on the next provider request.
  const getApiKey = async (): Promise<string | undefined> => {
    try {
      const resolved = await resolveCredential(settings.provider, settings.accountId)
      return resolved.cred.kind === 'oauth' ? resolved.cred.accessToken : resolved.cred.apiKey
    } catch (err) {
      // Contract: getApiKey must NOT throw. Log (no token) + return undefined.
      log.warn('runtime getApiKey refresh failed', {
        provider: settings.provider,
        err: err instanceof Error ? err.message : String(err),
      })
      return undefined
    }
  }

  return { model, getApiKey }
}
