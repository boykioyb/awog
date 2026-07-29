import { ref, watch } from 'vue'
import { gateway } from './gateway'
import { errMsg, randomId } from './util'
import type {
  EngineMessage,
  FullSession,
  GatewayEvent,
  MessageDonePayload,
  PermissionRequestPayload,
  SessionChunkPayload,
  SessionQuestionAnswer,
  SessionStep,
  SessionStepPayload,
  SessionSummary,
} from './types'

// App-level reactive state + actions. A thin single-store module (no Pinia — this
// is a standalone Vite app). Wires gateway events into the open session and drives
// reconnect resume via gateway.readySignal.

export type Route = 'list' | 'session'

export type Block = { kind: 'text'; text: string } | { kind: 'step'; step: SessionStep }

export interface UiMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  blocks: Block[]
  streaming: boolean
  error?: string
}

export interface CurrentSession {
  id: string
  title: string
  projectId: string | null
  loading: boolean
  error: string | null
  messages: UiMessage[]
  permission: PermissionRequestPayload | null
}

export const route = ref<Route>('list')

export const sessionList = ref<SessionSummary[]>([])
export const activeTurnIds = ref<Set<string>>(new Set())
export const listLoading = ref(false)
export const listError = ref<string | null>(null)

export const current = ref<CurrentSession | null>(null)

// Bumped when a turn settles for the open session, so the Diff/Cost panels refetch
// without a manual refresh (AC-VIEW-4).
export const turnDoneSignal = ref(0)

// ─── List ─────────────────────────────────────────────────────────────────

export async function loadSessions(): Promise<void> {
  listLoading.value = true
  listError.value = null
  try {
    const [list, active] = await Promise.all([
      gateway.request<{ sessions: SessionSummary[] }>('sessions.list', {}),
      gateway
        .request<{ sessions: { engineId: string }[] }>('sessions.activeTurns', {})
        .catch(() => ({ sessions: [] as { engineId: string }[] })),
    ])
    sessionList.value = list.sessions
    activeTurnIds.value = new Set(active.sessions.map((s) => s.engineId))
  } catch (e) {
    listError.value = errMsg(e)
  } finally {
    listLoading.value = false
  }
}

// ─── Open / render a session ────────────────────────────────────────────────

function isSubagentStep(step: SessionStep): boolean {
  return typeof step.parentId === 'string' && step.parentId.length > 0
}

function engineMessageToUi(m: EngineMessage): UiMessage {
  if (m.role !== 'agent') {
    return {
      id: m.id,
      role: m.role,
      blocks: [{ kind: 'text', text: m.text }],
      streaming: false,
      ...(m.error ? { error: m.error.message } : {}),
    }
  }
  const blocks: Block[] = []
  if (m.parts && m.parts.length) {
    for (const p of m.parts) {
      if (p.kind === 'text') {
        if (p.text) blocks.push({ kind: 'text', text: p.text })
      } else if (!isSubagentStep(p)) {
        blocks.push({ kind: 'step', step: p })
      }
    }
  } else {
    if (m.text) blocks.push({ kind: 'text', text: m.text })
    for (const s of m.steps ?? []) if (!isSubagentStep(s)) blocks.push({ kind: 'step', step: s })
  }
  return {
    id: m.id,
    role: 'agent',
    blocks,
    streaming: false,
    ...(m.error ? { error: m.error.message } : {}),
  }
}

export function openSession(summary: SessionSummary): void {
  const existing = current.value
  if (existing) gateway.unsubscribe(existing.id)
  current.value = {
    id: summary.id,
    title: summary.title,
    projectId: summary.projectId,
    loading: true,
    error: null,
    messages: [],
    permission: null,
  }
  route.value = 'session'
  gateway.subscribe(summary.id)
  void refetchCurrent()
}

export function closeSession(): void {
  const cur = current.value
  if (cur) gateway.unsubscribe(cur.id)
  current.value = null
  route.value = 'list'
  void loadSessions()
}

export async function refetchCurrent(): Promise<void> {
  const cur = current.value
  if (!cur) return
  try {
    const { session } = await gateway.request<{ session: FullSession | null }>('sessions.get', {
      sessionId: cur.id,
    })
    if (!session) {
      cur.error = 'Không tìm thấy session'
      cur.loading = false
      return
    }
    cur.title = session.title
    cur.projectId = session.projectId
    cur.messages = session.messages.map(engineMessageToUi)
    cur.error = null
    cur.loading = false
    // A full refetch is the source of truth: any gate resolved elsewhere is gone.
    cur.permission = null
  } catch (e) {
    cur.error = errMsg(e)
    cur.loading = false
  }
}

// ─── Send ───────────────────────────────────────────────────────────────────

interface SendResult {
  messageId?: string
  text?: string
}

async function runTurn(text: string, mode?: 'execute'): Promise<void> {
  const cur = current.value
  if (!cur) return
  const messageId = randomId()
  cur.messages.push({
    id: `u-${messageId}`,
    role: 'user',
    blocks: [{ kind: 'text', text }],
    streaming: false,
  })
  const agent: UiMessage = { id: messageId, role: 'agent', blocks: [], streaming: true }
  cur.messages.push(agent)
  try {
    const res = await gateway.request<SendResult>('sessions.sendMessage', {
      sessionId: cur.id,
      messageId,
      text,
      ...(mode ? { settings: { mode } } : {}),
    })
    finalizeAgent(agent, res.text)
  } catch (e) {
    agent.streaming = false
    agent.error = errMsg(e)
  } finally {
    turnDoneSignal.value++
  }
}

export function sendMessage(text: string): void {
  const trimmed = text.trim()
  if (!trimmed || !current.value) return
  void runTurn(trimmed)
}

function finalizeAgent(agent: UiMessage, text?: string): void {
  agent.streaming = false
  const hasText = agent.blocks.some((b) => b.kind === 'text' && b.text.trim().length > 0)
  if (text && !hasText) agent.blocks.push({ kind: 'text', text })
}

// ─── Gates ──────────────────────────────────────────────────────────────────

export function resolvePermission(decision: 'allow' | 'deny'): void {
  const cur = current.value
  if (!cur || !cur.permission) return
  const { requestId } = cur.permission
  cur.permission = null
  gateway.request('sessions.permission', { requestId, decision }).catch(() => {
    // Idempotent: a gate resolved elsewhere returns an error / resolved:false —
    // the card is already dismissed, nothing to undo.
  })
}

// Approve a plan: reuse sessions.sendMessage with a continuation prompt + execute
// mode (mirrors desktop stores/sessions.ts approvePlan).
export function approvePlan(step: SessionStep): void {
  step.planStatus = 'approved'
  void runTurn('The plan is approved. Proceed to implement it now, following the plan.', 'execute')
}

export function rejectPlan(step: SessionStep): void {
  // No RPC — the session simply stays in plan mode (AC-GATE-3). Dismiss the card.
  step.planStatus = 'rejected'
}

export function answerQuestion(step: SessionStep, answers: SessionQuestionAnswer[]): void {
  step.answers = answers
  // requestId for AskUserQuestion == the step id (see ui-next answerQuestion).
  gateway.request('sessions.answerQuestion', { requestId: step.id, answers }).catch(() => {})
}

// ─── Live event wiring ───────────────────────────────────────────────────────

function ensureAgent(cur: CurrentSession, messageId: string): UiMessage {
  const found = cur.messages.find((m) => m.role === 'agent' && m.id === messageId)
  if (found) return found
  const agent: UiMessage = { id: messageId, role: 'agent', blocks: [], streaming: true }
  cur.messages.push(agent)
  return agent
}

function appendDelta(cur: CurrentSession, messageId: string, delta: string): void {
  const agent = ensureAgent(cur, messageId)
  agent.streaming = true
  const last = agent.blocks[agent.blocks.length - 1]
  if (last && last.kind === 'text') last.text += delta
  else agent.blocks.push({ kind: 'text', text: delta })
}

function upsertStep(cur: CurrentSession, messageId: string, step: SessionStep): void {
  if (isSubagentStep(step)) return
  const agent = ensureAgent(cur, messageId)
  const idx = agent.blocks.findIndex((b) => b.kind === 'step' && b.step.id === step.id)
  if (idx >= 0) agent.blocks[idx] = { kind: 'step', step }
  else agent.blocks.push({ kind: 'step', step })
}

function onGatewayEvent(evt: GatewayEvent): void {
  const cur = current.value
  const payload = evt.payload as { sessionId?: string } | undefined
  if (!cur || !payload || payload.sessionId !== cur.id) return
  switch (evt.type) {
    case 'session.chunk': {
      const p = evt.payload as SessionChunkPayload
      appendDelta(cur, p.messageId, p.delta)
      return
    }
    case 'session.step': {
      const p = evt.payload as SessionStepPayload
      upsertStep(cur, p.messageId, p.step)
      return
    }
    case 'session.permission-request': {
      cur.permission = evt.payload as PermissionRequestPayload
      return
    }
    case 'session.message.done': {
      const p = evt.payload as MessageDonePayload
      const agent = cur.messages.find((m) => m.role === 'agent' && m.id === p.messageId)
      if (agent) {
        agent.streaming = false
        if (p.errorMessage) agent.error = p.errorMessage
        finalizeAgent(agent, p.text)
      }
      turnDoneSignal.value++
      return
    }
    default:
      return
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

let started = false

export function initStore(): void {
  if (started) return
  started = true
  gateway.onEvent(onGatewayEvent)
  // Each transition into 'ready' (first connect + every reconnect) refreshes the
  // list and re-hydrates the open session (full refetch resume — AC-RES-1/2).
  watch(
    () => gateway.readySignal.value,
    () => {
      void loadSessions()
      if (current.value) void refetchCurrent()
    },
  )
}
