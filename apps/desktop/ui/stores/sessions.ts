import { defineStore, acceptHMRUpdate } from 'pinia'
import type {
  Session,
  SessionAttachment,
  SessionFollowUp,
  SessionMention,
  SessionMessage,
  SessionMessagePart,
  SessionQuestionAnswer,
  SessionSettings,
  SessionStep,
  SessionTokenKind,
} from '~/types'
import { useWorkspaceStore } from '~/stores/workspace'
import { useSettingsStore } from '~/stores/settings'
import { nowIso } from '~/utils/time'
import { notify } from '~/utils/notify'

// Tag used in `pendingAgentIds` to mark a reply pending from the sidecar/provider
// (no agent persona mapping yet — M7 will reintroduce agent personas).
const SIDECAR_PENDING_TAG = 'sidecar'

interface SidecarSendMessageResult {
  messageId: string
  text: string
  modelUsed: string
  usage: { input_tokens: number; output_tokens: number }
  stopReason: string | null
  // Ordered timeline built by the sidecar (ADR 0032). Stored as the authoritative
  // message.parts on finalize; absent for a non-streaming reply with no steps.
  parts?: SessionMessagePart[]
}

interface SessionsListResponse {
  sessions: Session[]
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
    // Pending tool-use permission prompt. Singleton because canUseTool serialises
    // per turn — at most one prompt is on screen at a time. SessionPermissionDialog
    // watches this and renders when non-null.
    pendingPermission: null as PendingPermission | null,
    // Currently-open subagent (Task tool) drawer reference. Stored as
    // {sessionId, messageId, stepId} (not the step object itself) so the
    // drawer re-renders when the underlying step transitions running → done
    // and its detail updates from prompt to reply.
    subagentDrawerRef: null as { sessionId: string; messageId: string; stepId: string } | null,
    // True once sessions have been loaded from the sidecar. Guards
    // hydrateFromSidecar so navigating away and back never re-loads (and
    // clobbers) the store — the store is the live source of truth for the app
    // lifetime, including any in-flight streaming turn that keeps running while
    // the user is on another page.
    hydrated: false,
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
        const list = Array.isArray(res.sessions) ? res.sessions : []
        // Persisted steps come back flat (subagent children carry `parentId`).
        // Re-nest before the data goes reactive so the live and reloaded views
        // render identically. Mutates the fresh-from-RPC objects in place.
        for (const session of list) {
          for (const message of session.messages) {
            if (message.steps?.length) message.steps = normalizeSteps(message.steps)
            // Parts persist flat too (subagent steps carry parentId) — re-nest so
            // the reloaded timeline renders identically to the live turn (ADR 0032).
            if (message.parts?.length) message.parts = normalizeParts(message.parts)
          }
        }
        this.sessions = list
        this.selectedSessionId = list[0]?.id ?? null
        this.hydrated = true
      } catch (err) {
        console.warn('[sessions] hydrateFromSidecar failed', err)
      }
    },

    selectSession(id: string | null) {
      this.selectedSessionId = id
    },

    createSession(data: CreateSessionInput): Session {
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
        settings: { ...DEFAULT_SETTINGS },
      }
      this.sessions.unshift(session)
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
      this.selectedSessionId = branch.id
      pushToSidecar('sessions.upsert', { session: branch, mode: 'create' })
      return branch.id
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
      if (this.selectedSessionId === id) {
        this.selectedSessionId = this.sessions[0]?.id ?? null
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
    ) {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      const trimmed = text.trim()
      if (!trimmed && !(attachments && attachments.length)) return

      // Auto-title: first user message in a still-default session becomes the
      // title. Strip newlines, cap at 60 chars with ellipsis so the sidebar
      // chip doesn't blow up.
      if (session.title === 'Untitled session' && session.messages.length === 0 && trimmed) {
        const oneLine = trimmed.replace(/\s+/g, ' ').trim()
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
      const systemPrompt = settingsStore.defaults?.systemPrompt || undefined

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
            },
            // Authoritative ordered timeline (ADR 0032). Undefined → finalize keeps
            // the derive path (legacy / non-streaming reply with no steps).
            ...(result.parts ? { parts: result.parts } : {}),
          })
        // All deltas have streamed into the live parts by now — just let the
        // typewriter finish revealing the trailing text run, then finalize (which
        // adopts the sidecar's authoritative parts + the full text, an invisible
        // swap since the revealed content already matches).
        textCompleted = true
        onRevealDone = doFinalize
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
          let message: string
          if (err instanceof SidecarUnavailableError) {
            message = 'Sidecar unavailable — running in browser dev'
          } else if (err instanceof SidecarError) {
            message = err.message
          } else if (err instanceof Error) {
            message = err.message
          } else {
            message = 'Unknown error'
          }
          finalize({
            id: placeholderId,
            role: 'system',
            text: `[error] ${message}`,
            at: nowIso(),
          })
        }
      } finally {
        if (unlisten) unlisten()
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

      const sidecar = useSidecar()
      if (!sidecar.available) return
      sidecar.request('sessions.answerQuestion', { requestId: stepId, answers }).catch((err) => {
        console.warn('[sessions] answerQuestion failed', err)
      })
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

    // `/compact` — ask the sidecar to run the SDK's context compaction on this
    // session (ADR 0023). Dedicated path (not sendMessage) so no `/compact` user
    // bubble appears; we show a transient system note instead. The sidecar also
    // appends a canonical note to the JSONL, which replaces ours on next hydrate.
    async compactSession(sessionId: string): Promise<void> {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      const noteId = newId('m')
      session.messages.push({
        id: noteId,
        role: 'system',
        text: 'Compacting context…',
        at: nowIso(),
      })
      session.updatedAt = nowIso()
      const noteById = (): SessionMessage | undefined =>
        this.sessions.find((s) => s.id === sessionId)?.messages.find((m) => m.id === noteId)

      const sidecar = useSidecar()
      if (!sidecar.available) {
        const n = noteById()
        if (n) n.text = 'Compact requires the desktop app.'
        return
      }
      try {
        const res = await sidecar.request<{ ok: boolean; reason?: string }>('sessions.compact', {
          sessionId,
          provider: session.settings.provider,
          modelId: session.settings.modelId,
          ...(session.settings.accountId ? { accountId: session.settings.accountId } : {}),
          ...(session.projectId ? { projectId: session.projectId } : {}),
        })
        const n = noteById()
        if (n) {
          n.text = res.ok
            ? 'Context compacted to free up token budget.'
            : 'Nothing to compact yet — send a message first.'
        }
      } catch (err) {
        const n = noteById()
        if (n) n.text = 'Compact failed.'

        console.warn('[sessions] compact failed', err)
      }
    },
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSessionsStore, import.meta.hot))
}
