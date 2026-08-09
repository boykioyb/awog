// Gateway-LOCAL RPCs (mobile-remote-control P2). These never reach the sidecar
// verbatim: the gateway composes several server-side reads and returns a shaped,
// field-picked result. That is deliberate — the phone needs a project list, a
// model catalog and the desktop's session defaults to offer "New session", but
// forwarding `projects.list` / `accounts.list` / `settings.get` to a phone would
// hand it on-disk paths, account labels and the whole settings blob. Composing
// here keeps the remote allowlist (F4) free of read-everything methods.

type EngineRequest = (method: string, params: unknown) => Promise<unknown>

export interface RemoteProject {
  id: string
  name: string
  color?: string
}

export interface RemoteModel {
  id: string
  name: string
}

// Account IDENTITY only — never the credential blob, never `baseURL` (an internal
// host) or the fingerprint. Enough for the phone to say "run this session on the
// work account" and nothing more.
export interface RemoteAccount {
  id: string
  label: string
  status?: string
  // Custom endpoints / Codex curate their own model list; when present it wins
  // over the provider catalog for that account.
  models?: string[]
}

export interface RemoteProviderEntry {
  provider: string
  models: RemoteModel[]
  accounts: RemoteAccount[]
  activeAccountId: string | null
}

export interface RemoteBootstrap {
  projects: RemoteProject[]
  // Only providers the desktop actually has an account for — a phone can't pick
  // a model nothing can run.
  providers: RemoteProviderEntry[]
  defaults: { provider: string; modelId: string; level: string }
}

const LOCAL_METHODS = new Set(['remote.bootstrap'])

export function isLocalMethod(method: string): boolean {
  return LOCAL_METHODS.has(method)
}

const PROVIDERS = ['anthropic', 'openai', 'google'] as const
const MAX_MODELS_PER_PROVIDER = 60
const CACHE_TTL_MS = 60_000

let cached: { at: number; value: RemoteBootstrap } | null = null

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p
  } catch {
    return fallback
  }
}

async function loadProjects(request: EngineRequest): Promise<RemoteProject[]> {
  const { projects } = await safe(
    request('projects.list', {}) as Promise<{
      projects: { id: string; name: string; color?: string }[]
    }>,
    { projects: [] },
  )
  return projects.map((p) => ({ id: p.id, name: p.name, ...(p.color ? { color: p.color } : {}) }))
}

type SafeAccount = {
  id?: unknown
  label?: unknown
  status?: unknown
  models?: unknown
}

type AccountBucket = { accounts: SafeAccount[]; activeAccountId: string | null }

// Providers that are usable (≥ 1 configured account), with the identity fields of
// each account. accounts.list returns the SAFE view (invariant #1: no credential
// blob ever) and we narrow it further — id/label/status/models only.
async function accountBuckets(
  request: EngineRequest,
): Promise<{ provider: string; accounts: RemoteAccount[]; activeAccountId: string | null }[]> {
  const { providers } = await safe(
    request('accounts.list', {}) as Promise<{ providers: Record<string, AccountBucket> }>,
    { providers: {} as Record<string, AccountBucket> },
  )
  const out: { provider: string; accounts: RemoteAccount[]; activeAccountId: string | null }[] = []
  for (const provider of PROVIDERS) {
    const bucket = providers[provider]
    if (!bucket || bucket.accounts.length === 0) continue
    const accounts = bucket.accounts
      .filter((a): a is SafeAccount & { id: string } => typeof a.id === 'string')
      .map((a) => ({
        id: a.id,
        label: typeof a.label === 'string' ? a.label : a.id,
        ...(typeof a.status === 'string' ? { status: a.status } : {}),
        ...(Array.isArray(a.models)
          ? { models: a.models.filter((m): m is string => typeof m === 'string') }
          : {}),
      }))
    out.push({ provider, accounts, activeAccountId: bucket.activeAccountId ?? null })
  }
  return out
}

async function modelsFor(request: EngineRequest, provider: string): Promise<RemoteModel[]> {
  // live:false → the offline Pi catalog only; no provider HTTP call on a phone's
  // behalf (and no credential use) just to fill a dropdown.
  const { models } = await safe(
    request('models.list', { provider, live: false }) as Promise<{
      models: { id: string; name?: string }[]
    }>,
    { models: [] },
  )
  return models.slice(0, MAX_MODELS_PER_PROVIDER).map((m) => ({ id: m.id, name: m.name ?? m.id }))
}

async function loadDefaults(request: EngineRequest): Promise<RemoteBootstrap['defaults']> {
  const settings = await safe(
    request('settings.get', null) as Promise<{
      defaults?: { provider?: unknown; modelId?: unknown; thinkingLevel?: unknown }
    }>,
    {},
  )
  const d = settings.defaults ?? {}
  return {
    provider: typeof d.provider === 'string' ? d.provider : 'anthropic',
    modelId: typeof d.modelId === 'string' && d.modelId ? d.modelId : 'claude-opus-5',
    level: typeof d.thinkingLevel === 'string' ? d.thinkingLevel : 'high',
  }
}

async function buildBootstrap(request: EngineRequest): Promise<RemoteBootstrap> {
  const [projects, buckets, defaults] = await Promise.all([
    loadProjects(request),
    accountBuckets(request),
    loadDefaults(request),
  ])
  const providers = await Promise.all(
    buckets.map(async (b) => ({ ...b, models: await modelsFor(request, b.provider) })),
  )
  return { projects, providers, defaults }
}

// Dispatch a gateway-local method. `isLocalMethod` gates the call site, so an
// unknown name here is a programming error, not a remote input.
export async function handleLocalMethod(method: string, request: EngineRequest): Promise<unknown> {
  if (method !== 'remote.bootstrap') throw new Error(`no local handler: ${method}`)
  const now = Date.now()
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value
  const value = await buildBootstrap(request)
  cached = { at: now, value }
  return value
}
