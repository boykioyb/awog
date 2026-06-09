import { defineStore, acceptHMRUpdate } from 'pinia'
import type {
  Session,
  SessionAttachment,
  SessionFollowUp,
  SessionMention,
  SessionMessage,
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

        s.pendingAgentIds = (s.pendingAgentIds ?? []).filter((a) => a !== SIDECAR_PENDING_TAG)
        s.updatedAt = nowIso()
      }

      // Smooth typewriter drain. Anthropic emits text deltas in uneven chunks
      // (1 char ↔ 80+ chars); pushing each chunk straight to the DOM makes the
      // render feel staccato. Buffer incoming text and drain it on
      // requestAnimationFrame at an adaptive rate (faster when buffer is full,
      // slower when nearly empty) so the eye sees a steady stream.
      let pending = ''
      let raf = 0
      const sessionsRef = this.sessions
      const stillOurSlot = (): SessionMessage | null => {
        const s = sessionsRef.find((x) => x.id === sessionId)
        if (!s) return null
        const slot = s.messages[placeholderIdx]
        if (!slot || slot.id !== placeholderId) return null
        return slot
      }
      const drain = () => {
        raf = 0
        const slot = stillOurSlot()
        if (!slot) {
          pending = ''
          return
        }
        if (!pending) return
        // Adaptive: drain ~1/6 of buffer per frame, minimum 2 chars, so a long
        // burst doesn't lag while short typing stays smooth.
        const take = Math.max(2, Math.ceil(pending.length / 6))
        slot.text = (slot.text ?? '') + pending.slice(0, take)
        pending = pending.slice(take)
        if (pending) raf = requestAnimationFrame(drain)
      }
      const appendDelta = (delta: string) => {
        if (!stillOurSlot()) return
        pending += delta
        if (!raf) raf = requestAnimationFrame(drain)
      }
      const flushBuffer = () => {
        if (raf) {
          cancelAnimationFrame(raf)
          raf = 0
        }
        const slot = stillOurSlot()
        if (slot && pending) slot.text = (slot.text ?? '') + pending
        pending = ''
      }

      // Upsert a tool step. Running → done transitions land as a second event
      // with the same id; we merge in place so the keyed v-for re-renders
      // without resetting collapsed/selected UI state. Steps with `parentId`
      // are nested under the parent Task step's children (subagent grouping).
      const findStepById = (arr: SessionStep[], id: string): SessionStep | null => {
        for (let i = 0; i < arr.length; i += 1) {
          const s = arr[i]
          if (!s) continue
          if (s.id === id) return s
          if (s.children?.length) {
            const inner = findStepById(s.children, id)
            if (inner) return inner
          }
        }
        return null
      }
      const upsertStep = (step: SessionStep) => {
        const slot = stillOurSlot()
        if (!slot) return
        const existing = slot.steps ?? []

        // Subagent step → attach under parent's children. If parent isn't
        // tracked yet (race: child event arriving before parent's tool_use
        // snapshot), fall back to top-level so it isn't lost.
        if (step.parentId) {
          const parent = findStepById(existing, step.parentId)
          if (parent) {
            const kids = parent.children ?? []
            const cidx = kids.findIndex((c) => c.id === step.id)
            if (cidx >= 0) {
              parent.children = [
                ...kids.slice(0, cidx),
                { ...kids[cidx], ...step },
                ...kids.slice(cidx + 1),
              ]
            } else {
              parent.children = [...kids, step]
            }
            return
          }
        }

        const idx = existing.findIndex((s) => s.id === step.id)
        if (idx >= 0) {
          const next = [...existing]
          // Merge so the second event (done) can omit fields the first (running)
          // already populated — e.g. target derived from the partial input. The
          // incoming event never carries textOffset, so the stamped value below
          // survives the merge (existing first).
          next[idx] = { ...existing[idx], ...step }
          slot.steps = next
        } else {
          // First sighting of a top-level step. Flush any buffered text so the
          // boundary captures everything streamed before the tool fired, then
          // stamp the offset. SessionMessageItem reads textOffset to interleave
          // step rows with reply-text segments in chronological order.
          flushBuffer()
          const stamped =
            step.textOffset === undefined ? { ...step, textOffset: (slot.text ?? '').length } : step
          slot.steps = [...existing, stamped]
        }
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
        // Keep placeholderId as the final id — stable key for Vue lists, no diff churn.
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
        })
        // result.text is the authoritative full reply. Drop whatever is still
        // sitting in the typewriter buffer so the finally-block flushBuffer()
        // can't re-append it on top of the complete text (duplicated tail —
        // or the whole message when no drain frame ran before the RPC resolved).
        pending = ''
      } catch (err) {
        const isCanceled = err instanceof SidecarError && err.code === -32023
        if (isCanceled) {
          // User-initiated stop. Keep whatever text already streamed into the
          // placeholder, mark the turn complete + flag it as canceled.
          const s = this.sessions.find((x) => x.id === sessionId)
          const slot = s?.messages[placeholderIdx]
          const partialText = slot?.id === placeholderId ? (slot.text ?? '') : ''
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
          // The error line replaces the bubble — discard buffered stream so
          // flushBuffer() doesn't append leftover deltas onto the error text.
          pending = ''
        }
      } finally {
        flushBuffer()
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
