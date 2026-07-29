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
// Nothing here does I/O except through the injected `request` (engine.request), so
// the whole policy is unit-testable with a stub.

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
] as const

// P1 allowlist. NOTE: `sessions.steer` and all `tasks.*` are intentionally EXCLUDED
// from P1 (deferred to P2 per spec) to keep the attack surface minimal — adding
// them back requires a fresh infosec pass (spec §Yêu cầu bảo mật, re-audit rule).
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

type SessionLike = {
  projectId: string | null
  settings: {
    provider: string
    modelId: string
    accountId?: string
    level: string
    mode: string
  }
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
      const level = typeof phoneSettings.level === 'string' ? phoneSettings.level : s.level
      const attachments = sanitizeAttachments(p.attachments)
      return {
        sessionId,
        messageId: reqString(p.messageId, 'messageId'),
        text: typeof p.text === 'string' ? p.text : '',
        ...(attachments ? { attachments } : {}),
        history: [], // sidecar folds the transcript from JSONL itself
        settings: { provider: s.provider, modelId: s.modelId, accountId: s.accountId, level, mode },
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
    default:
      // Unreachable if REMOTE_ALLOWLIST and this switch stay in sync — fail closed.
      throw new RemoteRejected(`no sanitizer for method: ${method}`)
  }
}
