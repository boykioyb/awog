import { defineStore, acceptHMRUpdate } from 'pinia'
import type {
  Session,
  SessionAttachment,
  SessionMention,
  SessionMessage,
  SessionSettings,
  SessionTokenKind,
} from '~/types'
import { MOCK_SESSIONS } from '~/utils/initial-sessions'
import { useWorkspaceStore } from '~/stores/workspace'
import { useSettingsStore } from '~/stores/settings'
import { nowIso } from '~/utils/time'

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
  }),

  getters: {
    selectedSession(state): Session | undefined {
      return state.sessions.find((s) => s.id === state.selectedSessionId)
    },
    sessionById:
      (state) =>
      (id: string): Session | undefined =>
        state.sessions.find((s) => s.id === id),
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

      // Mutate placeholder.text in-place during streaming so SessionMessageList re-renders
      // each chunk (Vue reactivity). RPC resolve still wins as source of truth at finalize.
      const appendDelta = (delta: string) => {
        const s = this.sessions.find((x) => x.id === sessionId)
        if (!s) return
        const slot = s.messages[placeholderIdx]
        // Drop event if placeholder was removed/replaced — avoids cross-write into a later msg.
        if (!slot || slot.id !== placeholderId) return
        slot.text = (slot.text ?? '') + delta
      }

      // Subscribe BEFORE invoking RPC so we don't miss the first chunk emitted on flush.
      // In browser dev (no Tauri shell) onEvent throws; we swallow and rely on request()
      // throwing the same SidecarUnavailableError to run the unified error path below.
      let unlisten: (() => void) | null = null
      try {
        unlisten = await sidecar.onEvent((evt) => {
          if (evt.type !== 'session.chunk') return
          if (!isSessionChunkPayload(evt.payload)) return
          if (evt.payload.sessionId !== sessionId) return
          if (evt.payload.messageId !== placeholderId) return
          appendDelta(evt.payload.delta)
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
      } finally {
        if (unlisten) unlisten()
      }
    },
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSessionsStore, import.meta.hot))
}
