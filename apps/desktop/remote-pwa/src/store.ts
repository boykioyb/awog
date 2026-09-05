import { computed, ref, watch } from 'vue'
import { gateway } from './gateway'
import { loadCatalog, toAgentMode } from './catalog'
import { buzz, notify, setBadge } from './notify'
import { errMsg, randomId } from './util'
import type {
  AgentMode,
  BackgroundDonePayload,
  BackgroundStartedPayload,
  EngineMessage,
  FullSession,
  GatewayEvent,
  MessageDonePayload,
  NewSessionInput,
  PermissionRequestPayload,
  SessionAttachment,
  SessionChunkPayload,
  SessionConfig,
  SessionQuestionAnswer,
  SessionSearchResult,
  SessionSettings,
  SessionStep,
  SessionStepPayload,
  SessionSummary,
  TodoItem,
  TodoStatus,
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
  attachments?: SessionAttachment[]
}

export interface BackgroundShell {
  shellId: string
  command: string
  status: 'running' | 'done'
  exitCode?: number | null
}


export interface CurrentSession {
  id: string
  title: string
  projectId: string | null
  loading: boolean
  error: string | null
  messages: UiMessage[]
  permission: PermissionRequestPayload | null
  // Authoritative checklist (ADR 0069) — the model writes it via TodoWrite, the
  // user via sessions.updateTodos; both are re-injected next turn.
  todos: TodoItem[]
  background: BackgroundShell[]
  settings: SessionSettings | null
  // Mode for the NEXT turn — all four desktop modes, including the ungated
  // `accept-edits`/`execute` (see catalog.ts AGENT_MODES). The gateway forwards
  // the choice as-is; only `autoApprove` stays pinned off.
  mode: AgentMode
  // messageId of the in-flight assistant turn — the steer/cancel target.
  streamingId: string | null
  // Messages typed while a turn we can't steer is running (we reconnected
  // mid-turn, so its messageId is unknown). Sent in order when the turn settles —
  // never as a parallel turn.
  pending: string[]
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

// Transient one-line feedback (send failed, session deleted, …).
export const toast = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

export function showToast(message: string): void {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = null
  }, 3200)
}

// Sessions resting at a human gate — drives the app badge + list chips.
export const awaitingCount = computed(
  () =>
    sessionList.value.filter((s) => s.status === 'awaiting').length +
    (current.value?.permission ? 1 : 0),
)

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

// ─── Search (sessions.search) ───────────────────────────────────────────────

export const searchResults = ref<SessionSearchResult[]>([])
export const searchLoading = ref(false)

let searchSeq = 0

export async function runSearch(query: string): Promise<void> {
  const q = query.trim()
  if (q.length < 2) {
    searchResults.value = []
    searchLoading.value = false
    return
  }
  const seq = ++searchSeq
  searchLoading.value = true
  try {
    const res = await gateway.request<{ results: SessionSearchResult[] }>('sessions.search', {
      query: q,
      limit: 50,
    })
    if (seq === searchSeq) searchResults.value = res.results
  } catch (e) {
    if (seq === searchSeq) {
      searchResults.value = []
      showToast(errMsg(e))
    }
  } finally {
    if (seq === searchSeq) searchLoading.value = false
  }
}

export function clearSearch(): void {
  searchSeq++
  searchResults.value = []
  searchLoading.value = false
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
      ...(m.attachments?.length ? { attachments: m.attachments } : {}),
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

function blankCurrent(id: string, title: string, projectId: string | null): CurrentSession {
  return {
    id,
    title,
    projectId,
    loading: true,
    error: null,
    messages: [],
    permission: null,
    todos: [],
    background: [],
    settings: null,
    mode: 'ask',
    streamingId: null,
    pending: [],
  }
}

export function openSession(summary: Pick<SessionSummary, 'id' | 'title' | 'projectId'>): void {
  const existing = current.value
  if (existing) gateway.unsubscribe(existing.id)
  current.value = blankCurrent(summary.id, summary.title, summary.projectId)
  route.value = 'session'
  gateway.subscribe(summary.id)
  void refetchCurrent()
}

export function openSessionById(sessionId: string, title = ''): void {
  const known = sessionList.value.find((s) => s.id === sessionId)
  openSession(known ?? { id: sessionId, title, projectId: null })
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
    cur.todos = session.todos ?? []
    cur.settings = session.settings ?? null
    cur.mode = toAgentMode(session.settings?.mode)
    cur.error = null
    cur.loading = false
    // A full refetch is the source of truth: any gate resolved elsewhere is gone.
    cur.permission = null
    // A turn that was running when we dropped keeps streaming server-side; its
    // events resume on the live subscription, so nothing is marked streaming here.
    cur.streamingId = null
  } catch (e) {
    cur.error = errMsg(e)
    cur.loading = false
  }
}

// ─── Send / steer / cancel ──────────────────────────────────────────────────

interface SendResult {
  messageId?: string
  text?: string
}

// Append an empty assistant turn and hand back the REACTIVE element, never the
// literal we pushed: `cur.messages` is a deep-reactive array, so mutating the raw
// object writes the data without triggering a re-render — the exact reason a
// finished turn used to stay stuck on "Đang xử lý…".
function pushAgent(cur: CurrentSession, messageId: string): UiMessage {
  cur.messages.push({ id: messageId, role: 'agent', blocks: [], streaming: true })
  return cur.messages[cur.messages.length - 1] as UiMessage
}

async function runTurn(
  text: string,
  opts: { mode?: AgentMode; attachments?: SessionAttachment[] } = {},
): Promise<void> {
  const cur = current.value
  if (!cur) return
  const messageId = randomId()
  cur.messages.push({
    id: `u-${messageId}`,
    role: 'user',
    blocks: [{ kind: 'text', text }],
    streaming: false,
    ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
  })
  const agent = pushAgent(cur, messageId)
  cur.streamingId = messageId
  const mode = opts.mode ?? cur.mode
  const shouldTitle = isUntitled(cur.title) && countUserMessages(cur) <= 1
  try {
    // No client timeout: a turn runs as long as it runs — `session.message.done`
    // (or a socket drop) settles it, not a stopwatch.
    const res = await gateway.request<SendResult>(
      'sessions.sendMessage',
      {
        sessionId: cur.id,
        messageId,
        text,
        ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
        settings: { mode },
      },
      { timeoutMs: null },
    )
    finalizeAgent(agent, res.text)
  } catch (e) {
    agent.streaming = false
    agent.error = errMsg(e)
  } finally {
    if (cur.streamingId === messageId) cur.streamingId = null
    turnDoneSignal.value++
    void loadSessions()
    drainPending(cur)
  }
  if (shouldTitle) void autoTitle(cur.id, text)
}

export function sendMessage(text: string, attachments?: SessionAttachment[]): void {
  const trimmed = text.trim()
  const cur = current.value
  if (!cur) return
  if (!trimmed && !attachments?.length) return
  void runTurn(trimmed, { ...(attachments?.length ? { attachments } : {}) })
}

// Inject text into the RUNNING turn (mid-turn steering) instead of queueing a new
// one. Falls back to a normal message when the turn settled between the tap and
// the RPC (`ok:false` — the same race the desktop handles).
export async function steer(text: string): Promise<void> {
  const cur = current.value
  const trimmed = text.trim()
  if (!cur || !trimmed) return
  const messageId = cur.streamingId
  if (!messageId) {
    // Turn running but started before we connected (no messageId to steer into) —
    // queue it rather than firing a second, parallel turn at the same session.
    cur.pending.push(trimmed)
    showToast('Đã xếp hàng — gửi khi lượt hiện tại xong')
    return
  }
  try {
    const res = await gateway.request<{ ok: boolean }>('sessions.steer', {
      sessionId: cur.id,
      messageId,
      text: trimmed,
    })
    if (!res.ok) sendMessage(trimmed)
  } catch (e) {
    showToast(errMsg(e))
  }
}

export async function cancelTurn(): Promise<void> {
  const cur = current.value
  if (!cur) return
  try {
    await gateway.request('sessions.cancel', { sessionId: cur.id })
  } catch (e) {
    showToast(errMsg(e))
  }
}

// Send the next queued message once the running turn settles (one at a time).
function drainPending(cur: CurrentSession): void {
  if (cur.streamingId || !cur.pending.length) return
  const next = cur.pending.shift()
  if (next) void runTurn(next)
}

function countUserMessages(cur: CurrentSession): number {
  return cur.messages.filter((m) => m.role === 'user').length
}

function isUntitled(title: string): boolean {
  const t = title.trim().toLowerCase()
  return !t || t === 'new session' || t === 'session mới'
}

// Replace the placeholder title with a model-generated one after the opening
// message (same flow as the desktop: generate, then persist through upsert).
async function autoTitle(sessionId: string, userText: string): Promise<void> {
  try {
    const res = await gateway.request<{ ok: boolean; title?: string }>('sessions.generateTitle', {
      sessionId,
      userText,
    })
    if (res.ok && res.title) await renameSession(sessionId, res.title)
  } catch {
    // Best-effort: the placeholder title stays.
  }
}

function finalizeAgent(agent: UiMessage, text?: string): void {
  agent.streaming = false
  const hasText = agent.blocks.some((b) => b.kind === 'text' && b.text.trim().length > 0)
  if (text && !hasText) agent.blocks.push({ kind: 'text', text })
}

// ─── Checklist (ADR 0069) ───────────────────────────────────────────────────

const TODO_CYCLE: Record<TodoStatus, TodoStatus> = {
  pending: 'in_progress',
  in_progress: 'completed',
  completed: 'pending',
}

export async function cycleTodo(index: number): Promise<void> {
  const cur = current.value
  const item = cur?.todos[index]
  if (!cur || !item) return
  const next = cur.todos.map((t, i) =>
    i === index ? { ...t, status: TODO_CYCLE[t.status] } : t,
  )
  const previous = cur.todos
  cur.todos = next
  try {
    await gateway.request('sessions.updateTodos', { sessionId: cur.id, todos: next })
  } catch (e) {
    cur.todos = previous
    showToast(errMsg(e))
  }
}

// ─── Session lifecycle (create / rename / delete) ───────────────────────────

export async function createSession(input: NewSessionInput): Promise<void> {
  try {
    // `mode` at the top level is the upsert mode (create/update-metadata); the
    // session's AGENT mode travels inside `settings` — don't collapse the two.
    const { session } = await gateway.request<{ session: FullSession }>('sessions.upsert', {
      mode: 'create',
      ...(input.title ? { title: input.title } : {}),
      projectId: input.projectId ?? null,
      // Omit-to-inherit: fields left empty fall through to the project's LLM
      // defaults and then the desktop defaults, resolved by the gateway.
      settings: settingsPayload(input.config, false),
    })
    await loadSessions()
    openSession({ id: session.id, title: session.title, projectId: session.projectId })
  } catch (e) {
    showToast(errMsg(e))
  }
}

// Turn the config sheet's shape into upsert `settings`. `explicitClears` (an
// existing session) sends `accountId: null` to UNPIN, which omitting could not
// express; on create, omitting is what lets the project's default apply.
function settingsPayload(c: SessionConfig, explicitClears: boolean): Record<string, unknown> {
  return {
    ...(c.provider ? { provider: c.provider } : {}),
    ...(c.modelId ? { modelId: c.modelId } : {}),
    ...(c.level ? { level: c.level } : {}),
    mode: c.mode,
    responseStyle: c.responseStyle || 'Default',
    responseStyleNoMarkdown: c.responseStyleNoMarkdown,
    ...(c.accountId ? { accountId: c.accountId } : explicitClears ? { accountId: null } : {}),
  }
}

// Persist the whole session config (provider/account/model/effort/mode/style).
export async function updateSessionConfig(config: SessionConfig): Promise<void> {
  const cur = current.value
  if (!cur) return
  try {
    const { session } = await gateway.request<{ session: FullSession }>('sessions.upsert', {
      mode: 'update-metadata',
      sessionId: cur.id,
      settings: settingsPayload(config, true),
    })
    // Read the applied settings back: the gateway may have dropped an account
    // that doesn't belong to the chosen provider.
    cur.settings = session.settings ?? cur.settings
    cur.mode = toAgentMode(session.settings?.mode)
  } catch (e) {
    showToast(errMsg(e))
  }
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) return
  try {
    await gateway.request('sessions.upsert', {
      mode: 'update-metadata',
      sessionId,
      title: trimmed,
    })
    if (current.value?.id === sessionId) current.value.title = trimmed
    const row = sessionList.value.find((s) => s.id === sessionId)
    if (row) row.title = trimmed
  } catch (e) {
    showToast(errMsg(e))
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await gateway.request('sessions.delete', { id: sessionId })
    sessionList.value = sessionList.value.filter((s) => s.id !== sessionId)
    if (current.value?.id === sessionId) closeSession()
    showToast('Đã xoá session')
  } catch (e) {
    showToast(errMsg(e))
  }
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
// mode (mirrors desktop stores/sessions.ts approvePlan). This is a ONE-TURN
// override — `cur.mode` is untouched, so the session goes back to its own mode on
// the next message.
export function approvePlan(step: SessionStep): void {
  step.planStatus = 'approved'
  void runTurn('The plan is approved. Proceed to implement it now, following the plan.', {
    mode: 'execute',
  })
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
  return found ?? pushAgent(cur, messageId)
}

function appendDelta(cur: CurrentSession, messageId: string, delta: string): void {
  const agent = ensureAgent(cur, messageId)
  agent.streaming = true
  cur.streamingId = messageId
  const last = agent.blocks[agent.blocks.length - 1]
  if (last && last.kind === 'text') last.text += delta
  else agent.blocks.push({ kind: 'text', text: delta })
}

function upsertStep(cur: CurrentSession, messageId: string, step: SessionStep): void {
  if (isSubagentStep(step)) return
  // A TodoWrite step carries the whole checklist — mirror it into the pinned
  // banner so the user sees progress without hunting through the transcript.
  if (step.todos?.length) cur.todos = step.todos
  const agent = ensureAgent(cur, messageId)
  cur.streamingId = messageId
  const idx = agent.blocks.findIndex((b) => b.kind === 'step' && b.step.id === step.id)
  if (idx >= 0) agent.blocks[idx] = { kind: 'step', step }
  else agent.blocks.push({ kind: 'step', step })
}

function upsertBackground(cur: CurrentSession, shell: BackgroundShell): void {
  const idx = cur.background.findIndex((b) => b.shellId === shell.shellId)
  if (idx >= 0) cur.background[idx] = shell
  else cur.background.push(shell)
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
      const p = evt.payload as PermissionRequestPayload
      cur.permission = p
      // In the foreground the card itself is the signal — just a haptic tick;
      // backgrounded, this is exactly the moment worth a notification.
      if (document.hidden) {
        void notify({
          title: 'Cần duyệt',
          body: `${p.displayName || p.toolName} đang chờ bạn cho phép`,
          tag: `gate-${cur.id}`,
        })
      } else {
        buzz()
      }
      return
    }
    case 'session.background-started': {
      const p = evt.payload as BackgroundStartedPayload
      upsertBackground(cur, { shellId: p.shellId, command: p.command, status: 'running' })
      return
    }
    case 'session.background-done': {
      const p = evt.payload as BackgroundDonePayload
      upsertBackground(cur, {
        shellId: p.shellId,
        command: p.command,
        status: 'done',
        exitCode: p.exitCode ?? null,
      })
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
      if (cur.streamingId === p.messageId) cur.streamingId = null
      turnDoneSignal.value++
      drainPending(cur)
      if (document.hidden) {
        void notify({
          title: p.errorMessage ? 'Lượt lỗi' : 'Lượt xong',
          body: p.errorMessage ?? (cur.title || 'Session'),
          tag: `done-${cur.id}`,
        })
      }
      void loadSessions()
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
      void loadCatalog()
      void loadSessions()
      if (current.value) void refetchCurrent()
    },
  )
  watch(awaitingCount, (n) => setBadge(n))
}
