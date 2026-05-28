import { defineStore, acceptHMRUpdate } from 'pinia'
import type {
  Session,
  SessionAttachment,
  SessionMention,
  SessionMessage,
  SessionSettings,
  SessionStep,
  SessionTokenKind,
} from '~/types'
import { MOCK_SESSIONS } from '~/utils/initial-sessions'
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
    // eslint-disable-next-line no-console
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
  modelId: 'claude-opus-4-7',
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
  // eslint-disable-next-line no-cond-assign
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
      const sidecar = useSidecar()
      if (!sidecar.available) {
        // Browser dev: no sidecar — seed mock data so the UI is browsable.
        if (this.sessions.length === 0) {
          this.sessions = [...MOCK_SESSIONS]
          this.selectedSessionId = this.sessions[0]?.id ?? null
        }
        return
      }
      try {
        const res = await sidecar.request<SessionsListResponse>('sessions.list')
        const list = Array.isArray(res.sessions) ? res.sessions : []
        this.sessions = list
        this.selectedSessionId = list[0]?.id ?? null
      } catch (err) {
        // eslint-disable-next-line no-console
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

    updateSettings(sessionId: string, patch: Partial<SessionSettings>) {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      session.settings = { ...session.settings, ...patch }
      pushToSidecar('sessions.upsert', { session, mode: 'update-metadata' })
    },

    setDisabledTools(sessionId: string, names: string[]) {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      session.disabledTools = names.length ? [...names] : []
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

    async sendMessage(sessionId: string, text: string, attachments?: SessionAttachment[]) {
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

      // Replace placeholder by direct index (captured at push time) to avoid any
      // chance of finalize() touching an earlier message with a colliding id.
      const finalize = (next: SessionMessage) => {
        const s = this.sessions.find((x) => x.id === sessionId)
        if (!s) return
        const slot = s.messages[placeholderIdx]
        if (slot && slot.id === placeholderId) {
          s.messages[placeholderIdx] = next
        } else {
          const idx = s.messages.findIndex((m) => m.id === placeholderId)
          if (idx >= 0) s.messages[idx] = next
        }
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

      // Upsert a tool step into the placeholder bubble by step.id. Running →
      // done transitions land as a second event with the same id; we replace
      // the slot in place so Vue's keyed v-for re-renders without resetting
      // collapsed/selected UI state.
      const upsertStep = (step: SessionStep) => {
        const slot = stillOurSlot()
        if (!slot) return
        const existing = slot.steps ?? []
        const idx = existing.findIndex((s) => s.id === step.id)
        if (idx >= 0) {
          const next = [...existing]
          // Merge so the second event (done) can omit fields the first (running)
          // already populated — e.g. target derived from the partial input.
          next[idx] = { ...existing[idx], ...step }
          slot.steps = next
        } else {
          slot.steps = [...existing, step]
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
            const label = evt.payload.step.label
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
              void notify({
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
        // eslint-disable-next-line no-console
        console.warn('[sessions] resolvePermission failed', err)
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
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSessionsStore, import.meta.hot))
}
