import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadCredentials, saveCredentials, toSafe } from '../credentials/store.js'
import { normalizeAnthropicBaseURL, validateCustomEndpoint } from '../credentials/endpoint-guard.js'
import { log } from '../util/logger.js'
import type { AccountRecord, EndpointApi } from '../types/shared.js'

// Edit an existing connection (ADR 0026 / ADR 0029). Counterpart to
// accounts.addApiKey — the credential store had add/remove/setActive/test but no
// update, so connections couldn't be edited for any provider.
//
// SECURITY — mass-assignment guard (invariant #1 + workspace trust): the patch is
// L1 (UI input). The account "kind" is decided from the EXISTING record, NEVER
// from the patch, and the next record is built by EXPLICIT field copy per kind.
// Fields the patch must never influence (authMode, oauth, piOAuth, id, version,
// createdAt, organization, account) are simply not read. In particular a patch
// cannot introduce/remove `baseURL` to flip a built-in key into a custom endpoint
// (or vice-versa). The apiKey is rotated only on a non-empty value and is never
// logged.
const Params = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  accountId: z.string().min(1),
  patch: z.object({
    label: z.string().trim().min(1).optional(),
    // No min(1): an empty/whitespace value means "keep the current key", so the
    // handler treats blank as a no-op rather than rejecting or overwriting.
    apiKey: z.string().optional(),
    baseURL: z.string().trim().min(1).optional(),
    api: z.enum(['anthropic-messages', 'openai-completions']).optional(),
    models: z.array(z.string().trim().min(1)).optional(),
  }),
})

type Patch = z.infer<typeof Params>['patch']
type AccountKind = 'oauth' | 'custom' | 'builtin-key'

// Kind is derived from the stored record, not the patch (see the mass-assignment
// note above). Custom endpoints are apikey accounts carrying a baseURL.
function accountKind(record: AccountRecord): AccountKind {
  if (record.authMode === 'oauth') return 'oauth'
  return record.baseURL ? 'custom' : 'builtin-key'
}

// Mirror accounts.addApiKey's branch: anthropic-messages strips a trailing /v1
// (Pi appends /v1/messages); openai-completions passes through (base ends in /v1,
// Pi appends /chat/completions). Resolve the EFFECTIVE api from the patch first so
// changing api + baseURL together normalizes under the new protocol.
function resolveCustomBaseURL(record: AccountRecord, patch: Patch): { baseURL: string; api: EndpointApi } {
  const api: EndpointApi = patch.api ?? record.api ?? 'anthropic-messages'
  const raw = (patch.baseURL ?? record.baseURL ?? '').trim()
  const baseURL = api === 'anthropic-messages' ? normalizeAnthropicBaseURL(raw) : raw
  validateCustomEndpoint(baseURL)
  return { baseURL, api }
}

register('accounts.update', async (raw) => {
  const params = Params.parse(raw)
  const { patch } = params

  const data = await loadCredentials()
  const bucket = data.providers[params.provider]
  const index = bucket.accounts.findIndex((a) => a.id === params.accountId)
  if (index < 0) {
    throw new RpcError(-32004, `Account not found: ${params.provider}/${params.accountId}`)
  }
  const record = bucket.accounts[index]!
  const kind = accountKind(record)
  const fieldsChanged: string[] = []

  // Start from the existing record; apply only the fields legal for this kind.
  const next: AccountRecord = { ...record }

  if (patch.label !== undefined && patch.label !== record.label) {
    next.label = patch.label
    fieldsChanged.push('label')
  }

  // apiKey rotation — apikey accounts only, and only on a real (non-empty) value.
  if (kind !== 'oauth') {
    const trimmedKey = patch.apiKey?.trim()
    if (trimmedKey) {
      next.apiKey = trimmedKey
      fieldsChanged.push('apiKey')
    }
  }

  if (kind === 'custom') {
    // Re-validate/normalize the endpoint when baseURL or api changed.
    if (patch.baseURL !== undefined || patch.api !== undefined) {
      const resolved = resolveCustomBaseURL(record, patch)
      if (resolved.baseURL !== record.baseURL) {
        next.baseURL = resolved.baseURL
        fieldsChanged.push('baseURL')
      }
      if (resolved.api !== record.api) {
        next.api = resolved.api
        fieldsChanged.push('api')
      }
    }
    if (patch.models !== undefined) {
      const models = patch.models.map((m) => m.trim()).filter(Boolean)
      // A custom endpoint with no models can't be tested and exposes nothing in
      // the picker — reject, mirroring the add-time "models required" stance.
      if (!models.length) {
        throw new RpcError(-32602, 'A custom endpoint needs at least one model id')
      }
      next.models = models
      fieldsChanged.push('models')
    }
  } else if (kind === 'builtin-key') {
    // Curate the built-in model list. Empty clears the override so the picker
    // falls back to the catalog (toSafe omits an empty list).
    if (patch.models !== undefined) {
      const models = patch.models.map((m) => m.trim()).filter(Boolean)
      if (models.length) next.models = models
      else delete next.models
      fieldsChanged.push('models')
    }
  }
  // kind === 'oauth': label only (handled above). models/apiKey/baseURL are
  // structurally ignored — codex models stay auto-derived, token stays managed.

  if (!fieldsChanged.length) {
    // Nothing to change — return the current safe view without a needless write.
    return toSafe(record)
  }

  next.version = record.version + 1
  bucket.accounts[index] = next
  await saveCredentials(data)

  log.info('account updated', {
    provider: params.provider,
    accountId: params.accountId,
    kind,
    fieldsChanged,
    custom: !!next.baseURL,
    api: next.api ?? null,
  })

  return toSafe(next)
})
