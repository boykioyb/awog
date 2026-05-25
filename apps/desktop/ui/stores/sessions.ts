import { defineStore } from 'pinia'
import type {
  Session,
  SessionAttachment,
  SessionMention,
  SessionMessage,
  SessionSettings,
  SessionTokenKind,
} from '~/types'
import { INITIAL_SESSIONS } from '~/utils/initial-sessions'
import { useWorkspaceStore } from '~/stores/workspace'

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

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}`

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
    sessions: [...INITIAL_SESSIONS] as Session[],
    selectedSessionId: (INITIAL_SESSIONS[0]?.id ?? null) as string | null,
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
    selectSession(id: string | null) {
      this.selectedSessionId = id
    },

    createSession(data: CreateSessionInput): Session {
      const session: Session = {
        id: newId('ses'),
        title: data.title || 'Untitled session',
        projectId: data.projectId,
        createdAt: 'Just now',
        updatedAt: 'Just now',
        invitedAgentIds: [],
        messages: [],
        pendingAgentIds: [],
        settings: { ...DEFAULT_SETTINGS },
      }
      this.sessions.unshift(session)
      this.selectedSessionId = session.id
      return session
    },

    updateSettings(sessionId: string, patch: Partial<SessionSettings>) {
      const session = this.sessions.find((s) => s.id === sessionId)
      if (!session) return
      session.settings = { ...session.settings, ...patch }
    },

    deleteSession(id: string) {
      this.sessions = this.sessions.filter((s) => s.id !== id)
      if (this.selectedSessionId === id) {
        this.selectedSessionId = this.sessions[0]?.id ?? null
      }
    },

    renameSession(id: string, title: string) {
      const session = this.sessions.find((s) => s.id === id)
      if (session) session.title = title
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
        at: 'Just now',
      })
      session.updatedAt = 'Just now'
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
        at: 'Just now',
      })
      session.updatedAt = 'Just now'
    },

    sendMessage(sessionId: string, text: string, attachments?: SessionAttachment[]) {
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

      const userMsg: SessionMessage = {
        id: newId('m'),
        role: 'user',
        text: trimmed,
        at: 'Just now',
        mentions: mentions.length ? mentions : undefined,
        attachments: attachments && attachments.length ? attachments : undefined,
        modeAtSend: session.settings.mode,
      }
      session.messages.push(userMsg)
      session.updatedAt = 'Just now'

      const respondingAgentIds = new Set<string>()
      mentions.forEach((m) => {
        if (m.kind === 'agent') respondingAgentIds.add(m.targetId)
      })
      mentions.forEach((m) => {
        if (m.kind === 'agent' && !session.invitedAgentIds.includes(m.targetId)) {
          session.invitedAgentIds.push(m.targetId)
        }
      })

      if (respondingAgentIds.size === 0) return

      const ids = Array.from(respondingAgentIds)
      session.pendingAgentIds = [...new Set([...session.pendingAgentIds, ...ids])]

      ids.forEach((agentId, i) => {
        setTimeout(
          () => {
            const s = this.sessions.find((x) => x.id === sessionId)
            if (!s) return
            const agent = workspace.agentById(agentId)
            s.messages.push({
              id: newId('m'),
              role: 'agent',
              agentId,
              text: agent
                ? `(${agent.role}) Mình đã đọc. Đây là góc nhìn ban đầu — bạn muốn mình đào sâu khía cạnh nào?`
                : 'Đang xử lý...',
              at: 'Just now',
            })
            s.pendingAgentIds = s.pendingAgentIds.filter((id) => id !== agentId)
            s.updatedAt = 'Just now'
          },
          1200 + i * 400,
        )
      })
    },
  },
})
