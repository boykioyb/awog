// Remote Gateway security policy (mobile-remote-control, ADR 0067 + spec §Contract
// kỹ thuật). This module is the ONE place the remote attack surface is decided —
// keep it pure + auditable. It encodes:
//   F4 — method allowlist (exact-match, default-deny). Validated vs the sidecar
//        registry at boot (see remote-gateway.ts) so a typo fails fast.
//   F1 — per-method param-pick. A paired phone is L1-untrusted: it can DRIVE an
//        agent, so `sessions.sendMessage` params are the real RCE surface. We drop
//        every dangerous field (workspacePath/systemPrompt/history/…), force
//        autoApprove=false, and PIN provider/model/account/project from the
//        session's own persisted settings — never from the phone.
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
] as const

// Remote allowlist. NOTE: all `tasks.*` are still EXCLUDED (deferred) to keep the
// attack surface minimal — adding them requires a fresh infosec pass (spec
// §Yêu cầu bảo mật, re-audit rule).
export const REMOTE_ALLOWLIST: readonly string[] = [...READ_ONLY, ...GIT_SCOPED, ...BESPOKE]
export const METHOD_ALLOWLIST: ReadonlySet<string> = new Set(REMOTE_ALLOWLIST)

export function isMethodAllowed(method: string): boolean {
  return METHOD_ALLOWLIST.has(method)
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

// Modes a REMOTE turn may run in. `execute`/`accept-edits` are gate-OFF modes: the
// runtime skips the permission park entirely under them (permission.ts execute
// short-circuit sits BEFORE the autoApprove check), so a phone selecting `execute`
// would re-open ungated Bash/Write RCE despite our forced autoApprove:false
// (infosec F-1 blocker). We clamp any non-safe mode — from the phone OR the
// session's own persisted setting — down to `ask`, so the gate is ALWAYS on for a
// remote turn. Plan-approve from a phone therefore keeps the gate: the agent
// proceeds and each tool parks for the phone to approve via permission cards.
const REMOTE_SAFE_MODES = new Set(['ask', 'plan'])

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

function clampMode(raw: unknown, fallback: string): string {
  const mode = typeof raw === 'string' ? raw : fallback
  return REMOTE_SAFE_MODES.has(mode) ? mode : 'ask'
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
      ...toEngineSettings(merged, clampMode(phoneSettings.mode, session.settings.mode)),
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
      settings: toEngineSettings(chosen, clampMode(phoneSettings.mode, 'ask')),
    },
  }
}

// Turn a raw client `rpc` payload into params safe to forward to the sidecar.
// Throws RemoteRejected on anything not explicitly permitted. `method` MUST already
// be allowlisted (the gateway checks before calling this).
export async function sanitizeRemoteParams(
  method: string,
  raw: unknown,
  request: EngineRequest,
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
      // F-1: clamp to a gated mode. A phone-supplied (or session-persisted)
      // execute/accept-edits mode is downgraded to `ask` so the gate stays on.
      const requestedMode = typeof phoneSettings.mode === 'string' ? phoneSettings.mode : s.mode
      const mode = REMOTE_SAFE_MODES.has(requestedMode) ? requestedMode : 'ask'
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
        autoApprove: false, // F1: a phone can NEVER disable the permission gate
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
      return await buildUpsert(request, raw)
    case 'sessions.delete': {
      const p = asObject(raw)
      return { id: reqString(p.id ?? p.sessionId, 'id') }
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
    default:
      // Unreachable if REMOTE_ALLOWLIST and this switch stay in sync — fail closed.
      throw new RemoteRejected(`no sanitizer for method: ${method}`)
  }
}
