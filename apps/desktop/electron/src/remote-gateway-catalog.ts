// Gateway-LOCAL RPCs (mobile-remote-control P2). These never reach the sidecar
// verbatim: the gateway composes several server-side reads and returns a shaped,
// field-picked result. That is deliberate — the phone needs a project list, a
// model catalog and the desktop's session defaults to offer "New session", but
// forwarding `projects.list` / `accounts.list` / `settings.get` to a phone would
// hand it on-disk paths, account labels and the whole settings blob. Composing
// here keeps the remote allowlist (F4) free of read-everything methods.

import type { RemotePolicy } from './remote-gateway-policy'

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

// A workflow the phone may start a task from — NAME ONLY. The DAG itself (node
// prompts, skill ids, edges) stays on the desktop: the phone picks a workflow by
// id, it never gets to read or compose one.
export interface RemoteWorkflow {
  id: string
  name: string
  projectId?: string
  nodeCount: number
}

// What this gateway will currently let the phone do. `unattended` is the desktop's
// opt-in (Settings → Devices): with it OFF the ungated agent modes are clamped to
// `ask` and `tasks.create` is refused, so the PWA must label those affordances
// instead of letting a tap fail.
export interface RemoteCapabilities {
  unattended: boolean
}

export interface RemoteBootstrap {
  projects: RemoteProject[]
  // Only providers the desktop actually has an account for — a phone can't pick
  // a model nothing can run.
  providers: RemoteProviderEntry[]
  defaults: { provider: string; modelId: string; level: string }
  workflows: RemoteWorkflow[]
  capabilities: RemoteCapabilities
}

// ─── Tasks (#18) ────────────────────────────────────────────────────────────
// The sidecar's Task carries `workflowSnapshot` plus every run's full trace and
// message list — megabytes, and none of it is what a phone renders. These two
// shapes are the whole remote view of a task: enough to watch progress, approve a
// phase and stop a runaway, nothing more.

export interface RemoteTaskSummary {
  id: string
  title: string
  projectId: string
  status: string
  createdAt: string
  workflowId: string
  waitingApproval: string | null
  phaseCount: number
  donePhaseCount: number
}

export interface RemoteTaskPhase {
  nodeId: string
  status: string
  skillName: string
  runCount: number
  // Tail of the latest run's output — the phone shows it under the phase row.
  lastOutput?: string
}

export interface RemoteTaskDetail extends RemoteTaskSummary {
  description: string
  currentNodeId: string | null
  phases: RemoteTaskPhase[]
}

const LOCAL_METHODS = new Set(['remote.bootstrap', 'remote.tasks', 'remote.task'])

export function isLocalMethod(method: string): boolean {
  return LOCAL_METHODS.has(method)
}

const PROVIDERS = ['anthropic', 'openai', 'google'] as const
const MAX_MODELS_PER_PROVIDER = 60
const CACHE_TTL_MS = 60_000

const MAX_TASKS = 100
const MAX_WORKFLOWS = 100
const MAX_OUTPUT_CHARS = 4_000

// The heavy half of the bootstrap (projects + model catalog + workflow names).
// `capabilities` is NOT cached — it mirrors a switch the user can flip at any
// moment, and a stale "you may run unattended" is exactly the wrong thing to show.
let cached: { at: number; value: Omit<RemoteBootstrap, 'capabilities'> } | null = null

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

// Workflow NAMES across the tiers the desktop can see: global + every registered
// project. Node prompts are dropped here — see RemoteWorkflow.
async function loadWorkflows(
  request: EngineRequest,
  projects: RemoteProject[],
): Promise<RemoteWorkflow[]> {
  const { workflows } = await safe(
    request('workflows.list', { projectIds: projects.map((p) => p.id) }) as Promise<{
      workflows: { id: string; name?: string; projectId?: string; nodes?: unknown[] }[]
    }>,
    { workflows: [] },
  )
  return workflows.slice(0, MAX_WORKFLOWS).map((w) => ({
    id: w.id,
    name: w.name ?? w.id,
    ...(w.projectId ? { projectId: w.projectId } : {}),
    nodeCount: Array.isArray(w.nodes) ? w.nodes.length : 0,
  }))
}

async function buildBootstrap(
  request: EngineRequest,
): Promise<Omit<RemoteBootstrap, 'capabilities'>> {
  const [projects, buckets, defaults] = await Promise.all([
    loadProjects(request),
    accountBuckets(request),
    loadDefaults(request),
  ])
  const [providers, workflows] = await Promise.all([
    Promise.all(buckets.map(async (b) => ({ ...b, models: await modelsFor(request, b.provider) }))),
    loadWorkflows(request, projects),
  ])
  return { projects, providers, defaults, workflows }
}

// ─── Tasks (#18) ────────────────────────────────────────────────────────────

type RawRun = { status?: unknown; output?: unknown }
type RawPhase = { nodeId?: unknown; status?: unknown; skillName?: unknown; runs?: RawRun[] }
type RawTask = {
  id?: unknown
  title?: unknown
  projectId?: unknown
  status?: unknown
  createdAt?: unknown
  workflowId?: unknown
  description?: unknown
  currentNodeId?: unknown
  waitingApproval?: unknown
  phases?: Record<string, RawPhase>
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function phaseRows(task: RawTask): RawPhase[] {
  const phases = task.phases
  return phases && typeof phases === 'object' ? Object.values(phases) : []
}

function summarize(task: RawTask): RemoteTaskSummary {
  const rows = phaseRows(task)
  return {
    id: str(task.id),
    title: str(task.title, '(không tên)'),
    projectId: str(task.projectId),
    status: str(task.status, 'queued'),
    createdAt: str(task.createdAt),
    workflowId: str(task.workflowId),
    waitingApproval: typeof task.waitingApproval === 'string' ? task.waitingApproval : null,
    phaseCount: rows.length,
    donePhaseCount: rows.filter((p) => p.status === 'completed').length,
  }
}

function detail(task: RawTask): RemoteTaskDetail {
  return {
    ...summarize(task),
    description: str(task.description).slice(0, MAX_OUTPUT_CHARS),
    currentNodeId: typeof task.currentNodeId === 'string' ? task.currentNodeId : null,
    phases: phaseRows(task).map((p) => {
      const runs = Array.isArray(p.runs) ? p.runs : []
      const last = runs.length > 0 ? runs[runs.length - 1] : undefined
      const output = str(last?.output)
      return {
        nodeId: str(p.nodeId),
        status: str(p.status, 'pending'),
        skillName: str(p.skillName),
        runCount: runs.length,
        // Tail, not head: the end of a run is what says how it went. `trace` and
        // `messages` are dropped entirely.
        ...(output ? { lastOutput: output.slice(-MAX_OUTPUT_CHARS) } : {}),
      }
    }),
  }
}

async function loadTasks(request: EngineRequest): Promise<{ tasks: RemoteTaskSummary[] }> {
  const { tasks } = await safe(
    request('tasks.list', {}) as Promise<{ tasks: RawTask[] }>,
    { tasks: [] },
  )
  return { tasks: tasks.slice(0, MAX_TASKS).map(summarize) }
}

// Params are L1: only `id` is read, and it must be a plain string. Everything the
// sidecar returns is field-picked by `detail` before it reaches the wire.
async function loadTask(
  request: EngineRequest,
  params: unknown,
): Promise<{ task: RemoteTaskDetail | null }> {
  const id = params && typeof params === 'object' ? (params as { id?: unknown }).id : undefined
  if (typeof id !== 'string' || id.length === 0) throw new Error('missing/invalid field: id')
  const { task } = (await request('tasks.get', { id })) as { task: RawTask | null }
  return { task: task ? detail(task) : null }
}

async function bootstrap(request: EngineRequest, policy: RemotePolicy): Promise<RemoteBootstrap> {
  const now = Date.now()
  if (!cached || now - cached.at >= CACHE_TTL_MS) {
    cached = { at: now, value: await buildBootstrap(request) }
  }
  return { ...cached.value, capabilities: { unattended: policy.unattended } }
}

// Dispatch a gateway-local method. `isLocalMethod` gates the call site, so an
// unknown name here is a programming error, not a remote input.
export async function handleLocalMethod(
  method: string,
  params: unknown,
  request: EngineRequest,
  policy: RemotePolicy,
): Promise<unknown> {
  switch (method) {
    case 'remote.bootstrap':
      return await bootstrap(request, policy)
    case 'remote.tasks':
      return await loadTasks(request)
    case 'remote.task':
      return await loadTask(request, params)
    default:
      throw new Error(`no local handler: ${method}`)
  }
}
