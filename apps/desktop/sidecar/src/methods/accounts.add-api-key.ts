import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadCredentials, saveCredentials, toSafe } from '../credentials/store.js'
import { normalizeAnthropicBaseURL, validateCustomEndpoint } from '../credentials/endpoint-guard.js'
import { log } from '../util/logger.js'
import type { AccountRecord, EndpointApi, ProviderName } from '../types/shared.js'

// Add an API-key account (ADR 0026 Phase A/B + ADR 0029 Phase C3). Shapes:
//   - built-in key (anthropic/openai/google): { provider, apiKey } → hits the
//     provider's default endpoint.
//   - custom endpoint: { provider, apiKey, baseURL, api?, models } → hits the
//     given URL using the chosen wire protocol (api). api='anthropic-messages'
//     (default) for Anthropic-compatible; 'openai-completions' for OpenAI-
//     compatible (Ollama/vLLM/LM Studio/OpenRouter).
// The key lives only in credentials.json (chmod 0o600) and is stripped from the
// IPC response by toSafe (invariant #1 — key never leaves the sidecar).
const Params = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']).default('anthropic'),
  apiKey: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
  baseURL: z.string().trim().min(1).optional(),
  api: z.enum(['anthropic-messages', 'openai-completions']).optional(),
  models: z.array(z.string().trim().min(1)).optional(),
})

function newAccountId(): string {
  return `acc_${randomBytes(8).toString('hex')}`
}

// Infer the wire protocol when the user did not pick one: Anthropic → Messages
// API; openai/google → OpenAI Chat Completions.
function inferApi(provider: ProviderName, explicit: EndpointApi | undefined): EndpointApi {
  return explicit ?? (provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions')
}

register('accounts.addApiKey', async (raw) => {
  const params = Params.parse(raw)

  // Validate + normalize the endpoint URL. User-authored URL is L0 trust —
  // validate shape (http/https, no creds-in-URL) but deliberately allow
  // localhost (Ollama/vLLM/LM Studio). The wire protocol decides normalization:
  //   - anthropic-messages: SDK/Pi append /v1/messages → strip a trailing /v1 so
  //     the base is the root the messages API expects.
  //   - openai-completions: Pi appends /chat/completions to the base, which
  //     typically ENDS in /v1 (e.g. http://localhost:11434/v1) → pass through.
  let baseURL: string | undefined
  let api: EndpointApi | undefined
  if (params.baseURL) {
    api = inferApi(params.provider, params.api)
    const trimmed = params.baseURL.trim()
    baseURL = api === 'anthropic-messages' ? normalizeAnthropicBaseURL(trimmed) : trimmed
    validateCustomEndpoint(baseURL)
  }

  const record: AccountRecord = {
    id: newAccountId(),
    label: params.label ?? (baseURL ? 'Custom endpoint' : `${PROVIDER_LABEL[params.provider]} API key`),
    authMode: 'apikey',
    apiKey: params.apiKey,
    version: 0,
    createdAt: new Date().toISOString(),
  }
  if (baseURL) record.baseURL = baseURL
  // Persist `api` only for custom endpoints (it has no meaning for a built-in
  // provider key, which uses the catalog model's own api).
  if (baseURL && api) record.api = api
  if (params.models?.length) record.models = params.models

  const data = await loadCredentials()
  const bucket = data.providers[params.provider]
  bucket.accounts.push(record)
  if (bucket.activeAccountId === null) {
    bucket.activeAccountId = record.id
  }
  await saveCredentials(data)

  log.info('apikey account added', {
    provider: params.provider,
    accountId: record.id,
    custom: !!record.baseURL,
    api: record.api ?? null,
  })

  return toSafe(record)
})

const PROVIDER_LABEL: Record<ProviderName, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}
