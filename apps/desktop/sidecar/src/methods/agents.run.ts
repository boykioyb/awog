import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadAgent } from '../agents/store.js'
import { createSession, flushSession, setSessionAgent } from '../sessions/store.js'
import { mintSessionId } from '../sessions/spawn.js'
import { emit } from '../transport/stdio.js'
import type { Session, SessionAgentRef, SessionSettings, SessionSummary } from '../types/shared.js'

// agents.run — DISPATCH một agent thành phiên thật (session-teams §9, kiểu
// "giao issue cho agent" của Multica): agent là spec bền, session là instance
// chạy do dispatch materialize — assignee của board item trỏ tới session này.
//
// Khác teams.run ở chỗ không có cây: một phiên lẻ, không member để điều
// phối, không teamId. Tin giao việc do CALLER (board
// editor) xếp vào inbox ngay sau — giống đường giao cho member có sẵn.
//
// `agent.projectId` = project SỞ HỮU spec khi source=project (nơi AGENT.md
// nằm); `projectId` còn lại là project ĐÍCH mà phiên chạy trên — một global
// agent giao việc được cho mọi project, project agent cũng chạy được cho
// project khác nếu user cố tình.

const SettingsSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string().min(1).max(200),
  level: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
  mode: z.enum(['ask', 'accept-edits', 'plan', 'execute']).optional(),
  accountId: z.string().max(64).optional(),
})

const Params = z.object({
  agent: z.object({
    id: z.string().min(1).max(120),
    source: z.enum(['global', 'project']).default('global'),
    projectId: z.string().min(1).max(64).optional(),
  }),
  projectId: z.string().min(1).max(64).nullable(),
  settings: SettingsSchema,
  // Tiêu đề phiên — mặc định lấy tên trong AGENT.md.
  title: z.string().max(200).optional(),
  // Nguồn gốc materialize — 'board' khi dispatch đi từ một board item
  // (materializeRef của renderer). Renderer ẩn các phiên board khỏi danh sách
  // session; "chat với agent" từ trang Agents KHÔNG gửi field này nên phiên đó
  // vẫn hiện như phiên chat thường.
  origin: z.enum(['board']).optional(),
})

const THINKING_DEFAULT = 'high' as const
const MODE_DEFAULT = 'execute' as const

register('agents.run', async (raw) => {
  const params = Params.parse(raw)
  const spec = await loadAgent(params.agent.id, params.agent.source, params.agent.projectId)
  if (!spec) {
    throw new RpcError(-32004, `Agent not found: ${params.agent.id}`, { code: 'unknown-agent' })
  }

  const agentRef: SessionAgentRef = {
    id: spec.id,
    source: params.agent.source,
    ...(params.agent.source === 'project' && params.agent.projectId
      ? { projectId: params.agent.projectId }
      : {}),
  }
  const now = new Date().toISOString()
  const sessionId = mintSessionId()
  const settings: SessionSettings = {
    provider: params.settings.provider,
    modelId: params.settings.modelId,
    level: params.settings.level ?? THINKING_DEFAULT,
    mode: params.settings.mode ?? MODE_DEFAULT,
    ...(params.settings.accountId ? { accountId: params.settings.accountId } : {}),
  }
  const session: Session = {
    id: sessionId,
    title: params.title?.trim() || spec.name,
    projectId: params.projectId,
    createdAt: now,
    updatedAt: now,
    invitedAgentIds: [],
    messages: [],
    pendingAgentIds: [],
    settings,
    ...(params.origin ? { origin: params.origin } : {}),
  }
  await createSession(session)

  // Bind agent TRƯỚC emit — session.created mang nguyên summary đã có vai.
  await setSessionAgent(sessionId, agentRef)

  const summary: SessionSummary = {
    id: sessionId,
    title: session.title,
    projectId: session.projectId,
    createdAt: now,
    updatedAt: now,
    status: 'idle',
    invitedAgentIds: [],
    pendingAgentIds: [],
    settings,
    messageCount: 0,
    agent: agentRef,
    ...(params.origin ? { origin: params.origin } : {}),
  }
  emit('session.created', { session: summary })
  await flushSession(sessionId)

  return { sessionId }
})
