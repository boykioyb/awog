// Remote Gateway security policy (mobile-remote-control, ADR 0067 + spec §Contract
// kỹ thuật). This module is the ONE place the remote attack surface is decided —
// keep it pure + auditable. It encodes:
//   F4 — method allowlist (exact-match, default-deny). Validated vs the sidecar
//        registry at boot (see remote-gateway.ts) so a typo fails fast.
//   F1 — per-method param-pick. A paired phone is L1-untrusted: it can DRIVE an
//        agent, so `sessions.sendMessage` params are the real RCE surface. We drop
//        every dangerous field (workspacePath/systemPrompt/history/…), force
//        autoApprove=false, and PIN provider/model/account/project from the
//        session's own persisted settings — never from the phone. The agent MODE
//        a phone may ask for is clamped to the GATED modes unless the desktop user
//        turned the unattended switch on — see UNGATED_MODES.
//   F3 — git.* is "read-only" but takes a `workspaceRoot`; unrestricted that reads
//        ANY repo on disk. We force workspaceRoot = a known project's path.
//   F2 — event egress allowlist (which engine events may reach a phone at all).
//
// Nothing here does I/O except through the injected `request` (engine.request) —
// the only other host call is `randomBytes` for a new session id — so the whole
// policy is unit-testable with a stub.

import { randomBytes } from 'node:crypto'

export class RemoteRejected extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteRejected'
  }
}

// --- F4: method allowlist -------------------------------------------------

// Read-only methods: forwarded verbatim (the sidecar zod-schema strips unknown
// fields and re-validates — defence in depth). None of these act on a filesystem
// path, so passthrough is safe. `git.*` is deliberately NOT here (see GIT_SCOPED).
const READ_ONLY = [
  'sessions.list',
  'sessions.get',
  'sessions.search',
  'sessions.costBreakdown',
  'sessions.turnActive',
  'sessions.activeTurns',
  'account.usage',
  'dashboard.usage',
  'ping',
] as const

// Read methods that take a `workspaceRoot` → must be scoped to a known project (F3).
const GIT_SCOPED = ['git.status', 'git.diff', 'git.log'] as const

// Mutating / turn-driving methods → bespoke param-pick below (F1).
const BESPOKE = [
  'sessions.sendMessage',
  'sessions.permission',
  'sessions.answerQuestion',
  'sessions.cancel',
  // P2 (mobile-remote-control §Backlog): mid-turn steering, the editable
  // checklist, session create/rename/delete + titling. Each one is param-picked
  // below — none of them accepts a filesystem path, a system prompt or an
  // account/credential reference from the phone.
  'sessions.steer',
  'sessions.updateTodos',
  'sessions.upsert',
  'sessions.delete',
  'sessions.generateTitle',
  // #18 — driving a Task/Workflow from the phone. Only the ACTIONS are here; the
  // READS are gateway-local (`remote.tasks` / `remote.task`, see the catalog),
  // because a raw `tasks.get` hands a phone the whole DAG snapshot plus every
  // run's trace + messages. Deliberately NOT opened: `tasks.rerunPhase`,
  // `tasks.discuss`, `tasks.delete`, `tasks.rename` — not needed to trigger or
  // supervise a run, and every extra name is extra surface.
  'tasks.create',
  'tasks.approvePhase',
  'tasks.cancel',
  'tasks.pause',
  'tasks.resume',
] as const

// Remote allowlist (exact-match, default-deny) — validated against the sidecar
// registry at boot (remote-gateway.ts).
export const REMOTE_ALLOWLIST: readonly string[] = [...READ_ONLY, ...GIT_SCOPED, ...BESPOKE]
export const METHOD_ALLOWLIST: ReadonlySet<string> = new Set(REMOTE_ALLOWLIST)

export function isMethodAllowed(method: string): boolean {
  return METHOD_ALLOWLIST.has(method)
}

// Allowlisted, but ONLY while the desktop's unattended switch is on: a task node
// runs `mode:'execute'` by construction (sidecar tasks/node-runner.ts:240), so
// creating a task from a phone starts an agent that never asks for approval — the
// same power as a remote `execute` turn, wearing a different name. Supervising an
// EXISTING task (approve/cancel/pause/resume) is not here: those act on a DAG the
// desktop user authored, which is exactly what ADR 0067 §3 allowlisted.
const UNATTENDED_ONLY = new Set<string>(['tasks.create'])

export function requiresUnattended(method: string): boolean {
  return UNATTENDED_ONLY.has(method)
}

// --- F2: event egress allowlist -------------------------------------------

// Only these event types may ever be forwarded to a phone. Everything else —
// crucially `auth.oauth-url`, `source.oauth-url`, `terminal.*`, `ssh:*`, `vpn:*`,
// `source.tools-log`, `fs:changed`, `git:status:changed` — is blocked. The gateway
// ALSO scopes these by the session/task a device has subscribed to (see gateway).
const EVENT_EGRESS = new Set<string>([
  'session.chunk',
  'session.step',
  'session.permission-request',
  'session.message.done',
  'session.background-started',
  'session.background-done',
])

export function isEventForwardable(type: string): boolean {
  return EVENT_EGRESS.has(type)
}

// The session id an event belongs to (for subscription scoping). Session events
// all carry `sessionId` in their payload; anything without one is not scopeable
// and therefore not forwarded.
export function eventSessionId(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'sessionId' in payload) {
    const v = (payload as { sessionId?: unknown }).sessionId
    return typeof v === 'string' ? v : null
  }
  return null
}

// --- F1/F3: param sanitization --------------------------------------------

// F8 (cost/DoS control) is enforced at the GATEWAY as RATE limits — concurrent
// turns, sends/hour, text-size + connection caps (see remote-gateway.ts). We do
// NOT force a session `budget` here: `budget.hardLimitUsd` is a CUMULATIVE session
// cap (compared against the session's total spend), so forcing a small value would
// block continuing any session that already spent more — hijacking the user's own
// budget config. Leave `budget` unset → the turn uses the session's own budget.

// Modes a REMOTE turn may run in.
//
// ⚠ 2026-09-07 — this is the fix for the hole the previous note described. From
// 2026-08-30 to today the gateway accepted all four desktop modes from a phone,
// and the note right here said what that cost: `execute` skips the permission park
// outright (sidecar runtime/permission.ts — `if (mode === 'execute') return
// undefined`), so a remote turn ran Bash/Write with no approval card. That is full
// RCE reachable by anything holding a device token on the tailnet, and forcing
// `autoApprove:false` never held it back.
//
// The rule now: a REMOTE origin may not cause a mutation nobody approved. Both
// UNGATED modes are clamped to `ask` unless the person at the DESKTOP turned the
// unattended switch on (Settings → Devices; default OFF, stored in
// ~/.awog/remote-devices.json, never in a project file).
//   • `execute`      — no gate at all. The RCE case.
//   • `accept-edits` — Write/Edit auto-allow (Bash still parks). Narrower, but
//     still an unapproved write chosen by a remote origin, and a write to the
//     right file is a delayed exec. Same switch, same reason.
// `ask` / `plan` stay open to every paired phone.
//
// What the user loses with the switch off: nothing they cannot do in one more tap.
// The turn still runs; each mutating call parks and the approval card is delivered
// to BOTH the desktop and the phone (session.permission-request is on the event
// egress list), so the human reads the exact command before it runs — and an
// "Always allow" now only ever grants that exact command (ADR 0080), not the tool.
const GATED_MODES = ['ask', 'plan'] as const
const UNGATED_MODES = ['accept-edits', 'execute'] as const
const REMOTE_ALLOWED_MODES = new Set<string>([...GATED_MODES, ...UNGATED_MODES])

export function isUngatedMode(mode: string): boolean {
  return (UNGATED_MODES as readonly string[]).includes(mode)
}

// The mode a remote turn actually runs in. Applied to BOTH the phone's per-turn
// choice and the mode inherited from the session's persisted settings: the origin
// of THIS turn is a phone either way, and a desktop-set `execute` must not become
// a remote blank cheque. Unknown string ⇒ `ask` (the set widens, the field never
// becomes free-form).
export function clampRemoteMode(raw: unknown, fallback: string, unattended: boolean): string {
  const requested = typeof raw === 'string' ? raw : fallback
  if (!REMOTE_ALLOWED_MODES.has(requested)) return 'ask'
  if (isUngatedMode(requested) && !unattended) return 'ask'
  return requested
}

// The mode to PERSIST on a session (`sessions.upsert`). Different question from
// the one above: this value also governs the DESKTOP user's next turn, so a phone
// must never raise it into an ungated mode — but it must not quietly LOWER a mode
// the desktop set either (editing a title from the phone would otherwise knock a
// session out of `execute`). Switch off + ungated asked for ⇒ the request is
// ignored and the stored mode stands.
export function clampPersistedMode(raw: unknown, current: string, unattended: boolean): string {
  const requested = typeof raw === 'string' ? raw : current
  if (!REMOTE_ALLOWED_MODES.has(requested)) return 'ask'
  if (isUngatedMode(requested) && !unattended) {
    return REMOTE_ALLOWED_MODES.has(current) ? current : 'ask'
  }
  return requested
}

// What the gateway is allowed to do for a given frame. One field today (the
// unattended switch); it is a record so a future per-device policy has a seam.
export type RemotePolicy = {
  unattended: boolean
}

// Strip fields a phone must not supply on attachments — notably `path` (a desktop
// filesystem path the phone has no business referencing). Bound the count too.
function sanitizeAttachments(v: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.slice(0, 20).map((a) => {
    const o = a && typeof a === 'object' && !Array.isArray(a) ? { ...(a as Record<string, unknown>) } : {}
    delete o.path
    return o
  })
}

type EngineRequest = (method: string, params: unknown) => Promise<unknown>

type SessionSettingsLike = {
  provider: string
  modelId: string
  accountId?: string
  level: string
  mode: string
  // Response style (ADR 0046) — a session setting, not a per-turn one.
  responseStyle?: string
  responseStyleNoMarkdown?: boolean
}

type SessionLike = {
  projectId: string | null
  settings: SessionSettingsLike
}

type FullSessionLike = SessionLike & {
  id: string
  title: string
  createdAt: string
  invitedAgentIds?: string[]
  pendingAgentIds?: string[]
}

function asObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new RemoteRejected('params must be an object')
  }
  return v as Record<string, unknown>
}

function reqString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new RemoteRejected(`missing/invalid field: ${field}`)
  }
  return v
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k]
  return out
}

function optString(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s ? s.slice(0, max) : undefined
}

// --- P2: session lifecycle (create / rename / delete / steer / todos) -------
//
// The phone NEVER sends a Session object: it sends intent (title, projectId, a
// model choice) and the gateway builds the engine payload from the desktop's own
// state. That keeps every dangerous field of `sessions.upsert` — workspaceFolder
// (runtime cwd!), budget, pinnedContext, disabledTools, mcpServerIds, fork
// lineage — unreachable from a remote origin by construction, not by denylist.

const PROVIDERS = new Set(['anthropic', 'openai', 'google'])
const LEVELS = new Set(['low', 'medium', 'high', 'extra-high', 'max'])
const MAX_TITLE_CHARS = 200
const MAX_STEER_CHARS = 100_000
const MAX_TITLE_SEED_CHARS = 4_000
// Style ids are engine slugs ('bluf', 'hacker-80s', …) plus the 'Default'
// sentinel. Charset-bounded here; an id the sidecar doesn't know degrades to "no
// style" there, so the list itself doesn't have to be mirrored in the gateway.
const STYLE_ID_RE = /^[A-Za-z0-9-]{1,64}$/
// A session id addresses a directory the sidecar removes recursively, so it is
// charset-bounded here too — same slug rule the popout windows use. Belt and
// braces with `sanitizeChild`: neither layer may be the only one saying no.
const SESSION_ID_RE = /^[a-z0-9-]+$/

type ProjectRow = {
  id: string
  path: string
  llmDefaults?: { provider?: string; modelId?: string; level?: string; accountId?: string }
}

async function projectRows(request: EngineRequest): Promise<ProjectRow[]> {
  const { projects } = (await request('projects.list', {})) as { projects: ProjectRow[] }
  return projects
}

// A phone-supplied projectId is only ever accepted after matching a REGISTERED
// project (same rule as git scoping, F3). Absent/empty → a session with no project.
async function validProjectId(
  request: EngineRequest,
  raw: unknown,
): Promise<{ projectId: string | null; project: ProjectRow | null }> {
  if (raw === null || raw === undefined || raw === '') return { projectId: null, project: null }
  const id = reqString(raw, 'projectId')
  const project = (await projectRows(request)).find((p) => p.id === id)
  if (!project) throw new RemoteRejected('unknown projectId')
  return { projectId: id, project }
}

type ResolvedSettings = {
  provider: string
  modelId: string
  level: string
  accountId?: string
  responseStyle?: string
  responseStyleNoMarkdown?: boolean
}

// Which provider/model/account a phone-created session runs on — resolved
// ENTIRELY server-side: desktop defaults (settings.json) overlaid by the
// project's own LLM defaults, the precedence ui-next uses for a new session.
// The phone may pick a MODEL; it never picks who pays (accountId).
async function resolveNewSessionSettings(
  request: EngineRequest,
  project: ProjectRow | null,
): Promise<ResolvedSettings> {
  const settings = (await request('settings.get', null)) as {
    defaults?: { provider?: unknown; modelId?: unknown; thinkingLevel?: unknown }
  }
  const d = settings.defaults ?? {}
  const out: ResolvedSettings = {
    provider: typeof d.provider === 'string' && PROVIDERS.has(d.provider) ? d.provider : 'anthropic',
    modelId: optString(d.modelId, 200) ?? 'claude-opus-5',
    level: typeof d.thinkingLevel === 'string' && LEVELS.has(d.thinkingLevel) ? d.thinkingLevel : 'high',
  }
  const l = project?.llmDefaults
  if (l) {
    if (typeof l.provider === 'string' && PROVIDERS.has(l.provider)) out.provider = l.provider
    const modelId = optString(l.modelId, 200)
    if (modelId) out.modelId = modelId
    if (typeof l.level === 'string' && LEVELS.has(l.level)) out.level = l.level
    const accountId = optString(l.accountId, 128)
    if (accountId) out.accountId = accountId
  }
  return out
}

// Apply the phone's (optional) choices on top of resolved defaults. An omitted
// field means "inherit" — that's how a new session still picks up the project's
// LLM defaults. Switching PROVIDER drops the resolved accountId: an account
// belongs to one provider, so carrying it across would pin a credential that
// can't serve the chosen model.
function applyModelChoice(base: ResolvedSettings, phone: Record<string, unknown>): ResolvedSettings {
  const out: ResolvedSettings = { ...base }
  const provider = optString(phone.provider, 32)
  if (provider && PROVIDERS.has(provider) && provider !== base.provider) {
    out.provider = provider
    delete out.accountId
  }
  const modelId = optString(phone.modelId, 200)
  if (modelId) out.modelId = modelId
  const level = optString(phone.level, 32)
  if (level && LEVELS.has(level)) out.level = level
  const style = optString(phone.responseStyle, 64)
  if (phone.responseStyle === null || style === 'Default') delete out.responseStyle
  else if (style && STYLE_ID_RE.test(style)) out.responseStyle = style
  if (typeof phone.responseStyleNoMarkdown === 'boolean') {
    out.responseStyleNoMarkdown = phone.responseStyleNoMarkdown
  }
  return out
}

// The phone MAY pick which account pays, but only a real one that belongs to the
// resolved provider — never a free-form string. `null` clears the pin (fall back
// to that provider's active account).
async function resolveChoice(
  request: EngineRequest,
  base: ResolvedSettings,
  phone: Record<string, unknown>,
): Promise<ResolvedSettings> {
  const out = applyModelChoice(base, phone)
  if (phone.accountId === null) {
    delete out.accountId
    return out
  }
  const accountId = optString(phone.accountId, 128)
  if (!accountId) return out
  const { providers } = (await request('accounts.list', {})) as {
    providers: Record<string, { accounts: { id: string }[] }>
  }
  const known = providers[out.provider]?.accounts.some((a) => a.id === accountId) ?? false
  if (!known) throw new RemoteRejected('unknown accountId')
  out.accountId = accountId
  return out
}

function toEngineSettings(s: ResolvedSettings, mode: string): SessionSettingsLike {
  return {
    provider: s.provider,
    modelId: s.modelId,
    level: s.level,
    mode,
    ...(s.accountId ? { accountId: s.accountId } : {}),
    ...(s.responseStyle ? { responseStyle: s.responseStyle } : {}),
    ...(s.responseStyleNoMarkdown !== undefined
      ? { responseStyleNoMarkdown: s.responseStyleNoMarkdown }
      : {}),
  }
}

// Date-prefixed id in the same spirit as the desktop's session slug, tagged
// `phone` so a remotely-created session is identifiable on sight.
function newSessionId(): string {
  const d = new Date()
  const yymmdd = [d.getFullYear() % 100, d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('')
  // 48 random bits: an id collision would OVERWRITE an existing session file, so
  // buy far more headroom than the handful of sessions a day this creates.
  return `${yymmdd}-phone-${randomBytes(6).toString('hex')}`
}

async function buildUpsert(
  request: EngineRequest,
  raw: unknown,
  policy: RemotePolicy,
): Promise<Record<string, unknown>> {
  const p = asObject(raw)
  const phoneSettings = p.settings && typeof p.settings === 'object' ? asObject(p.settings) : {}
  const now = new Date().toISOString()

  if (p.mode === 'update-metadata') {
    const sessionId = reqString(p.sessionId, 'sessionId')
    const { session } = (await request('sessions.get', { sessionId })) as {
      session: FullSessionLike | null
    }
    if (!session) throw new RemoteRejected('session not found')
    // `projectId` absent = leave it as it is; explicit null = detach.
    const projectId =
      p.projectId === undefined
        ? session.projectId
        : (await validProjectId(request, p.projectId)).projectId
    const merged = await resolveChoice(
      request,
      {
        provider: session.settings.provider,
        modelId: session.settings.modelId,
        level: session.settings.level,
        ...(session.settings.accountId ? { accountId: session.settings.accountId } : {}),
        ...(session.settings.responseStyle ? { responseStyle: session.settings.responseStyle } : {}),
        ...(session.settings.responseStyleNoMarkdown !== undefined
          ? { responseStyleNoMarkdown: session.settings.responseStyleNoMarkdown }
          : {}),
      },
      phoneSettings,
    )
    // Keep the session's own settings (responseStyle, sshApprovalMode, …) and
    // overwrite only what the phone may change. A provider switch must also DROP
    // the pinned accountId — an account belongs to one provider.
    const nextSettings: Record<string, unknown> = {
      ...session.settings,
      // Clamped here too: `sessions.upsert` PERSISTS the mode, so an unclamped
      // phone write would leave the session in `execute` and make the DESKTOP
      // user's next turn ungated as well — privilege escalation by persistence.
      ...toEngineSettings(
        merged,
        clampPersistedMode(phoneSettings.mode, session.settings.mode, policy.unattended),
      ),
    }
    if (!merged.accountId) delete nextSettings.accountId
    if (!merged.responseStyle) delete nextSettings.responseStyle
    return {
      mode: 'update-metadata',
      session: {
        // Every field the engine's patch touches, carried from the persisted
        // session unless the phone is explicitly allowed to change it.
        ...session,
        id: sessionId,
        title: optString(p.title, MAX_TITLE_CHARS) ?? session.title,
        projectId,
        createdAt: session.createdAt,
        updatedAt: now,
        invitedAgentIds: session.invitedAgentIds ?? [],
        pendingAgentIds: session.pendingAgentIds ?? [],
        messages: [], // update-metadata never writes messages (sendMessage does)
        settings: nextSettings,
      },
    }
  }

  const { projectId, project } = await validProjectId(request, p.projectId)
  const base = await resolveNewSessionSettings(request, project)
  const chosen = await resolveChoice(request, base, phoneSettings)
  return {
    mode: 'create',
    session: {
      id: newSessionId(),
      title: optString(p.title, MAX_TITLE_CHARS) ?? 'New session',
      projectId,
      createdAt: now,
      updatedAt: now,
      invitedAgentIds: [],
      pendingAgentIds: [],
      messages: [],
      settings: toEngineSettings(
        chosen,
        clampPersistedMode(phoneSettings.mode, 'ask', policy.unattended),
      ),
    },
  }
}

// --- #18: Task / Workflow control ------------------------------------------
//
// A task node runs with `mode:'execute'` and no permission gate (sidecar
// tasks/node-runner.ts) — that is the whole point of a task: unattended work. So
// the phone's reach over tasks is split in two:
//   • SUPERVISE an existing task (approve/cancel/pause/resume) — allowed for any
//     paired device. The DAG and the prompt were authored on the desktop; the
//     phone only says "go on" / "stop", which is what ADR 0067 §3 allowlisted.
//   • CREATE a task — needs the unattended switch (UNATTENDED_ONLY above). Here
//     the phone writes the prompt, so it decides WHAT runs ungated.
//
// Cost is capped by the engine's own per-task budget (sidecar tasks/budget.ts:
// $20 / 1500 tool calls / 4h by default, event-sourced so it survives a restart)
// plus an hourly cap on task starts at the gateway.

// Ids the phone may reference. Charset-bounded because they end up in a path
// segment on the sidecar side (tasks/store.ts `sanitizeChild`).
const TASK_ID_RE = /^[A-Za-z0-9._-]{1,64}$/
const MAX_NODE_ID_CHARS = 128
const MAX_TASK_DESC_CHARS = 20_000

function taskId(p: Record<string, unknown>): string {
  const id = reqString(p.id, 'id')
  if (!TASK_ID_RE.test(id)) throw new RemoteRejected('invalid task id')
  return id
}

// Same spirit as newSessionId: minted HERE, tagged `phone`, never taken from the
// client. A client-chosen id would let a phone overwrite an existing task dir.
function newTaskId(): string {
  return `tsk-phone-${randomBytes(6).toString('hex')}`
}

type WorkflowRow = { id: string; name?: string }

// Build the `tasks.create` payload. Everything security-relevant is resolved
// server-side: the project must be REGISTERED, the workflow must be one the
// desktop can already see for that project, the id is minted here, and `source`
// is pinned to `manual` (the github/jira variants carry a repo/url/connectionId
// the phone has no business asserting). Git auto-commit fields are omitted on
// purpose so the task uses the engine's defaults rather than a phone's opinion.
async function buildTaskCreate(
  request: EngineRequest,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const p = asObject(raw)
  const projectId = reqString(p.projectId, 'projectId')
  const project = (await projectRows(request)).find((x) => x.id === projectId)
  if (!project) throw new RemoteRejected('unknown projectId')
  const workflowId = reqString(p.workflowId, 'workflowId')
  const { workflows } = (await request('workflows.list', { projectIds: [projectId] })) as {
    workflows: WorkflowRow[]
  }
  const workflow = workflows.find((w) => w.id === workflowId)
  if (!workflow) throw new RemoteRejected('unknown workflowId')
  return {
    id: newTaskId(),
    title: optString(p.title, MAX_TITLE_CHARS) ?? workflow.name ?? 'Tác vụ từ điện thoại',
    projectId,
    workflowId,
    source: { type: 'manual' },
    description: optString(p.description, MAX_TASK_DESC_CHARS) ?? '',
  }
}

// Turn a raw client `rpc` payload into params safe to forward to the sidecar.
// Throws RemoteRejected on anything not explicitly permitted. `method` MUST already
// be allowlisted (the gateway checks before calling this).
export async function sanitizeRemoteParams(
  method: string,
  raw: unknown,
  request: EngineRequest,
  policy: RemotePolicy,
): Promise<unknown> {
  if ((READ_ONLY as readonly string[]).includes(method)) {
    // Read-only: forward as-is; sidecar zod re-validates + strips unknown keys.
    return raw ?? null
  }

  if ((GIT_SCOPED as readonly string[]).includes(method)) {
    // F3: never trust `workspaceRoot`. The phone sends a `projectId`; we resolve it
    // to that project's on-disk path server-side and force it as the root.
    const p = asObject(raw)
    const projectId = reqString(p.projectId, 'projectId')
    const { projects } = (await request('projects.list', {})) as {
      projects: { id: string; path: string }[]
    }
    const project = projects.find((x) => x.id === projectId)
    if (!project) throw new RemoteRejected('unknown projectId')
    const rest = { ...p }
    delete rest.projectId
    delete rest.workspaceRoot // drop any client-supplied root, no matter what
    return { ...rest, workspaceRoot: project.path }
  }

  switch (method) {
    case 'sessions.sendMessage': {
      // F1: the dangerous method. Take only text/attachments/mode/level from the
      // phone; pin everything security-sensitive from the session's own settings.
      const p = asObject(raw)
      const sessionId = reqString(p.sessionId, 'sessionId')
      const { session } = (await request('sessions.get', { sessionId })) as {
        session: SessionLike | null
      }
      if (!session) throw new RemoteRejected('session not found')
      const s = session.settings
      const phoneSettings = p.settings && typeof p.settings === 'object' ? asObject(p.settings) : {}
      // Mode: the phone's choice wins over the session's persisted one, then BOTH
      // go through the clamp — an ungated mode needs the desktop's unattended
      // switch, whichever side asked for it.
      const mode = clampRemoteMode(phoneSettings.mode, s.mode, policy.unattended)
      const requestedLevel = optString(phoneSettings.level, 32)
      const level = requestedLevel && LEVELS.has(requestedLevel) ? requestedLevel : s.level
      const attachments = sanitizeAttachments(p.attachments)
      return {
        sessionId,
        messageId: reqString(p.messageId, 'messageId'),
        text: typeof p.text === 'string' ? p.text : '',
        ...(attachments ? { attachments } : {}),
        history: [], // sidecar folds the transcript from JSONL itself
        settings: {
          provider: s.provider,
          modelId: s.modelId,
          accountId: s.accountId,
          level,
          mode,
          // Response style is persisted on the session (ADR 0046) — carry it so a
          // remote turn is styled exactly like a desktop one.
          ...(s.responseStyle ? { responseStyle: s.responseStyle } : {}),
          ...(s.responseStyleNoMarkdown !== undefined
            ? { responseStyleNoMarkdown: s.responseStyleNoMarkdown }
            : {}),
        },
        // F1: a phone can never flip the autoApprove flag itself. With `mode`
        // clamped above, this once again means what it says: no remote turn runs a
        // mutating tool without either an approval card or the unattended switch.
        autoApprove: false,
        ...(session.projectId ? { projectId: session.projectId } : {}),
        // Explicitly dropped (never forwarded): workspacePath, contextFolders,
        // systemPrompt, instructions, disabledTools, mcpServerIds, budget (F8 is
        // rate-limited at the gateway, not a forced session dollar cap).
      }
    }
    case 'sessions.permission':
      // F7: drop `updatedInput` (arg rewrite) + `alwaysAllow` (session-wide gate off).
      return pick(asObject(raw), ['requestId', 'decision'])
    case 'sessions.answerQuestion':
      return pick(asObject(raw), ['requestId', 'answers'])
    case 'sessions.cancel':
      return pick(asObject(raw), ['sessionId'])
    case 'sessions.steer': {
      // Steering injects user text into a LIVE turn — same trust level as a
      // message, and the gate stays on because the turn's mode was already
      // clamped when it started.
      const p = asObject(raw)
      return {
        sessionId: reqString(p.sessionId, 'sessionId'),
        messageId: reqString(p.messageId, 'messageId'),
        text: reqString(p.text, 'text').slice(0, MAX_STEER_CHARS),
      }
    }
    case 'sessions.updateTodos':
      // Shape/caps are the sidecar's zod schema (max 200 items × 2000 chars).
      return pick(asObject(raw), ['sessionId', 'todos'])
    case 'sessions.upsert':
      return await buildUpsert(request, raw, policy)
    case 'sessions.delete': {
      const p = asObject(raw)
      const id = reqString(p.id ?? p.sessionId, 'id')
      if (!SESSION_ID_RE.test(id)) throw new RemoteRejected('invalid session id')
      return { id }
    }
    case 'sessions.generateTitle': {
      // Titling costs a model call: pin provider/model/account from the session
      // server-side so the phone can't aim it at another account.
      const p = asObject(raw)
      const sessionId = reqString(p.sessionId, 'sessionId')
      const { session } = (await request('sessions.get', { sessionId })) as {
        session: SessionLike | null
      }
      if (!session) throw new RemoteRejected('session not found')
      const seed = optString(p.userText, MAX_TITLE_SEED_CHARS)
      return {
        sessionId,
        provider: session.settings.provider,
        modelId: session.settings.modelId,
        ...(session.settings.accountId ? { accountId: session.settings.accountId } : {}),
        ...(seed ? { userText: seed } : {}),
      }
    }
    // --- #18: Task / Workflow control ------------------------------------
    // Supervising an EXISTING task: one id, charset-bounded, nothing else. The id
    // addresses a directory the sidecar reads/writes (tasks/store.ts), so it is
    // bounded here as well as by `sanitizeChild` there — belt and braces, neither
    // layer may be the only one saying no.
    case 'tasks.cancel':
    case 'tasks.pause':
    case 'tasks.resume':
      return { id: taskId(asObject(raw)) }
    case 'tasks.approvePhase': {
      const p = asObject(raw)
      return {
        taskId: taskId({ id: p.taskId }),
        // nodeId indexes the task's OWN phase map (created from the workflow
        // snapshot); an unknown id is rejected by the engine.
        nodeId: reqString(p.nodeId, 'nodeId').slice(0, MAX_NODE_ID_CHARS),
      }
    }
    case 'tasks.create':
      return await buildTaskCreate(request, raw)
    default:
      // Unreachable if REMOTE_ALLOWLIST and this switch stay in sync — fail closed.
      throw new RemoteRejected(`no sanitizer for method: ${method}`)
  }
}
