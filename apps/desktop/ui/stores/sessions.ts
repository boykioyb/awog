import { defineStore, acceptHMRUpdate } from 'pinia'
import type {
  Session,
  SessionAttachment,
  SessionCompaction,
  SessionFollowUp,
  SessionMention,
  SessionMessage,
  SessionMessagePart,
  SessionQueuedMessage,
  SessionQuestionAnswer,
  SessionSearchResult,
  SessionSettings,
  SessionStep,
  SessionTokenKind,
} from '~/types'
import { useWorkspaceStore } from '~/stores/workspace'
import { useSettingsStore } from '~/stores/settings'
import { useQuotaStore } from '~/stores/quota'
import { GIT_COAUTHOR_PROMPT } from '~/utils/system-prompt'
import { nowIso } from '~/utils/time'
import { notify } from '~/utils/notify'
import { composeOutgoingMessage } from '~/utils/follow-up'

// Tag used in `pendingAgentIds` to mark a reply pending from the sidecar/provider
// (no agent persona mapping yet — M7 will reintroduce agent personas).
const SIDECAR_PENDING_TAG = 'sidecar'

interface SidecarSendMessageResult {
  messageId: string
  text: string
  modelUsed: string
  usage: {
    input_tokens: number
    output_tokens: number
    // Prompt-cache buckets. Optional: a sidecar predating this field omits them.
    cache_read_tokens?: number
    cache_creation_tokens?: number
  }
  stopReason: string | null
  // Provider error cause when stopReason === 'error'. The run completed normally
  // (Pi reports a mid-stream provider failure as a graceful `error` stop, not a
  // throw), so this is the only signal the turn actually failed.
  errorMessage?: string
  // Ordered timeline built by the sidecar (ADR 0032). Stored as the authoritative
  // message.parts on finalize; absent for a non-streaming reply with no steps.
  parts?: SessionMessagePart[]
}

// Lightweight list projection returned by sessions.list (ADR 0048) — mirrors the
// sidecar SessionSummary. No `messages`; the transcript loads on open.
interface SessionSummaryDto {
  id: string
  title: string
  projectId: string | null
  createdAt: string
  updatedAt: string
  pinned?: boolean
  invitedAgentIds: string[]
  pendingAgentIds: string[]
  settings: SessionSettings
  disabledTools?: string[]
  mcpServerIds?: string[]
  hasCompaction?: boolean
  messageCount: number
  lastPreview?: string
}

interface SessionsListResponse {
  sessions: SessionSummaryDto[]
}

interface SessionGetResponse {
  session: Session | null
}

// Fire-and-forget persistence helper. UI state remains optimistic — sidecar errors
// are logged but never block the user. M7 will surface failures via toast.
const pushToSidecar = (method: string, params: unknown): void => {
  const sidecar = useSidecar()
  if (!sidecar.available) return
  sidecar.request(method, params).catch((err) => {
    console.warn(`[sessions] ${method} failed:`, err)
  })
}

// Re-nest the flat step list persisted by the sidecar. During a live turn the
// store's upsertStep builds the subagent tree incrementally (children attached
// under their parent Task step); persistence flattens that back out (each step
// keeps its `parentId`). On hydrate we rebuild the tree so reloaded subagent
// turns render nested instead of dumping every child at top level. Idempotent:
// already-nested input (top-level steps without parentId) passes through —
// children live only inside `parent.children`, never at the array root.
const normalizeSteps = (steps: SessionStep[]): SessionStep[] => {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const topLevel: SessionStep[] = []
  for (const step of steps) {
    const parent = step.parentId ? byId.get(step.parentId) : undefined
    if (parent && parent !== step) (parent.children ??= []).push(step)
    else topLevel.push(step)
  }
  return topLevel
}

// Re-nest the ordered `parts` list the sidecar persists flat (ADR 0032): step
// parts carry `parentId`; a subagent child part is moved into its parent step
// part's `children` and dropped from the top level, while text parts and the
// timeline order are preserved. The parts analogue of normalizeSteps; idempotent.
const normalizeParts = (parts: SessionMessagePart[]): SessionMessagePart[] => {
  const stepById = new Map<string, SessionStep>()
  for (const p of parts) if (p.kind !== 'text') stepById.set(p.id, p)
  const out: SessionMessagePart[] = []
  for (const p of parts) {
    if (p.kind === 'text') {
      out.push(p)
      continue
    }
    const parent = p.parentId ? stepById.get(p.parentId) : undefined
    if (parent && parent !== p) (parent.children ??= []).push(p)
    else out.push(p)
  }
  return out
}

interface SessionChunkPayload {
  sessionId: string
  messageId: string
  delta: string
}

const isSessionChunkPayload = (raw: unknown): raw is SessionChunkPayload => {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  return (
    typeof p.sessionId === 'string' &&
    typeof p.messageId === 'string' &&
    typeof p.delta === 'string'
  )
}

interface SessionStepPayload {
  sessionId: string
  messageId: string
  step: SessionStep
}

const isSessionStepPayload = (raw: unknown): raw is SessionStepPayload => {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  if (typeof p.sessionId !== 'string' || typeof p.messageId !== 'string') return false
  if (!p.step || typeof p.step !== 'object') return false
  const s = p.step as Record<string, unknown>
  return typeof s.id === 'string' && typeof s.label === 'string'
}

export interface PendingPermission {
  sessionId: string
  messageId: string
  requestId: string
  toolName: string
  input: Record<string, unknown>
  promptSentence?: string
  displayName?: string
  description?: string
  decisionReason?: string
  blockedPath?: string
  hasSuggestions: boolean
}

const isPermissionRequestPayload = (
  raw: unknown,
): raw is PendingPermission & {
  suggestions?: unknown[]
} => {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  return (
    typeof p.sessionId === 'string' &&
    typeof p.messageId === 'string' &&
    typeof p.requestId === 'string' &&
    typeof p.toolName === 'string'
  )
}

const DEFAULT_SETTINGS: SessionSettings = {
  provider: 'anthropic',
  modelId: 'claude-opus-4-8',
  level: 'high',
  mode: 'ask',
  // Response style (ADR 0046): no `responseStyle` id = "Normal" (no directive
  // injected); markdown output on by default.
  responseStyleNoMarkdown: false,
}

interface CreateSessionInput {
  title: string
  projectId: string | null
}

let idCounter = 0
const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`

const extractTokens = (text: string, agentsByHandle: Map<string, string>): SessionMention[] => {
  const out: SessionMention[] = []
  const re = /([@$])([\w./-]+)|\/(\w+)/g
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    const full = m[0]
    let kind: SessionTokenKind
    let targetId: string
    if (m[1] === '$') {
      const handle = (m[2] ?? '').toLowerCase()
      const agentId = agentsByHandle.get(handle)
      if (!agentId) continue
      kind = 'agent'
      targetId = agentId
    } else if (m[1] === '@') {
      const path = m[2] ?? ''
      kind = path.includes('/') || path.includes('.') ? 'file' : 'skill'
      targetId = path
    } else {
      kind = 'command'
      targetId = m[3] ?? ''
    }
    out.push({ kind, targetId, raw: full, start: m.index, end: m.index + full.length })
  }
  return out
}

export const useSessionsStore = defineStore('sessions', {
  state: () => ({
    sessions: [] as Session[],
    selectedSessionId: null as string | null,
    // Tracks the in-flight assistant messageId per session so the Stop button
    // can target it via `sessions.cancel`. Cleared in sendMessage's finally.
    activeMessageBySession: {} as Record<string, string>,
    // Messages the user queued while a turn was streaming (Session steering/queue
    // — docs/features/session-steer-queue.md). Ephemeral (not persisted): each
    // session's queue auto-sends FIFO as a fresh turn once the current turn
    // finalizes. A key exists only while that session has pending items.
    queues: {} as Record<string, SessionQueuedMessage[]>,
    // When a turn entered a human-input park (question/permission), keyed by its
    // assistant messageId → the wall-clock it started waiting. On park exit the
    // elapsed since is added to that message's `waitingMs` and the key cleared.
    // Drives the "subtract park time from elapsed" display (item 1).
    parkStartedAt: {} as Record<string, number>,
    // Pending tool-use permission prompt. Singleton because canUseTool serialises
    // per turn — at most one prompt is on screen at a time. SessionPermissionDialog
    // watches this and renders when non-null.
    pendingPermission: null as PendingPermission | null,
    // Currently-open subagent (Task tool) drawer reference. Stored as
    // {sessionId, messageId, stepId} (not the step object itself) so the
    // drawer re-renders when the underlying step transitions running → done
    // and its detail updates from prompt to reply.
    subagentDrawerRef: null as { sessionId: string; messageId: string; stepId: string } | null,
    // Set by the Cmd+K search palette when opening a result: the message the
    // message list should scroll to + flash once the target session renders.
    // SessionMessageList watches this and clears it after scrolling.
    pendingScrollMessageId: null as string | null,
    // Message ids that have a workspace snapshot, per session (ADR 0038). Drives
    // the Rewind affordance: a message with a snapshot offers a file-restoring
    // rewind, otherwise rewind is conversation-only. Loaded lazily per session.
    snapshotMessageIds: {} as Record<string, string[]>,
    // Sessions whose latest reply finished while the user wasn't viewing them —
    // drives the unread badge on the Sessions tab + list rows. Cleared when the
    // session is opened / viewed.
    unread: {} as Record<string, true>,
    // True while the /sessions route is the active view (set by the page via
    // keep-alive activated/deactivated). A reply that lands while this is false
    // (user on another tab) marks the session unread even if it's the selected one.
    sessionsViewActive: false,
    // True once sessions have been loaded from the sidecar. Guards
    // hydrateFromSidecar so navigating away and back never re-loads (and
    // clobbers) the store — the store is the live source of truth for the app
    // lifetime, including any in-flight streaming turn that keeps running while
    // the user is on another page.
    hydrated: false,
    // Lazy-load (ADR 0048): which sessions have had their transcript fetched via
    // sessions.get. The list hydrates from summaries (messages:[] + messageCount);
    // opening a session fills its messages once. A freshly-created/branched or
    // streaming session counts as loaded (its messages already live in memory) so
    // ensureSessionMessages never clobbers them with a stale fetch.
    messagesLoaded: {} as Record<string, boolean>,
  }),

  getters: {
    selectedSession(state): Session | undefined {
      return state.sessions.find((s) => s.id === state.selectedSessionId)
    },
    sessionById:
      (state) =>
      (id: string): Session | undefined =>
        state.sessions.find((s) => s.id === id),
    isSessionStreaming:
      (state) =>
      (id: string): boolean => {
        const s = state.sessions.find((x) => x.id === id)
        return !!s && (s.pendingAgentIds ?? []).includes(SIDECAR_PENDING_TAG)
      },
    // True when any session has an in-flight streaming turn — drives the live
    // dot on the Sessions tab in the header so a running chat is visible while
    // the user is on another tab (sessions keep streaming under keep-alive).
    anyStreaming(state): boolean {
      return state.sessions.some((s) => (s.pendingAgentIds ?? []).includes(SIDECAR_PENDING_TAG))
    },
    // Whether a streaming session is PARKED on human input — it called
    // AskUserQuestion (an unanswered `kind:'question'` step on its in-flight
    // message) or is blocked on a permission prompt. The turn isn't really
    // working; it's waiting for the user. Drives a distinct "waiting" tab dot +
    // the per-message byline state.
    isSessionAwaitingInput:
      (state) =>
      (id: string): boolean => {
        const s = state.sessions.find((x) => x.id === id)
        if (!s || !(s.pendingAgentIds ?? []).includes(SIDECAR_PENDING_TAG)) return false
        if (state.pendingPermission?.sessionId === id) return true
        const activeId = state.activeMessageBySession[id]
        if (!activeId) return false
        const msg = s.messages.find((m) => m.id === activeId)
        return !!msg?.steps?.some((st) => st.kind === 'question' && !st.answers)
      },
    // True when ANY session is parked on human input (Sessions tab dot).
    anyAwaitingInput(state): boolean {
      if (state.pendingPermission) return true
      return state.sessions.some((s) => {
        if (!(s.pendingAgentIds ?? []).includes(SIDECAR_PENDING_TAG)) return false
        const activeId = state.activeMessageBySession[s.id]
        if (!activeId) return false
        const msg = s.messages.find((m) => m.id === activeId)
        return !!msg?.steps?.some((st) => st.kind === 'question' && !st.answers)
      })
    },
    // Whether a message has a workspace snapshot (→ rewind will restore files).
    hasSnapshot:
      (state) =>
      (sessionId: string, messageId: string): boolean =>
        (state.snapshotMessageIds[sessionId] ?? []).includes(messageId),
    // Count of sessions with an unread completed reply (Sessions tab badge).
    unreadCount(state): number {
      return Object.keys(state.unread).length
    },
    isUnread:
      (state) =>
      (id: string): boolean =>
        state.unread[id] === true,
    // Messages queued for a session while a turn streams (FIFO, oldest first).
    queuedMessages:
      (state) =>
      (id: string): SessionQueuedMessage[] =>
        state.queues[id] ?? [],
    activeSubagentStep(state): SessionStep | null {
      const ref = state.subagentDrawerRef
      if (!ref) return null
      const session = state.sessions.find((s) => s.id === ref.sessionId)
      const msg = session?.messages.find((m) => m.id === ref.messageId)
      return msg?.steps?.find((st) => st.id === ref.stepId) ?? null
    },
  },

  actions: {
    async hydrateFromSidecar(): Promise<void> {
      // Load once per app lifetime. Re-running on every /sessions mount would
      // overwrite this.sessions with the file snapshot — wiping a streaming
      // turn's un-persisted placeholder + text and orphaning the running
      // action's array reference, so the reply vanishes from the UI even
      // though the sidecar process is still alive in the background.
      if (this.hydrated) return
      const sidecar = useSidecar()
      if (!sidecar.available) {
        // Browser dev: no sidecar — start with an empty session list.
        return
      }
      try {
        const res = await sidecar.request<SessionsListResponse>('sessions.list')
        const summaries = Array.isArray(res.sessions) ? res.sessions : []
        // ADR 0048: the list hydrates from lightweight summaries (no messages).
        // Map each to a Session shell with `messages: []` + `messageCount`; the
        // transcript is fetched on open via ensureSessionMessages. This keeps
        // startup at KB instead of folding every transcript into RAM.
        this.sessions = summaries.map((s) => {
          const session: Session = {
            id: s.id,
            title: s.title,
            projectId: s.projectId,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            invitedAgentIds: s.invitedAgentIds ?? [],
            messages: [],
            pendingAgentIds: s.pendingAgentIds ?? [],
            settings: s.settings,
            messageCount: s.messageCount,
          }
          if (s.pinned !== undefined) session.pinned = s.pinned
          if (s.disabledTools !== undefined) session.disabledTools = s.disabledTools
          if (s.mcpServerIds !== undefined) session.mcpServerIds = s.mcpServerIds
          return session
        })
        this.messagesLoaded = {}
        this.selectedSessionId = this.sessions[0]?.id ?? null
        this.hydrated = true
        // Eagerly fetch the initially-selected session's transcript.
        if (this.selectedSessionId) void this.ensureSessionMessages(this.selectedSessionId)
      } catch (err) {
        console.warn('[sessions] hydrateFromSidecar failed', err)
      }
    },

    // Lazy-load a session's full transcript on open (ADR 0048). No-op if already
    // loaded, freshly created/branched, or streaming — those keep their messages
    // in memory and a fetch would clobber an in-flight turn. The guard is checked
    // BOTH before and after the RPC (a turn may start while it's in flight).
    async ensureSessionMessages(id: string): Promise<void> {
      if (this.messagesLoaded[id]) return
      const session = this.sessions.find((s) => s.id === id)
      if (!session) return
      if (session.messages.length > 0 || this.activeMessageBySession[id]) {
        this.messagesLoaded[id] = true
        return
      }
      const sidecar = useSidecar()
      if (!sidecar.available) {
        this.messagesLoaded[id] = true
        return
      }
      try {
        const res = await sidecar.request<SessionGetResponse>('sessions.get', { sessionId: id })
        const target = this.sessions.find((s) => s.id === id)
        if (!target) return
        // Re-check: a streaming turn may have begun (or messages otherwise
        // populated) while the RPC was in flight — the live in-memory transcript
        // wins, never overwrite it.
        if (target.messages.length > 0 || this.activeMessageBySession[id]) {
          this.messagesLoaded[id] = true
          return
        }
        const full = res.session
        if (full) {
          // Re-nest flat persisted steps/parts so reloaded turns render like live
          // ones (ADR 0032) — same normalization hydrateFromSidecar used to do.
          for (const message of full.messages) {
            if (message.steps?.length) message.steps = normalizeSteps(message.steps)
            if (message.parts?.length) message.parts = normalizeParts(message.parts)
          }
          target.messages = full.messages
          target.messageCount = full.messages.length
          if (full.compaction) target.compaction = full.compaction
          if (full.sdkSessionId) target.sdkSessionId = full.sdkSessionId
        }
        this.messagesLoaded[id] = true
      } catch (err) {
        console.warn('[sessions] ensureSessionMessages failed', id, err)
      }
    },

    selectSession(id: string | null) {
      this.selectedSessionId = id
      // Opening a session clears its unread flag + lazy-loads its transcript.
      if (id) {
        this.markRead(id)
        void this.ensureSessionMessages(id)
      }
    },

    // Clear a session's unread flag (it has been seen).
    markRead(id: string) {
      if (this.unread[id]) delete this.unread[id]
    },

    // The /sessions page reports whether it is the active view (keep-alive). On
    // becoming active the currently-selected session is considered read.
    setSessionsViewActive(active: boolean) {
      this.sessionsViewActive = active
      if (active && this.selectedSessionId) this.markRead(this.selectedSessionId)
    },

    // Initial settings for a new session. When the session is scoped to a
    // project that carries `llmDefaults`, inherit provider/account/model/effort
    // from it (mode stays the global default). The stored account is dropped if
    // it no longer exists, so the session falls back to the provider's active
    // account instead of pinning a dangling id.
    settingsForProject(projectId: string | null): SessionSettings {
      const base: SessionSettings = { ...DEFAULT_SETTINGS }
      if (!projectId) return base
      const ld = useWorkspaceStore().projectById(projectId)?.llmDefaults
      if (!ld) return base
      const next: SessionSettings = {
        ...base,
        provider: ld.provider,
        modelId: ld.modelId,
        level: ld.level,
      }
      if (ld.accountId) {
        const accounts = useSettingsStore().providers[ld.provider]?.accounts ?? []
        if (accounts.some((a) => a.id === ld.accountId)) next.accountId = ld.accountId
      }
      // Response style (ADR 0046): inherit the project's default style + modifier.
      // Omitted style = Normal, so only set when the project pinned one.
      if (ld.responseStyle) next.responseStyle = ld.responseStyle
      if (ld.responseStyleNoMarkdown) next.responseStyleNoMarkdown = true
      return next
    },

    // MCP whitelist for a new session in this project. Returns a copy of the
    // project's `llmDefaults.mcpServerIds`; undefined = all enabled servers (the
    // default), so callers leave `session.mcpServerIds` unset in that case.
    mcpDefaultsForProject(projectId: string | null): string[] | undefined {
      if (!projectId) return undefined
      const ld = useWorkspaceStore().projectById(projectId)?.llmDefaults
      return ld?.mcpServerIds ? [...ld.mcpServerIds] : undefined
    },

    // Returns null when the quota gate refuses a new session (plan usage over the
    // user threshold + "block new sessions" opt-in). Callers must handle null and
    // skip any navigate/select that assumes a session was created.
    createSession(data: CreateSessionInput): Session | null {
      const quota = useQuotaStore()
      if (quota.blockNewSessions) {
        quota.notifyBlockedNewSession()
        return null
      }
      const ts = nowIso()
      const session: Session = {
        id: newId('ses'),
        title: data.title || 'Untitled session',
        projectId: data.projectId,
        createdAt: ts,
        updatedAt: ts,
        invitedAgentIds: [],
        messages: [],
        pendingAgentIds: [],
        settings: this.settingsForProject(data.projectId),
      }
      const mcpDefaults = this.mcpDefaultsForProject(data.projectId)
      if (mcpDefaults !== undefined) session.mcpServerIds = mcpDefaults
      this.sessions.unshift(session)
      // A fresh session's (empty) transcript already lives in memory — no fetch.
      this.messagesLoaded[session.id] = true
      this.selectedSessionId = session.id
      pushToSidecar('sessions.upsert', { session, mode: 'create' })
      return session
    },

    // Fork a new session from a given message — copies the conversation up to
    // and including that message into a fresh session so the user can explore
    // an alternate direction without disturbing the original. Selects the new
    // session. Returns its id (or null when the message can't be located).
    branchFromMessage(messageId: string): string | null {
      const source = this.sessions.find((s) => s.messages.some((m) => m.id === messageId))
      if (!source) return null
      const idx = source.messages.findIndex((m) => m.id === messageId)
      if (idx < 0) return null
      const ts = nowIso()
      // JSON round-trip detaches the copies from the source's reactive objects
      // (messages hold only serialisable data — text, steps, usage, …).
      const messages = JSON.parse(
        JSON.stringify(source.messages.slice(0, idx + 1)),
      ) as Session['messages']
      const branch: Session = {
        id: newId('ses'),
        title: `${source.title} (branch)`,
        projectId: source.projectId,
        createdAt: ts,
        updatedAt: ts,
        pinned: false,
        invitedAgentIds: [...source.invitedAgentIds],
        messages,
        pendingAgentIds: [],
        settings: { ...source.settings },
      }
      if (source.disabledTools) branch.disabledTools = [...source.disabledTools]
      if (source.mcpServerIds) branch.mcpServerIds = [...source.mcpServerIds]
      this.sessions.unshift(branch)
      // The branch's copied transcript is already in memory — no fetch needed.
      this.messagesLoaded[branch.id] = true
      this.selectedSessionId = branch.id
      pushToSidecar('sessions.upsert', { session: branch, mode: 'create' })
      return branch.id
    },

    // Re-run a user turn: drop that user message and everything after it, then
    // send a fresh turn (optionally with edited text). Carries the original
    // attachments AND quote follow-ups. Shared by editAndResend + regenerate. The
    // dropped turns are truncated from the transcript first so the resend starts
    // from the same history the original did.
    async resendUserTurn(userMessageId: string, overrideText?: string): Promise<void> {
      const session = this.sessions.find((s) => s.messages.some((m) => m.id === userMessageId))
      if (!session) return
      const idx = session.messages.findIndex((m) => m.id === userMessageId)
      if (idx < 0) return
      const userMsg = session.messages[idx]
      if (!userMsg || userMsg.role !== 'user') return
      // Streaming guard: never truncate under a live turn.
      if ((session.pendingAgentIds ?? []).includes(SIDECAR_PENDING_TAG)) return
      const keepThroughId = idx > 0 ? (session.messages[idx - 1]?.id ?? null) : null
      const followUps =
        userMsg.followUps && userMsg.followUps.length ? [...userMsg.followUps] : undefined
      // Preserve quotes across the resend. EDIT seeds the draft from the stripped
      // body, so re-serialize the original quotes onto the new text (model input)
      // and re-attach them (cards). REGENERATE reuses the original text, which
      // already carries the serialized quote section.
      const text =
        overrideText !== undefined
          ? composeOutgoingMessage(overrideText.trim(), followUps ?? [])
          : userMsg.text
      const attachments = userMsg.attachments ? [...userMsg.attachments] : undefined
      if (!text.trim() && !(attachments && attachments.length)) return
      // Drop the user message + everything after it (keep through the prior one).
      session.messages = session.messages.slice(0, idx)
      session.updatedAt = nowIso()
      // Persist the truncate BEFORE the resend so the new turn's appended messages
      // land after it in the JSONL — fire-and-forget would race sendMessage's
      // user-message append and the truncate could drop it.
      const sidecar = useSidecar()
      if (sidecar.available) {
        try {
          await sidecar.request('sessions.truncate', { sessionId: session.id, keepThroughId })
        } catch (err) {
          console.warn('[sessions] truncate failed', err)
        }
      }
      await this.sendMessage(session.id, text, attachments, followUps)
    },

    // Edit a user message and re-send the turn with the new text.
    async editAndResend(userMessageId: string, newText: string): Promise<void> {
      await this.resendUserTurn(userMessageId, newText)
    },

    // Regenerate an assistant reply: re-run the user turn that produced it (same
    // text, same model). Walks back to the nearest preceding user message.
    async regenerate(agentMessageId: string): Promise<void> {
      const session = this.sessions.find((s) => s.messages.some((m) => m.id === agentMessageId))
      if (!session) return
      const idx = session.messages.findIndex((m) => m.id === agentMessageId)
      if (idx < 0) return
      let ui = idx - 1
      while (ui >= 0 && session.messages[ui]?.role !== 'user') ui -= 1
      const userMsg = ui >= 0 ? session.messages[ui] : undefined
      if (!userMsg) return
      await this.resendUserTurn(userMsg.id)
    },

    // Regenerate with a different model: switch the session model, then redo the
    // turn. The UI only offers models valid for the current provider/account, so
    // a plain modelId swap is enough (no provider/account change).
    async retryWithModel(agentMessageId: string, modelId: string): Promise<void> {
      const session = this.sessions.find((s) => s.messages.some((m) => m.id === agentMessageId))
      if (!session) return
      if (session.settings.modelId !== modelId) this.updateSettings(session.id, { modelId })
      await this.regenerate(agentMessageId)
    },

    updateSettings(sessionId: string, patch: Partial<SessionSettings>) {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      session.settings = { ...session.settings, ...patch }
      pushToSidecar('sessions.upsert', { session, mode: 'update-metadata' })
      // Mode is a global preference per user request: when the user flips
      // mode on the active session, mirror it onto every other session so the
      // composer chip reads consistently across the app.
      if (patch.mode !== undefined) {
        const nextMode = patch.mode
        this.sessions.forEach((other) => {
          if (other.id === sessionId) return
          if (other.settings.mode === nextMode) return
          other.settings.mode = nextMode
          pushToSidecar('sessions.upsert', { session: other, mode: 'update-metadata' })
        })
      }
    },

    setDisabledTools(sessionId: string, names: string[]) {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      session.disabledTools = names.length ? [...names] : []
      pushToSidecar('sessions.upsert', { session, mode: 'update-metadata' })
    },

    setMcpServerIds(sessionId: string, ids: string[] | undefined) {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      // undefined = reset to legacy default (all enabled). [] = explicit none.
      if (ids === undefined) delete session.mcpServerIds
      else session.mcpServerIds = [...ids]
      pushToSidecar('sessions.upsert', { session, mode: 'update-metadata' })
    },

    deleteSession(id: string) {
      this.sessions = this.sessions.filter((s) => s.id !== id)
      this.markRead(id)
      if (this.queues[id]) delete this.queues[id]
      if (this.messagesLoaded[id]) delete this.messagesLoaded[id]
      if (this.selectedSessionId === id) {
        this.selectedSessionId = this.sessions[0]?.id ?? null
        // Lazy-load the transcript of whatever session we fell back to.
        if (this.selectedSessionId) void this.ensureSessionMessages(this.selectedSessionId)
      }
      pushToSidecar('sessions.delete', { id })
    },

    renameSession(id: string, title: string) {
      const session = this.sessions.find((s) => s.id === id)
      if (!session) return
      session.title = title
      session.updatedAt = nowIso()
      pushToSidecar('sessions.upsert', { session, mode: 'update-metadata' })
    },

    setSessionProject(sessionId: string, projectId: string | null) {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      if (session.projectId === projectId) return
      session.projectId = projectId
      session.updatedAt = nowIso()
      pushToSidecar('sessions.upsert', { session, mode: 'update-metadata' })
    },

    inviteAgent(sessionId: string, agentId: string) {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      if (session.invitedAgentIds.includes(agentId)) return
      const workspace = useWorkspaceStore()
      const agent = workspace.agentById(agentId)
      if (!agent) return
      session.invitedAgentIds.push(agentId)
      session.messages.push({
        id: newId('m'),
        role: 'system',
        text: `${agent.name} joined`,
        at: nowIso(),
      })
      session.updatedAt = nowIso()
      pushToSidecar('sessions.upsert', { session, mode: 'update-metadata' })
    },

    removeAgent(sessionId: string, agentId: string) {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      session.invitedAgentIds = session.invitedAgentIds.filter((id) => id !== agentId)
      const workspace = useWorkspaceStore()
      const agent = workspace.agentById(agentId)
      session.messages.push({
        id: newId('m'),
        role: 'system',
        text: agent ? `${agent.name} left` : 'Agent left',
        at: nowIso(),
      })
      session.updatedAt = nowIso()
      pushToSidecar('sessions.upsert', { session, mode: 'update-metadata' })
    },

    async sendMessage(
      sessionId: string,
      text: string,
      attachments?: SessionAttachment[],
      followUps?: SessionFollowUp[],
      // Raw `/command` invocation the user typed (display-only — `text` already
      // holds the expanded template that the sidecar/model receives).
      commandInvocation?: string,
    ) {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      const trimmed = text.trim()
      if (!trimmed && !(attachments && attachments.length)) return

      // Auto-compact (ADR 0047): when the context is near full, summarise older
      // turns BEFORE this turn so it runs on a cut context. Reuses the /compact
      // path (running state + Stop). After it lands, session.compaction is set
      // and forwarded with this turn below. Skipped when off or nothing to fold.
      const settingsForCompact = useSettingsStore()
      if (
        settingsForCompact.autoCompact &&
        shouldAutoCompact(session, settingsForCompact.defaults?.systemPrompt)
      ) {
        await this.compactSession(sessionId)
      }

      // Auto-title: first user message in a still-default session becomes the
      // title. Strip newlines, cap at 60 chars with ellipsis so the sidebar
      // chip doesn't blow up.
      if (session.title === 'Untitled session' && session.messages.length === 0 && trimmed) {
        // Prefer the compact `/command` over the expanded template body so a
        // command-launched session gets a readable crude title (the AI title
        // generator still replaces it after the first reply lands).
        const titleSource = commandInvocation || trimmed
        const oneLine = titleSource.replace(/\s+/g, ' ').trim()
        session.title = oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine
        pushToSidecar('sessions.upsert', { session, mode: 'update-metadata' })
      }

      const workspace = useWorkspaceStore()
      const handleMap = new Map<string, string>()
      workspace.agents.forEach((a) => {
        handleMap.set(a.name.toLowerCase().replace(/\s+/g, '-'), a.id)
        handleMap.set(a.role.toLowerCase(), a.id)
      })

      const mentions = extractTokens(trimmed, handleMap)

      // Snapshot history BEFORE pushing user + placeholder so sidecar receives only prior turns.
      const history: SessionMessage[] = [...session.messages]
      // First real user turn? Used to trigger AI title generation once the reply
      // lands (replaces the crude first-message-prefix title set above).
      const isFirstUserTurn = !history.some((m) => m.role === 'user')

      const userMsg: SessionMessage = {
        id: newId('m'),
        role: 'user',
        text: trimmed,
        at: nowIso(),
        mentions: mentions.length ? mentions : undefined,
        attachments: attachments && attachments.length ? attachments : undefined,
        // Structured quotes for display: the bubble renders these as numbered
        // cards + injects the matching anchor badge into the source message,
        // instead of showing the raw `> quote` markdown that lives in `text`
        // (which stays intact for the model + history).
        followUps: followUps && followUps.length ? [...followUps] : undefined,
        commandInvocation: commandInvocation || undefined,
        modeAtSend: session.settings.mode,
      }
      session.messages.push(userMsg)

      // Auto-invite any @-mentioned agents (persona linkage stays here for UI continuity;
      // sidecar reply itself is provider-direct in M4).
      mentions.forEach((m) => {
        if (m.kind === 'agent' && !session.invitedAgentIds.includes(m.targetId)) {
          session.invitedAgentIds.push(m.targetId)
        }
      })

      // Placeholder agent bubble — UI renders loading state while sidecar works.
      const placeholderId = newId('m')
      const placeholderIdx = session.messages.length
      const startedAt = Date.now()
      session.messages.push({
        id: placeholderId,
        role: 'agent',
        text: '',
        at: nowIso(),
        startedAt,
      })
      session.pendingAgentIds = [
        ...new Set([...(session.pendingAgentIds ?? []), SIDECAR_PENDING_TAG]),
      ]
      session.updatedAt = nowIso()
      this.activeMessageBySession[sessionId] = placeholderId

      const sidecar = useSidecar()
      const settingsStore = useSettingsStore()
      const basePrompt = settingsStore.defaults?.systemPrompt || undefined
      // Co-author trailer convention is opt-in (Git setting). Append the block
      // only when enabled so the model commits with `Co-Authored-By: AWOG …`;
      // off → the model leaves commits unattributed (matches Task auto-commit).
      const systemPrompt = settingsStore.git.commitCoAuthor
        ? basePrompt
          ? `${basePrompt}\n\n${GIT_COAUTHOR_PROMPT}`
          : GIT_COAUTHOR_PROMPT
        : basePrompt

      // Update placeholder in-place so the reactive proxy keeps tracking the
      // same object identity (replacing s.messages[i] is also reactive, but
      // mutating proven-existing fields avoids a class of subtle bugs where a
      // late session.step event lands on the old reference). Preserve `steps`
      // streamed via upsertStep — they were the live UI signal during the turn
      // and would otherwise be dropped, killing the "ran N commands…" button.
      const finalize = (next: SessionMessage) => {
        const s = this.sessions.find((x) => x.id === sessionId)
        if (!s) return
        const slotAt = (idx: number): SessionMessage | undefined => {
          const direct = s.messages[idx]
          return direct && direct.id === placeholderId ? direct : undefined
        }
        let slot = slotAt(placeholderIdx)
        if (!slot) {
          const idx = s.messages.findIndex((m) => m.id === placeholderId)
          if (idx < 0) return
          slot = s.messages[idx]
        }
        if (!slot) return

        // Snapshot existing streamed steps before any mutation so we can
        // re-attach them if next omits steps (success/cancel paths do).
        const streamedSteps = slot.steps && slot.steps.length ? [...slot.steps] : undefined

        // Carry over all fields from next. role/id/text/at always change.
        slot.role = next.role
        slot.text = next.text
        slot.at = next.at
        if (next.startedAt !== undefined) slot.startedAt = next.startedAt
        if (next.completedAt !== undefined) slot.completedAt = next.completedAt
        if (next.modelUsed !== undefined) slot.modelUsed = next.modelUsed
        if (next.usage !== undefined) slot.usage = next.usage
        if (next.canceled !== undefined) slot.canceled = next.canceled
        if (next.error !== undefined) slot.error = next.error
        // Steps: prefer caller-supplied; otherwise re-attach streamed ones.
        if (next.steps !== undefined) slot.steps = next.steps
        else if (streamedSteps !== undefined) slot.steps = streamedSteps
        // Parts (ADR 0032): the sidecar-built ordered timeline becomes authoritative
        // on a successful finalize — an invisible swap over the live parts (same
        // content). slot.steps is re-derived from it so the summary + step-detail
        // owner-lookup stay consistent with what is rendered. Cancel/error paths
        // omit parts → the slot keeps its live partial parts + derived steps.
        if (next.parts !== undefined) {
          const normalized = normalizeParts(next.parts)
          slot.parts = normalized
          slot.steps = normalized.filter((p): p is SessionStep => p.kind !== 'text')
        }

        s.pendingAgentIds = (s.pendingAgentIds ?? []).filter((a) => a !== SIDECAR_PENDING_TAG)
        s.updatedAt = nowIso()
      }

      // Typewriter reveal. The provider delivers text very unevenly: a long
      // reply streams over several seconds, but a short reply arrives in a single
      // ~4ms burst (measured) — so appending raw deltas makes short replies pop
      // in all at once. Instead, deltas feed `trailingTarget` (the live text
      // part's full text); a steady timer reveals it into that part a few chars at
      // a time, so the reply always types out gradually (like the Claude extension).
      // Decoupled from finalize: completion is stamped only once the reveal has
      // caught up (revealDone), so finalize never snaps the remaining text in.
      // setInterval (not requestAnimationFrame) so it keeps revealing even when
      // the window is briefly unfocused.
      const sessionsRef = this.sessions
      const stillOurSlot = (): SessionMessage | null => {
        const s = sessionsRef.find((x) => x.id === sessionId)
        if (!s) return null
        const slot = s.messages[placeholderIdx]
        if (!slot || slot.id !== placeholderId) return null
        return slot
      }
      // ── Live timeline reducer (ADR 0032 Option B) ──────────────────────────
      // Build `slot.parts` in arrival order as the authoritative render structure
      // (text runs interleaved with steps, subagent steps nested). The TRAILING
      // text part types out via the typewriter; a step closes the open text run so
      // the next delta opens a fresh one. `slot.steps` is derived from the parts
      // (summary / owner-lookup consumers) and `slot.text` mirrors the revealed
      // flat text (copy / search / collapsed render). No textOffset — array order
      // IS the timeline.
      let trailingTarget = '' // full text of the live (trailing) text part
      let revealTimer: ReturnType<typeof setInterval> | null = null
      let textCompleted = false
      let onRevealDone: (() => void) | null = null
      const stopReveal = () => {
        if (revealTimer) {
          clearInterval(revealTimer)
          revealTimer = null
        }
      }
      const fireRevealDone = () => {
        const cb = onRevealDone
        onRevealDone = null
        cb?.()
      }
      // The trailing text part (last part, if it is text) is the one being typed.
      const trailingTextPart = (slot: SessionMessage): { kind: 'text'; text: string } | null => {
        const last = slot.parts?.[slot.parts.length - 1]
        return last && last.kind === 'text' ? last : null
      }
      // Revealed flat text across parts — kept on slot.text for copy / search and
      // the collapsed / no-step render branch.
      const revealedText = (slot: SessionMessage): string =>
        (slot.parts ?? []).reduce((acc, p) => (p.kind === 'text' ? acc + p.text : acc), '')
      const tick = () => {
        const slot = stillOurSlot()
        if (!slot) {
          stopReveal()
          fireRevealDone()
          return
        }
        const tp = trailingTextPart(slot)
        // Nothing open to type (between steps, or the reply ended on a step).
        if (!tp || tp.text.length >= trailingTarget.length) {
          if (textCompleted) {
            stopReveal()
            fireRevealDone()
          }
          return
        }
        // Adaptive: reveal ~1/6 of the remaining gap per tick (min 2 chars), so a
        // burst catches up in ~0.4s while a live stream tracks closely.
        const take = Math.max(2, Math.ceil((trailingTarget.length - tp.text.length) / 6))
        tp.text = trailingTarget.slice(0, tp.text.length + take)
        slot.text = revealedText(slot)
      }
      const ensureReveal = () => {
        if (!revealTimer) revealTimer = setInterval(tick, 16)
      }
      // Append a streamed text delta to the live (trailing) text part, opening a
      // fresh one if the last part is a step.
      const appendDelta = (delta: string) => {
        const slot = stillOurSlot()
        if (!slot) return
        if (!slot.parts) slot.parts = []
        const last = slot.parts[slot.parts.length - 1]
        if (!last || last.kind !== 'text') {
          slot.parts = [...slot.parts, { kind: 'text', text: '' }]
          trailingTarget = ''
        }
        trailingTarget += delta
        ensureReveal()
      }

      // Recurse into a step part's children to find a step by id.
      const findStepInChildren = (arr: SessionStep[], id: string): SessionStep | null => {
        for (const s of arr) {
          if (s.id === id) return s
          if (s.children?.length) {
            const inner = findStepInChildren(s.children, id)
            if (inner) return inner
          }
        }
        return null
      }
      const findStepPart = (slot: SessionMessage, id: string): SessionStep | null => {
        for (const p of slot.parts ?? []) {
          if (p.kind === 'text') continue
          if (p.id === id) return p
          if (p.children?.length) {
            const inner = findStepInChildren(p.children, id)
            if (inner) return inner
          }
        }
        return null
      }
      // slot.steps is derived from the ordered parts (the step parts, children
      // nested) so the summary toggle + step-detail owner-lookup keep working off
      // a single source of truth.
      const syncSteps = (slot: SessionMessage) => {
        slot.steps = (slot.parts ?? []).filter((p): p is SessionStep => p.kind !== 'text')
      }
      // Upsert a step into the ordered parts. A running → done repeat (or a
      // thinking re-emit) merges in place by id; a new top-level step closes the
      // open text run (so it splits the reply) and pushes a fresh part. Subagent
      // steps nest under their parent step part's children.
      const upsertStep = (step: SessionStep) => {
        const slot = stillOurSlot()
        if (!slot) return
        if (!slot.parts) slot.parts = []

        // Subagent step → attach under parent's children. If parent isn't tracked
        // yet (race: child event arriving before the parent tool_use), fall through
        // to top-level so it isn't lost.
        if (step.parentId) {
          const parent = findStepPart(slot, step.parentId)
          if (parent) {
            const kids = parent.children ?? []
            const cidx = kids.findIndex((c) => c.id === step.id)
            parent.children =
              cidx >= 0 ? kids.map((c, i) => (i === cidx ? { ...c, ...step } : c)) : [...kids, step]
            syncSteps(slot)
            return
          }
        }

        // Close the open text run so the step renders between text segments.
        const last = slot.parts[slot.parts.length - 1]
        if (last && last.kind === 'text') {
          last.text = trailingTarget
          slot.text = revealedText(slot)
          trailingTarget = ''
        }
        const pidx = slot.parts.findIndex((p) => p.kind !== 'text' && p.id === step.id)
        if (pidx >= 0) {
          const cur = slot.parts[pidx] as SessionStep
          // Merge so the done event can omit fields the running event populated.
          slot.parts = slot.parts.map((p, i) => (i === pidx ? { ...cur, ...step } : p))
        } else {
          slot.parts = [...slot.parts, step]
        }
        syncSteps(slot)
      }

      // Subscribe BEFORE invoking RPC so we don't miss the first chunk emitted on flush.
      // In browser dev (no Tauri shell) onEvent throws; we swallow and rely on request()
      // throwing the same SidecarUnavailableError to run the unified error path below.
      let unlisten: (() => void) | null = null
      try {
        unlisten = await sidecar.onEvent((evt) => {
          if (evt.type === 'session.chunk') {
            if (!isSessionChunkPayload(evt.payload)) return
            if (evt.payload.sessionId !== sessionId) return
            if (evt.payload.messageId !== placeholderId) return
            appendDelta(evt.payload.delta)
            return
          }
          if (evt.type === 'session.step') {
            if (!isSessionStepPayload(evt.payload)) return
            if (evt.payload.sessionId !== sessionId) return
            if (evt.payload.messageId !== placeholderId) return
            upsertStep(evt.payload.step)
            // Notify when the agent asks a question (AskUserQuestion) and the
            // user isn't looking — mirrors the permission-request notification.
            // The turn is parked until answered, so a missed question stalls
            // silently otherwise. notify() suppresses itself when the window is
            // focused; the tag de-dupes the running→answered re-emit.
            const qStep = evt.payload.step
            if (qStep.kind === 'question' && !qStep.answers) {
              // Turn is now parked on the user — start counting wait time, and
              // notify if the window isn't focused.
              this.enterPark(placeholderId)
              if (settingsStore.notificationsEnabled) {
                notify({
                  title: 'AWOG · Question',
                  body: qStep.questions?.[0]?.question || 'The agent is asking for your input.',
                  tag: `awog-question-${qStep.id}`,
                })
              }
            }
            // Mirror LLM-driven plan-mode toggles into the composer chip so the
            // UI reflects what the model is doing. Labels come from the
            // sidecar's humanLabel mapper (sessions/step-mapper.ts) — keep in
            // sync if you rename them there.
            const { label } = evt.payload.step
            if (label === 'Enter plan') {
              const s = this.sessions.find((x) => x.id === sessionId)
              if (s && s.settings.mode !== 'plan') s.settings.mode = 'plan'
            } else if (label === 'Exit plan') {
              const s = this.sessions.find((x) => x.id === sessionId)
              if (s && s.settings.mode === 'plan') s.settings.mode = 'ask'
            }
            return
          }
          if (evt.type === 'session.permission-request') {
            if (!isPermissionRequestPayload(evt.payload)) return
            if (evt.payload.sessionId !== sessionId) return
            if (evt.payload.messageId !== placeholderId) return
            // Snapshot into the singleton ref; SessionPermissionDialog renders
            // off this. Stripping suggestions keeps the UI shape narrow — the
            // sidecar keeps the full list and replays it on allow+alwaysAllow.
            const p = evt.payload
            const next: PendingPermission = {
              sessionId: p.sessionId,
              messageId: p.messageId,
              requestId: p.requestId,
              toolName: p.toolName,
              input:
                typeof p.input === 'object' && p.input !== null
                  ? (p.input as Record<string, unknown>)
                  : {},
              hasSuggestions: Array.isArray(p.suggestions) && p.suggestions.length > 0,
            }
            if (p.promptSentence) next.promptSentence = p.promptSentence
            if (p.displayName) next.displayName = p.displayName
            if (p.description) next.description = p.description
            if (p.decisionReason) next.decisionReason = p.decisionReason
            if (p.blockedPath) next.blockedPath = p.blockedPath
            this.pendingPermission = next
            // Turn is now parked waiting on the allow/deny decision — count the
            // wait so it's excluded from the turn's displayed elapsed.
            this.enterPark(placeholderId)
            // OS notification while the user isn't looking at the app. The util
            // suppresses itself when the window is focused so we don't spam.
            if (settingsStore.notificationsEnabled) {
              const target =
                next.blockedPath ||
                (typeof next.input.command === 'string' ? next.input.command : '') ||
                (typeof next.input.file_path === 'string' ? next.input.file_path : '') ||
                (typeof next.input.url === 'string' ? next.input.url : '')
              notify({
                title: `AWOG · ${next.toolName} permission`,
                body: target
                  ? `${next.promptSentence ?? 'Allow this action?'}\n${target}`
                  : (next.promptSentence ?? 'A tool wants permission to run.'),
                tag: `awog-perm-${next.requestId}`,
              })
            }
          }
        })
      } catch {
        // silently swallow — sidecar unavailable in browser dev
        unlisten = null
      }

      try {
        const result = await sidecar.request<SidecarSendMessageResult>('sessions.sendMessage', {
          sessionId,
          messageId: placeholderId,
          text: trimmed,
          // Attachments (image data URLs + file metadata). The sidecar persists
          // them on the user message and rebuilds image content blocks for the
          // model. Omitted when none so the legacy text-only path is unchanged.
          ...(attachments && attachments.length ? { attachments } : {}),
          history,
          settings: session.settings,
          systemPrompt,
          // Drives sidecar Options.cwd so Read/Bash/Edit operate against the
          // user's repo. Omitted (no projectId) → SDK falls back to process.cwd().
          ...(session.projectId ? { projectId: session.projectId } : {}),
          // Per-session tool denylist. Forwarded to SDK Options.disallowedTools
          // so the model can't even emit calls for these tool names.
          ...(session.disabledTools && session.disabledTools.length
            ? { disabledTools: session.disabledTools }
            : {}),
          // Per-session MCP whitelist. Omitted (undefined) → sidecar uses all
          // globally-enabled servers (legacy). Empty array sent intentionally
          // so user can opt out of every MCP for this session.
          ...(session.mcpServerIds !== undefined ? { mcpServerIds: session.mcpServerIds } : {}),
          // Active compaction checkpoint (ADR 0047). Sidecar feeds the model the
          // summary + messages after the cut instead of the full history.
          ...(session.compaction ? { compaction: session.compaction } : {}),
          // Active agent for this turn. Pha 1 (ADR 0015): we only pass an
          // agent tuple when exactly one agent is invited — sidecar then uses
          // that agent's systemPrompt for the turn. Multi-agent collab deferred.
          // We look the agent up by id in workspace store to fill in source +
          // projectId (first-match if the same slug exists in multiple tiers,
          // which is rare for pha 1).
          ...(() => {
            if (session.invitedAgentIds.length !== 1) return {}
            const id = session.invitedAgentIds[0]
            if (!id) return {}
            const agent = workspace.agentById(id)
            if (!agent) return {}
            const ref: { id: string; source: string; projectId?: string } = {
              id: agent.id,
              source: agent.source,
            }
            if (agent.projectId) ref.projectId = agent.projectId
            return { agent: ref }
          })(),
        })
        // First turn just completed (the assistant reply is now persisted in the
        // JSONL): refine the crude placeholder title into a concise AI-generated
        // one. Fire-and-forget so it never blocks the reply finalize.
        if (isFirstUserTurn) void this.autoGenerateTitle(sessionId)

        // The sidecar captures this turn's workspace snapshot fire-and-forget
        // (ADR 0038); give it a moment, then refresh the rewind affordance set.
        setTimeout(() => void this.loadSnapshotIds(sessionId), 1500)

        // Unread badge: if the user isn't actively viewing this session when the
        // reply lands (on another tab, another session, or window hidden), flag it
        // so the Sessions tab + list row surface an unread indicator.
        const viewingNow =
          this.sessionsViewActive &&
          this.selectedSessionId === sessionId &&
          (typeof document === 'undefined' || !document.hidden)
        if (!viewingNow) this.unread[sessionId] = true

        // Graceful provider `error` stop: the loop returned normally but the model
        // failed mid-turn (Pi reports this as stopReason 'error', not a throw). The
        // reply text is partial/empty — finalize the agent bubble with the error
        // attached so the UI shows a prominent alert + retry, keeping whatever
        // streamed. Don't flush the queue (mirror cancel: a failed turn leaves
        // queued messages for the user to decide on).
        const turnError =
          result.stopReason === 'error'
            ? { message: result.errorMessage || 'The model returned an error.' }
            : undefined
        // result.text is the authoritative full reply. Finalize only once the
        // typewriter has revealed the trailing text run, so the tail types out
        // instead of snapping. Keep placeholderId as the final id — stable key for
        // Vue lists, no diff churn.
        const doFinalize = () =>
          finalize({
            id: placeholderId,
            role: 'agent',
            text: result.text,
            at: nowIso(),
            startedAt,
            completedAt: Date.now(),
            modelUsed: result.modelUsed,
            usage: {
              inputTokens: result.usage.input_tokens,
              outputTokens: result.usage.output_tokens,
              cacheReadTokens: result.usage.cache_read_tokens ?? 0,
              cacheWriteTokens: result.usage.cache_creation_tokens ?? 0,
            },
            // Authoritative ordered timeline (ADR 0032). Undefined → finalize keeps
            // the derive path (legacy / non-streaming reply with no steps).
            ...(result.parts ? { parts: result.parts } : {}),
            ...(turnError ? { error: turnError } : {}),
          })
        // All deltas have streamed into the live parts by now — just let the
        // typewriter finish revealing the trailing text run, then finalize (which
        // adopts the sidecar's authoritative parts + the full text, an invisible
        // swap since the revealed content already matches).
        textCompleted = true
        onRevealDone = () => {
          doFinalize()
          // Failed turn → leave the queue intact (the next message would likely
          // hit the same error). Clean finish → auto-send the next queued message
          // (FIFO) as a fresh turn; doFinalize cleared the streaming tag, so
          // flushQueueHead sees the session idle.
          if (!turnError) void this.flushQueueHead(sessionId)
        }
        ensureReveal()
        tick()
      } catch (err) {
        // Stop the typewriter — cancel keeps whatever was already revealed, error
        // replaces the bubble. (Success leaves it running so the tail types out.)
        stopReveal()
        onRevealDone = null
        const isCanceled = err instanceof SidecarError && err.code === -32023
        if (isCanceled) {
          // User-initiated stop. Snap the trailing text run to everything received
          // (the typed reveal may lag behind), keep the live partial parts as-is,
          // mark the turn complete + flag it as canceled.
          const s = this.sessions.find((x) => x.id === sessionId)
          const slot = s?.messages[placeholderIdx]
          let partialText = ''
          if (slot?.id === placeholderId) {
            const last = slot.parts?.[slot.parts.length - 1]
            if (last && last.kind === 'text') last.text = trailingTarget
            partialText = (slot.parts ?? []).reduce(
              (acc, p) => (p.kind === 'text' ? acc + p.text : acc),
              '',
            )
          }
          finalize({
            id: placeholderId,
            role: 'agent',
            text: partialText,
            at: nowIso(),
            startedAt,
            completedAt: Date.now(),
            canceled: true,
          })
        } else {
          // A thrown runtime/network/RPC failure. Surface the real cause on the
          // agent bubble (role stays 'agent') as a structured error so the UI shows
          // a prominent alert + retry — not a faint, easy-to-miss system divider.
          let message: string
          if (err instanceof SidecarUnavailableError) {
            message = 'Sidecar unavailable — running in browser dev'
          } else if (err instanceof SidecarError) {
            // Include the RPC code so a bare provider error is still identifiable.
            message = err.code ? `${err.message} (code ${err.code})` : err.message
          } else if (err instanceof Error) {
            message = err.message
          } else {
            message = 'Unknown error'
          }
          // Keep whatever partial reply streamed before the throw — snap the
          // trailing text run to all received deltas, then attach the error.
          const s = this.sessions.find((x) => x.id === sessionId)
          const slot = s?.messages[placeholderIdx]
          let partialText = ''
          if (slot?.id === placeholderId) {
            const last = slot.parts?.[slot.parts.length - 1]
            if (last && last.kind === 'text') last.text = trailingTarget
            partialText = (slot.parts ?? []).reduce(
              (acc, p) => (p.kind === 'text' ? acc + p.text : acc),
              '',
            )
          }
          finalize({
            id: placeholderId,
            role: 'agent',
            text: partialText,
            at: nowIso(),
            startedAt,
            completedAt: Date.now(),
            error: { message },
          })
        }
      } finally {
        if (unlisten) unlisten()
        // Turn ended while still parked (cancel/error mid-question/permission):
        // bank the final wait span so the elapsed excludes it, and drop the key.
        this.exitPark(placeholderId)
        if (this.activeMessageBySession[sessionId] === placeholderId) {
          delete this.activeMessageBySession[sessionId]
        }
        // Stale permission for THIS turn would block the UI forever — clear
        // it. The sidecar already rejected any parked permission via the abort
        // listener; we just need the local state gone.
        if (
          this.pendingPermission &&
          this.pendingPermission.sessionId === sessionId &&
          this.pendingPermission.messageId === placeholderId
        ) {
          this.pendingPermission = null
        }
      }
    },

    // Resolve the in-flight permission prompt by sending the user's choice
    // back to the sidecar. Local state is cleared eagerly; if the sidecar
    // reports `resolved: false` (the prompt was already torn down due to
    // cancel / SDK abort) we treat it as a no-op.
    async resolvePermission(
      decision: 'allow' | 'deny',
      opts?: { alwaysAllow?: boolean; updatedInput?: Record<string, unknown> },
    ): Promise<void> {
      const pending = this.pendingPermission
      if (!pending) return
      this.pendingPermission = null
      // Decision made → the turn resumes; bank the wait span (the tool now runs,
      // which is working time, not waiting).
      this.exitPark(pending.messageId)
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        const payload: Record<string, unknown> = {
          requestId: pending.requestId,
          decision,
        }
        if (opts?.alwaysAllow) payload.alwaysAllow = true
        if (opts?.updatedInput) payload.updatedInput = opts.updatedInput
        await sidecar.request('sessions.permission', payload)
      } catch (err) {
        console.warn('[sessions] resolvePermission failed', err)
      }
    },

    // Approve / reject a proposed plan (an ExitPlanMode `kind:'plan'` step).
    // Decoupled from the permission gate: the plan ran read-only, so this just
    // records the decision on the step, then — on approve — flips the session
    // to execute mode (visible on the composer chip + persisted) and sends a
    // continuation turn so the model carries the plan out.
    resolvePlan(sessionId: string, stepId: string, decision: 'approve' | 'reject') {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      let target: SessionStep | undefined
      for (let mi = session.messages.length - 1; mi >= 0 && !target; mi -= 1) {
        target = session.messages[mi]?.steps?.find((s) => s.id === stepId && s.kind === 'plan')
      }
      // Ignore stale clicks: already decided, or step not found.
      if (!target || (target.planStatus && target.planStatus !== 'pending')) return
      if (decision === 'reject') {
        target.planStatus = 'rejected'
        return
      }
      target.planStatus = 'approved'
      this.updateSettings(sessionId, { mode: 'execute' })
      void this.sendMessage(
        sessionId,
        'The plan is approved. Proceed to implement it now, following the plan.',
      )
    },

    // Answer an AskUserQuestion step (kind === 'question'). Mid-turn park: the
    // agent loop is blocked in the tool's execute() waiting on this — we send the
    // chosen answers to the sidecar (sessions.answerQuestion), which resolves the
    // parked promise so the SAME turn continues. Optimistically mark the step
    // done so the card flips to its read-only record immediately; the sidecar's
    // tool_execution_end step (same id) then confirms it.
    answerQuestion(sessionId: string, stepId: string, answers: SessionQuestionAnswer[]) {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      let target: SessionStep | undefined
      for (let mi = session.messages.length - 1; mi >= 0 && !target; mi -= 1) {
        target = session.messages[mi]?.steps?.find((s) => s.id === stepId && s.kind === 'question')
      }
      // Ignore stale clicks: already answered, or step not found. (steps and parts
      // share the same step object reference, so this mutation updates both.)
      if (!target || target.answers) return
      target.answers = answers
      target.status = 'done'
      // Answer submitted → the turn resumes; bank the wait span on the in-flight
      // message so its elapsed excludes the time spent waiting on the user.
      const activeId = this.activeMessageBySession[sessionId]
      if (activeId) this.exitPark(activeId)

      const sidecar = useSidecar()
      if (!sidecar.available) return
      sidecar.request('sessions.answerQuestion', { requestId: stepId, answers }).catch((err) => {
        console.warn('[sessions] answerQuestion failed', err)
      })
    },

    // Full-text search across every session's transcript (Cmd+K palette). Returns
    // matched messages with a snippet; empty in browser dev (no sidecar).
    async searchSessions(query: string): Promise<SessionSearchResult[]> {
      const q = query.trim()
      if (q.length < 2) return []
      const sidecar = useSidecar()
      if (!sidecar.available) return []
      try {
        const res = await sidecar.request<{ results: SessionSearchResult[] }>('sessions.search', {
          query: q,
        })
        return Array.isArray(res.results) ? res.results : []
      } catch (err) {
        console.warn('[sessions] search failed', err)
        return []
      }
    },

    // Open a search result: select its session + flag the message for the list to
    // scroll to. The caller navigates to /sessions.
    openSearchResult(sessionId: string, messageId: string) {
      this.selectedSessionId = sessionId
      this.pendingScrollMessageId = messageId
      // Ensure the transcript is loaded so the target message renders and the
      // list can scroll to it (the session may not have been opened before).
      void this.ensureSessionMessages(sessionId)
    },

    // Refresh the set of messages that have a workspace snapshot (ADR 0038).
    async loadSnapshotIds(sessionId: string): Promise<void> {
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        const res = await sidecar.request<{ messageIds: string[] }>('sessions.listSnapshots', {
          sessionId,
        })
        this.snapshotMessageIds[sessionId] = Array.isArray(res.messageIds) ? res.messageIds : []
      } catch (err) {
        console.warn('[sessions] listSnapshots failed', err)
      }
    },

    // Rewind a session to a message: truncate the conversation back to it AND ask
    // the sidecar to restore the workspace files to that turn's snapshot (if any
    // — conversation-only otherwise). Optimistic local truncate for instant
    // feedback; the sidecar persists the same truncate + does the file restore.
    async rewindTo(messageId: string): Promise<void> {
      const session = this.sessions.find((s) => s.messages.some((m) => m.id === messageId))
      if (!session) return
      const idx = session.messages.findIndex((m) => m.id === messageId)
      if (idx < 0) return
      if ((session.pendingAgentIds ?? []).includes(SIDECAR_PENDING_TAG)) return
      session.messages = session.messages.slice(0, idx + 1)
      session.updatedAt = nowIso()
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        await sidecar.request('sessions.rewind', {
          sessionId: session.id,
          messageId,
          ...(session.projectId ? { projectId: session.projectId } : {}),
        })
      } catch (err) {
        console.warn('[sessions] rewind failed', err)
      }
    },

    openSubagentDrawer(sessionId: string, messageId: string, stepId: string) {
      this.subagentDrawerRef = { sessionId, messageId, stepId }
    },

    closeSubagentDrawer() {
      this.subagentDrawerRef = null
    },

    async cancelMessage(sessionId: string): Promise<void> {
      const messageId = this.activeMessageBySession[sessionId]
      if (!messageId) return
      // Tear down any visible permission prompt for this turn so the modal
      // disappears immediately. The sidecar's abort listener also rejects the
      // parked promise as 'deny' for the SDK contract.
      if (
        this.pendingPermission &&
        this.pendingPermission.sessionId === sessionId &&
        this.pendingPermission.messageId === messageId
      ) {
        // Fire-and-forget: explicit deny RPC so the SDK unwinds without
        // waiting for the AbortController signal to propagate. We don't await
        // it because cancelMessage itself races with finalize.
        const { requestId } = this.pendingPermission
        this.pendingPermission = null
        const sidecarHere = useSidecar()
        if (sidecarHere.available) {
          sidecarHere.request('sessions.permission', { requestId, decision: 'deny' }).catch(() => {
            /* ignore — sidecar may already have rejected on abort */
          })
        }
      }
      const sidecar = useSidecar()
      try {
        await sidecar.request('sessions.cancel', { sessionId, messageId })
      } catch {
        // Race: stream may have settled between click and RPC. Either way the
        // finalize path will clean up; ignore the error.
      }
    },

    // Cancel every session that currently has an in-flight turn. Used by the
    // quota guard (auto-abort on threshold). Returns the count of turns it
    // targeted so the caller can tell the user how many were stopped.
    async cancelAllRunning(): Promise<number> {
      const ids = Object.keys(this.activeMessageBySession)
      await Promise.all(ids.map((id) => this.cancelMessage(id)))
      return ids.length
    },

    // Mid-turn steering (Session steering). Inject `text` into the session's
    // in-flight turn so the agent picks it up at its next step boundary. The
    // sidecar emits a `kind:'steer'` step that the running sendMessage's live
    // subscription folds into the agent timeline, so no optimistic insert is
    // needed here. Falls back to a normal send when no turn is in flight (the
    // composer only routes here while streaming, but the turn can settle between
    // the click and this call). Returns true when the steer landed on a turn.
    async sendSteer(sessionId: string, text: string): Promise<boolean> {
      const trimmed = text.trim()
      if (!trimmed) return false
      const messageId = this.activeMessageBySession[sessionId]
      if (!messageId) {
        await this.sendMessage(sessionId, trimmed)
        return false
      }
      const sidecar = useSidecar()
      if (!sidecar.available) return false
      try {
        const res = await sidecar.request<{ ok: boolean }>('sessions.steer', {
          sessionId,
          messageId,
          text: trimmed,
        })
        // Lost the race (turn finalized first) → send it as a normal turn so the
        // user's instruction isn't dropped.
        if (!res.ok) {
          await this.sendMessage(sessionId, trimmed)
          return false
        }
        return true
      } catch (err) {
        console.warn('[sessions] steer failed', err)
        return false
      }
    },

    // Queue a message to auto-send after the current turn finishes (FIFO). The
    // composer routes here via the send dropdown while a turn streams. Ephemeral
    // — not persisted; a reload drops the queue.
    enqueueMessage(
      sessionId: string,
      text: string,
      attachments?: SessionAttachment[],
      followUps?: SessionFollowUp[],
      commandInvocation?: string,
    ) {
      const trimmed = text.trim()
      if (!trimmed && !(attachments && attachments.length)) return
      const item: SessionQueuedMessage = { id: newId('q'), text: trimmed }
      if (attachments && attachments.length) item.attachments = [...attachments]
      if (followUps && followUps.length) item.followUps = [...followUps]
      if (commandInvocation) item.commandInvocation = commandInvocation
      const queue = this.queues[sessionId] ?? []
      this.queues[sessionId] = [...queue, item]
    },

    removeQueued(sessionId: string, id: string) {
      const queue = this.queues[sessionId]
      if (!queue) return
      const next = queue.filter((q) => q.id !== id)
      if (next.length) this.queues[sessionId] = next
      else delete this.queues[sessionId]
    },

    clearQueue(sessionId: string) {
      if (this.queues[sessionId]) delete this.queues[sessionId]
    },

    // ── Park-time tracking (item 1): exclude human-wait from displayed elapsed ─
    // A turn that calls AskUserQuestion or hits a permission prompt blocks on the
    // user. enterPark stamps the start; exitPark adds the waited span to the
    // message's `waitingMs`, which SessionMessageItem subtracts from the elapsed.
    // Mirrors the sidecar's own measurement (which persists waitingMs for reload).
    enterPark(messageId: string) {
      if (!this.parkStartedAt[messageId]) this.parkStartedAt[messageId] = Date.now()
    },

    exitPark(messageId: string) {
      const start = this.parkStartedAt[messageId]
      if (!start) return
      delete this.parkStartedAt[messageId]
      for (const s of this.sessions) {
        const msg = s.messages.find((m) => m.id === messageId)
        if (msg) {
          msg.waitingMs = (msg.waitingMs ?? 0) + (Date.now() - start)
          return
        }
      }
    },

    // Pop the oldest queued message and send it as a fresh turn. Called after a
    // turn finalizes (sendMessage's onRevealDone); the recursive sendMessage
    // flushes the next on its own completion, draining the queue FIFO. No-op
    // while a turn is still streaming (defensive — never overlap turns).
    flushQueueHead(sessionId: string) {
      if (this.isSessionStreaming(sessionId)) return
      const queue = this.queues[sessionId]
      if (!queue || queue.length === 0) return
      const [head, ...rest] = queue
      if (rest.length) this.queues[sessionId] = rest
      else delete this.queues[sessionId]
      if (!head) return
      void this.sendMessage(
        sessionId,
        head.text,
        head.attachments,
        head.followUps,
        head.commandInvocation,
      )
    },

    // `/compact` — summarise older turns to free context (ADR 0047). Runs through
    // the SAME running-state machinery as a normal turn (placeholder bubble +
    // pending tag + active message id) so the composer shows the spinner + Stop,
    // and the Stop button can abort the compaction RPC. On success the summary
    // surfaces as a marker via session.compaction (not a reply bubble) and the
    // full transcript stays visible.
    async compactSession(
      sessionId: string,
      opts?: { keepRecentTokens?: number },
    ): Promise<'compacted' | 'nothing' | 'busy' | 'unavailable' | 'error'> {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return 'error'
      // Don't stack onto an in-flight turn / compaction.
      if ((session.pendingAgentIds ?? []).includes(SIDECAR_PENDING_TAG)) return 'busy'

      const sidecar = useSidecar()
      if (!sidecar.available) return 'unavailable'

      // Drive the normal running state. The placeholder is an empty agent bubble
      // (same shape sendMessage uses) → the UI renders the loading spinner. We
      // remove it on completion; the summary is rendered from session.compaction.
      const placeholderId = newId('m')
      session.messages.push({
        id: placeholderId,
        role: 'agent',
        text: '',
        at: nowIso(),
        startedAt: Date.now(),
      })
      session.pendingAgentIds = [
        ...new Set([...(session.pendingAgentIds ?? []), SIDECAR_PENDING_TAG]),
      ]
      session.updatedAt = nowIso()
      this.activeMessageBySession[sessionId] = placeholderId

      const cleanup = () => {
        const s = this.sessions.find((x) => x.id === sessionId)
        if (!s) return
        const idx = s.messages.findIndex((m) => m.id === placeholderId)
        if (idx >= 0) s.messages.splice(idx, 1)
        s.pendingAgentIds = (s.pendingAgentIds ?? []).filter((a) => a !== SIDECAR_PENDING_TAG)
        if (this.activeMessageBySession[sessionId] === placeholderId) {
          delete this.activeMessageBySession[sessionId]
        }
        s.updatedAt = nowIso()
      }

      try {
        const res = await sidecar.request<{
          ok: boolean
          reason?: string
          compaction?: SessionCompaction
        }>('sessions.compact', {
          sessionId,
          // Lets sessions.cancel abort this compaction (Stop button).
          messageId: placeholderId,
          provider: session.settings.provider,
          modelId: session.settings.modelId,
          ...(session.settings.accountId ? { accountId: session.settings.accountId } : {}),
          ...(session.projectId ? { projectId: session.projectId } : {}),
          ...(opts?.keepRecentTokens !== undefined
            ? { keepRecentTokens: opts.keepRecentTokens }
            : {}),
        })
        if (res.ok && res.compaction) {
          const s = this.sessions.find((x) => x.id === sessionId)
          if (s) s.compaction = res.compaction
          return 'compacted'
        }
        return 'nothing'
      } catch (err) {
        console.warn('[sessions] compact failed', err)
        return 'error'
      } finally {
        cleanup()
      }
    },

    // Ask the sidecar to summarize the first exchange into a concise title and
    // rename the session to it. Best-effort: on any failure the crude
    // first-message title set in sendMessage stays. Fired once, after the first
    // assistant reply has finalized + persisted.
    async autoGenerateTitle(sessionId: string): Promise<void> {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        const res = await sidecar.request<{ ok: boolean; title?: string }>(
          'sessions.generateTitle',
          {
            sessionId,
            provider: session.settings.provider,
            modelId: session.settings.modelId,
            ...(session.settings.accountId ? { accountId: session.settings.accountId } : {}),
          },
        )
        if (res.ok && res.title) this.renameSession(sessionId, res.title)
      } catch (err) {
        console.warn('[sessions] generateTitle failed', err)
      }
    },

    // Ask the sidecar to rewrite the composer draft into a clearer, more
    // specific prompt (one-shot, no turn created). Returns the enhanced text;
    // the composer keeps the original for one-click undo. Throws on failure so
    // the composer can surface a notice and keep the draft untouched.
    async enhancePrompt(sessionId: string, text: string): Promise<string> {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) throw new Error('Session not found')
      const sidecar = useSidecar()
      if (!sidecar.available) throw new Error('Sidecar not available')
      const res = await sidecar.request<{ text: string }>('sessions.enhancePrompt', {
        text,
        provider: session.settings.provider,
        modelId: session.settings.modelId,
        ...(session.settings.accountId ? { accountId: session.settings.accountId } : {}),
      })
      return res.text
    },
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSessionsStore, import.meta.hot))
}
