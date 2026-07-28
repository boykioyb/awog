import { z } from 'zod'
import { getModels } from '@earendil-works/pi-ai'
import { register } from '../transport/rpc.js'
import { resolveCredential } from '../credentials/credential-resolver.js'
import { ANTHROPIC_API_HEADERS, REQUIRED_HEADERS } from '../auth/anthropic-oauth.js'
import { log } from '../util/logger.js'

// models.list — the single source of the per-provider model catalog (spec:
// docs/features/provider-model-catalog.md). Merges three sources:
//   1. Pi SDK `getModels(provider)` — full metadata (context window, cost, …).
//   2. AWOG extras — models newer than the pinned pi-ai (mirror of the runtime
//      clone-fallback in model-resolver.ts); dropped once Pi/live returns them.
//   3. Live `GET /v1/models` on the provider (opt-in via `live`, needs an
//      account credential) — the freshest id list, so a just-released model
//      shows without a code/pi bump.
// The UI reads this per provider (shared across all accounts of that provider);
// runtime resolution still goes through model-resolver (Pi getModel + fallback).

const Params = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  // Required only when `live` is set — used to authenticate the /v1/models call.
  accountId: z.string().min(1).optional(),
  // Opt into the live provider fetch. Off → Pi catalog + extras only (offline-safe).
  live: z.boolean().optional(),
})

type BuiltInProvider = z.infer<typeof Params>['provider']

export type ModelSource = 'pi' | 'api' | 'both'

export interface ModelInfo {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
  source: ModelSource
}

// Models newer than the pinned pi-ai catalog. Keep in sync with the runtime
// clone-fallback (runtime/model-resolver.ts). The merge dedups by id, so once
// pi-ai or the live fetch reports them these entries are shadowed harmlessly.
const AWOG_EXTRAS: Record<BuiltInProvider, ModelInfo[]> = {
  anthropic: [
    { id: 'claude-opus-5', name: 'Claude Opus 5', contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, source: 'pi' },
    { id: 'claude-opus-5-1m', name: 'Claude Opus 5 (1M)', contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, source: 'pi' },
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, source: 'pi' },
  ],
  openai: [],
  google: [],
}

function piModels(provider: BuiltInProvider): ModelInfo[] {
  try {
    return getModels(provider).map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      reasoning: m.reasoning,
      source: 'pi' as const,
    }))
  } catch {
    return []
  }
}

// Live Anthropic model list. Only the built-in provider host is contacted (no
// user-supplied host → no SSRF); custom endpoints are skipped by the caller.
async function liveAnthropic(
  cred: { kind: 'oauth'; accessToken: string } | { kind: 'apikey'; apiKey: string },
): Promise<ModelInfo[]> {
  const headers: Record<string, string> = {
    ...REQUIRED_HEADERS,
    'anthropic-version': ANTHROPIC_API_HEADERS.ANTHROPIC_VERSION,
  }
  if (cred.kind === 'oauth') {
    headers.Authorization = `Bearer ${cred.accessToken}`
    headers['anthropic-beta'] = ANTHROPIC_API_HEADERS.ANTHROPIC_BETA_OAUTH
  } else {
    headers['x-api-key'] = cred.apiKey
  }
  const res = await fetch('https://api.anthropic.com/v1/models?limit=1000', { headers })
  if (!res.ok) throw new Error(`anthropic /v1/models returned ${res.status}`)
  const json = (await res.json()) as { data?: Array<{ id?: string; display_name?: string }> }
  return (json.data ?? [])
    .filter((d): d is { id: string; display_name?: string } => typeof d.id === 'string')
    .map((d) => ({ id: d.id, name: d.display_name ?? d.id, source: 'api' as const }))
}

// Best-effort live fetch — returns [] on any failure so the Pi catalog still
// shows. openai/google live fetch is Phase 3 (they fall back to Pi + extras).
async function liveModels(provider: BuiltInProvider, accountId: string): Promise<ModelInfo[]> {
  try {
    const { cred } = await resolveCredential(provider, accountId)
    // Custom endpoints expose their own models via account.models — don't probe them.
    if (cred.kind === 'apikey' && cred.baseURL) return []
    if (provider === 'anthropic') {
      return await liveAnthropic(cred.kind === 'oauth' ? cred : { kind: 'apikey', apiKey: cred.apiKey })
    }
    return []
  } catch (err) {
    log.warn('models.list live fetch failed', {
      provider,
      err: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

// Union by id: Pi/extra metadata wins for known ids; live-only ids are added
// with minimal metadata. `source` records where each id was found.
function merge(base: ModelInfo[], live: ModelInfo[]): ModelInfo[] {
  const byId = new Map<string, ModelInfo>()
  for (const m of base) if (!byId.has(m.id)) byId.set(m.id, m)
  for (const m of live) {
    const existing = byId.get(m.id)
    byId.set(m.id, existing ? { ...existing, source: 'both' } : m)
  }
  return [...byId.values()]
}

register('models.list', async (raw) => {
  const params = Params.parse(raw)
  const { provider } = params

  const pi = piModels(provider)
  const piIds = new Set(pi.map((m) => m.id))
  const extras = AWOG_EXTRAS[provider].filter((e) => !piIds.has(e.id))
  const base = [...pi, ...extras]

  const live = params.live && params.accountId ? await liveModels(provider, params.accountId) : []
  const models = merge(base, live)

  log.info('models.list', {
    provider,
    pi: pi.length,
    extras: extras.length,
    live: live.length,
    total: models.length,
  })
  return { models, live: live.length > 0, fetchedAt: new Date().toISOString() }
})
