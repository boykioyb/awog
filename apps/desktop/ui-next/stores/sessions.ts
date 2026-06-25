import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { SidecarError, SidecarUnavailableError } from '~/composables/useSidecar'
import {
  modelDisplayName,
  modelIdFromDisplay,
  PROVIDER_DISPLAY,
} from '~/composables/useSessionsMock'
import { useAccounts } from '~/composables/useAccounts'
import type {
  AssistantBlock,
  AssistantMessage,
  ContextChars,
  Followup,
  PermBlock,
  QuestionBlock,
  Session,
  SessionAttachment,
  SessionUsage,
  StepBlock,
  SubAgent,
  ThinkingLevel,
} from '~/composables/useSessionsMock'

// Sessions store — dual-path. When the Electron bridge is available (`sc.available`)
// every action drives the real sidecar over IPC and folds the engine's streaming
// events (session.chunk / session.step / session.permission-request) into the
// active session's transcript with a typewriter reveal. In browser-dev (no shell)
// it keeps the original mock behaviour fully working with canned replies + local
// state mutations. The public action/getter surface is identical on both paths so
// Wave 2 UI components bind to one stable API. See tasks/session-screen-checklist.md
// §0/§10/§11 + apps/desktop/ui/stores/sessions.ts (reference IPC logic).

// ── Engine event payload shapes (mirrors apps/desktop/ui/stores/sessions.ts) ──

// The engine SessionStep shape (sidecar sessions/step-mapper.ts). We only consume
// the fields the ui-next AssistantBlock variants need; extras are ignored.
type EngineStepDetail =
  | { kind: 'diff'; path: string; diff: string; content?: string; language?: string }
  | { kind: 'file'; path: string; content: string; language?: string }
  | { kind: 'list'; items: { label: string; path?: string; snippet?: string }[] }
  | { kind: 'terminal'; command: string; output?: string; exitCode?: number }
  | { kind: 'text'; content: string }

type EngineQuestion = {
  header: string
  question: string
  options: { label: string; description?: string }[]
  multiSelect: boolean
}
type EngineQuestionAnswer = { header: string; selected: string[] }

type EngineStep = {
  id: string
  kind: 'tool' | 'group' | 'thinking' | 'note' | 'plan' | 'question' | 'steer'
  label: string
  tool?: string
  target?: string
  description?: string
  additions?: number
  deletions?: number
  status?: 'running' | 'done' | 'error'
  children?: EngineStep[]
  detail?: EngineStepDetail
  planMarkdown?: string
  planItems?: string[]
  planStatus?: 'pending' | 'approved' | 'rejected'
  questions?: EngineQuestion[]
  answers?: EngineQuestionAnswer[]
  steerText?: string
  parentId?: string
}

type SessionChunkPayload = { sessionId: string; messageId: string; delta: string }
type SessionStepPayload = { sessionId: string; messageId: string; step: EngineStep }
type PermissionRequestPayload = {
  sessionId: string
  messageId: string
  requestId: string
  toolName: string
  input: Record<string, unknown>
  promptSentence?: string
  blockedPath?: string
}

const isChunk = (raw: unknown): raw is SessionChunkPayload => {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  return (
    typeof p.sessionId === 'string' &&
    typeof p.messageId === 'string' &&
    typeof p.delta === 'string'
  )
}
const isStepPayload = (raw: unknown): raw is SessionStepPayload => {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  if (typeof p.sessionId !== 'string' || typeof p.messageId !== 'string') return false
  const s = p.step
  if (!s || typeof s !== 'object') return false
  const step = s as Record<string, unknown>
  return typeof step.id === 'string' && typeof step.kind === 'string'
}
const isPermissionPayload = (raw: unknown): raw is PermissionRequestPayload => {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  return (
    typeof p.sessionId === 'string' &&
    typeof p.messageId === 'string' &&
    typeof p.requestId === 'string' &&
    typeof p.toolName === 'string'
  )
}

// sessions.list summary (sidecar SessionSummary, ADR 0048) — no messages.
type EngineSessionSettings = {
  provider?: string
  modelId?: string
  accountId?: string
  mode?: string
  level?: ThinkingLevel
  responseStyle?: string
  responseStyleNoMarkdown?: boolean
}
type SessionSummaryDto = {
  id: string
  title: string
  projectId: string | null
  updatedAt: string
  pinned?: boolean
  settings?: EngineSessionSettings
  disabledTools?: string[]
  mcpServerIds?: string[]
  messageCount: number
  lastPreview?: string
}

// sessions.get full transcript (sidecar Session). Engine messages use string ids
// + role 'agent'; we translate to the ui-next SessionMessage shape on hydrate.
type EngineMessage = {
  id: string
  role: 'user' | 'agent' | 'system'
  text: string
  at?: string
  steps?: EngineStep[]
  parts?: ({ kind: 'text'; text: string } | EngineStep)[]
  error?: { message: string }
}
type SessionGetDto = {
  id: string
  title: string
  projectId: string | null
  updatedAt: string
  pinned?: boolean
  settings?: { provider?: string; modelId?: string; accountId?: string; mode?: string }
  messages: EngineMessage[]
}

interface SendMessageResult {
  messageId: string
  text: string
  modelUsed: string
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_tokens?: number
    cache_creation_tokens?: number
  }
  // Char sizes of each context segment of the last prompt (itemised the way
  // Claude Code's `/context` reports it), forwarded so the usage panel can break
  // the window down. See ContextChars.
  contextChars?: ContextChars
  stopReason: string | null
  errorMessage?: string
}

export const useSessionsStore = defineStore('sessions', () => {
  const sc = useSidecar()
  const { SESSIONS, modelsFor } = useSessionsMock()
  const { accounts, accountById, accountByDisplay, modelsForAccount } = useAccounts()
  const useIpc = sc.available

  // In IPC mode start empty (hydrate from sidecar); in mock mode use the seed.
  const sessions = ref<Session[]>(useIpc ? [] : SESSIONS)
  const activeId = ref<number | null>(useIpc ? null : (sessions.value[0]?.id ?? null))
  const active = computed<Session | null>(
    () => sessions.value.find((s) => s.id === activeId.value) ?? null,
  )

  // Selection state for bulk actions (§1). Reactive set of client ids.
  const selectedIds = ref<Set<number>>(new Set())

  let seq = 1
  const newClientId = () => Date.now() + seq++

  const byId = (id: number) => sessions.value.find((s) => s.id === id)
  const byEngineId = (eid: string) => sessions.value.find((s) => s.engineId === eid)

  // ── Mappers: engine → ui-next shapes ────────────────────────────────────

  function providerDisplay(provider?: string): string {
    return PROVIDER_DISPLAY[provider ?? ''] ?? 'Anthropic'
  }
  // Account display for a hydrated session. Prefer the real account (resolved by
  // its id from the loaded accounts list → "label · Provider"); fall back to the
  // provider-based label when the account is unknown (deleted / not yet loaded).
  function accountDisplay(s: SessionSummaryDto | SessionGetDto): string {
    const acct = s.settings?.accountId
    if (acct) {
      const hit = accountById(acct)
      if (hit) return hit.display
    }
    const provider = providerDisplay(s.settings?.provider)
    return acct ? `${acct} · ${provider}` : `${provider}`
  }
  function modelDisplay(modelId?: string): string {
    if (!modelId) return 'Opus 4.8'
    return modelDisplayName(modelId)
  }
  function modeDisplay(mode?: string): string {
    if (mode === 'plan') return 'Plan'
    if (mode === 'execute') return 'Execute'
    if (mode === 'accept-edits') return 'AcceptEdits'
    return 'Ask'
  }
  // Engine stopReason / streaming → ui-next SessionStatus.
  function statusFromMessages(msgs: Session['msgs']): Session['status'] {
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'assistant') {
      if (last.streaming) return 'streaming'
      if (last.blocks.some((b) => b.kind === 'error')) return 'error'
      if (last.blocks.some((b) => b.kind === 'question' && !b.answer && !b.cancelled))
        return 'awaiting'
      if (last.blocks.some((b) => b.kind === 'perm' && b.status === 'pending' && !b.cancelled))
        return 'awaiting'
      return 'done'
    }
    return msgs.length ? 'done' : 'idle'
  }

  // Translate one engine SessionStep into a ui-next AssistantBlock. Returns null
  // for kinds with no visual block (none currently — but defensive).
  function engineStepToBlock(step: EngineStep): AssistantBlock | null {
    if (step.kind === 'thinking') {
      const text = step.detail?.kind === 'text' ? step.detail.content : step.label
      return { kind: 'thinking', text, eid: step.id }
    }
    if (step.kind === 'plan') {
      const items = step.planItems?.length
        ? step.planItems
        : (step.planMarkdown ?? '')
            .split('\n')
            .map((l) => l.replace(/^[-*\d.\s]+/, '').trim())
            .filter(Boolean)
      const status: PlanBlock['status'] = step.planStatus === 'approved' ? 'approved' : 'pending'
      return { kind: 'plan', title: step.label || 'Plan', items, status, eid: step.id }
    }
    if (step.kind === 'question') {
      const q = step.questions?.[0]
      const block: QuestionBlock = {
        kind: 'question',
        prompt: q?.question ?? step.label,
        options: (q?.options ?? []).map((o) =>
          o.description ? { label: o.label, desc: o.description } : { label: o.label },
        ),
        eid: step.id,
      }
      if (q?.header) block.header = q.header
      if (q?.multiSelect) block.multi = true
      const ans = step.answers?.[0]
      if (ans) block.answer = ans.selected.join(', ')
      return block
    }
    if (step.kind === 'steer') {
      return { kind: 'steer', text: step.steerText ?? step.label }
    }
    // tool / group / note → a step block.
    const result = engineStepResult(step)
    const detail = engineStepDetail(step)
    const block: StepBlock = {
      kind: 'step',
      tool: step.label || step.tool || 'Tool',
      target: step.target ?? '',
      eid: step.id,
    }
    if (result) block.result = result
    if (detail) block.detail = detail
    if (detail && step.detail?.kind) block.detailKind = step.detail.kind
    if (step.status) block.status = step.status
    if (step.children?.length) block.sub = engineSubAgent(step)
    return block
  }

  // Short "result" chip for the step header (e.g. "+18 −4", "214 lines").
  function engineStepResult(step: EngineStep): string | undefined {
    if (step.additions != null || step.deletions != null) {
      const a = step.additions ?? 0
      const d = step.deletions ?? 0
      return `+${a} −${d}`
    }
    if (step.detail?.kind === 'terminal' && step.detail.exitCode != null) {
      return step.detail.exitCode === 0 ? '✓' : `exit ${step.detail.exitCode}`
    }
    return undefined
  }
  // Expandable body text for a step (diff / file content / list / terminal output).
  function engineStepDetail(step: EngineStep): string | undefined {
    const d = step.detail
    if (!d) return undefined
    if (d.kind === 'diff') return d.diff
    if (d.kind === 'file') return d.content
    if (d.kind === 'terminal') return d.output
    if (d.kind === 'text') return d.content
    if (d.kind === 'list') return d.items.map((it) => it.label).join('\n')
    return undefined
  }
  // Map a Task step's children to the ui-next SubAgent shape.
  function engineSubAgent(step: EngineStep): SubAgent {
    return {
      agent: step.target ?? step.label,
      steps: (step.children ?? []).map((c) => {
        const sub: SubAgent['steps'][number] = {
          tool: c.label || c.tool || 'Tool',
          target: c.target ?? '',
        }
        const res = engineStepResult(c)
        const det = engineStepDetail(c)
        if (res) sub.result = res
        if (det) sub.detail = det
        if (det && c.detail?.kind) sub.detailKind = c.detail.kind
        return sub
      }),
    }
  }

  // Build a finalized assistant message's blocks from engine parts/steps.
  function engineMessageToBlocks(m: EngineMessage): AssistantBlock[] {
    const out: AssistantBlock[] = []
    if (m.parts?.length) {
      for (const p of m.parts) {
        if (p.kind === 'text') {
          if (p.text) out.push({ kind: 'text', text: p.text })
        } else {
          const b = engineStepToBlock(p)
          if (b) out.push(b)
        }
      }
    } else {
      if (m.text) out.push({ kind: 'text', text: m.text })
      for (const s of m.steps ?? []) {
        const b = engineStepToBlock(s)
        if (b) out.push(b)
      }
    }
    if (m.error) out.push({ kind: 'error', text: m.error.message })
    if (!out.length) out.push({ kind: 'text', text: m.text })
    return out
  }

  // Map an engine summary onto a ui-next Session shell (transcript empty, lazy).
  function summaryToSession(dto: SessionSummaryDto): Session {
    const session: Session = {
      id: newClientId(),
      engineId: dto.id,
      title: dto.title || 'Untitled session',
      project: dto.projectId ?? 'awog',
      model: modelDisplay(dto.settings?.modelId),
      account: accountDisplay(dto),
      // Persisted per-session config (sessions.upsert ↔ sessions.list round-trip).
      style: dto.settings?.responseStyle || 'Default',
      status: 'idle',
      when: relativeWhen(dto.updatedAt),
      pinned: dto.pinned ?? false,
      mode: modeDisplay(dto.settings?.mode),
      msgs: [],
      loaded: false,
    }
    if (dto.settings?.accountId) session.accountId = dto.settings.accountId
    if (dto.settings?.level) session.thinkingLevel = dto.settings.level
    if (dto.settings?.responseStyleNoMarkdown) session.noMarkdown = true
    if (dto.disabledTools) session.disabledTools = [...dto.disabledTools]
    if (dto.mcpServerIds) session.mcpServerIds = [...dto.mcpServerIds]
    return session
  }

  // Rough relative-time label (the prototype uses crude strings like "3m").
  function relativeWhen(iso?: string): string {
    if (!iso) return 'vừa xong'
    const then = Date.parse(iso)
    if (Number.isNaN(then)) return 'vừa xong'
    const sec = Math.max(0, Math.floor((Date.now() - then) / 1000))
    if (sec < 60) return 'vừa xong'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h`
    return `${Math.floor(hr / 24)}d`
  }

  // ── Load (IPC) ────────────────────────────────────────────────────────────

  const hydrated = ref(false)
  async function hydrate(): Promise<void> {
    if (!useIpc || hydrated.value) return
    hydrated.value = true
    try {
      const res = await sc.request<{ sessions: SessionSummaryDto[] }>('sessions.list')
      const list = Array.isArray(res.sessions) ? res.sessions : []
      sessions.value = list.map(summaryToSession)
      activeId.value = sessions.value[0]?.id ?? null
      if (activeId.value != null) void ensureLoaded(activeId.value)
    } catch (err) {
      console.warn('[sessions] hydrate failed', err)
    }
  }

  // Lazy-load a session's full transcript (ADR 0048). No-op if already loaded, a
  // fresh session (no engineId), or currently streaming (live transcript wins).
  async function ensureLoaded(id: number): Promise<void> {
    if (!useIpc) return
    const s = byId(id)
    if (!s || !s.engineId || s.loaded) return
    if (s.msgs.some((m) => m.role === 'assistant' && m.streaming)) {
      s.loaded = true
      return
    }
    try {
      const res = await sc.request<{ session: SessionGetDto | null }>('sessions.get', {
        sessionId: s.engineId,
      })
      const target = byId(id)
      if (!target) return
      if (target.msgs.some((m) => m.role === 'assistant' && m.streaming)) {
        target.loaded = true
        return
      }
      const full = res.session
      if (full) {
        target.msgs = full.messages.map((m) => engineMessageToSessionMessage(m))
        target.status = statusFromMessages(target.msgs)
      }
      target.loaded = true
    } catch (err) {
      console.warn('[sessions] ensureLoaded failed', id, err)
    }
  }

  function engineMessageToSessionMessage(m: EngineMessage): Session['msgs'][number] {
    if (m.role === 'user') {
      return { role: 'user', text: m.text, at: m.at ?? '' }
    }
    if (m.role === 'system') {
      return { role: 'system', text: m.text, at: m.at ?? '' }
    }
    return { role: 'assistant', at: m.at ?? '', eid: m.id, blocks: engineMessageToBlocks(m) }
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  function setActive(id: number) {
    activeId.value = id
    const s = byId(id)
    if (s) s.unread = false
    if (useIpc) void ensureLoaded(id)
  }

  // Create a new session. `projectId` assigns it to a project up front (the
  // per-group "+" passes the group's project); omitted (the global "+") leaves the
  // project UNSET ('' = default) — the user picks one later via the crumb, since
  // at global-create time there's no project context to guess from.
  function create(projectId?: string) {
    const id = newClientId()
    // Default account: the first real account when on the engine (else the mock seed).
    const acct = useIpc ? accounts.value[0] : undefined
    const session: Session = {
      id,
      title: 'New session',
      project: projectId ?? '',
      model: acct ? (modelsForAccount(acct)[0] ?? 'Opus 4.8') : 'Opus 4.8',
      account: acct?.display ?? 'hoatq · Anthropic',
      style: 'Default',
      status: 'idle',
      when: 'vừa xong',
      mode: 'Ask',
      msgs: [],
      loaded: true,
    }
    if (acct) session.accountId = acct.id
    sessions.value.unshift(session)
    activeId.value = id
    if (useIpc) {
      session.engineId = engineIdFor(id)
      pushUpsert(session, 'create')
    }
  }

  function remove(id: number) {
    const s = byId(id)
    sessions.value = sessions.value.filter((x) => x.id !== id)
    selectedIds.value.delete(id)
    if (activeId.value === id) {
      activeId.value = sessions.value[0]?.id ?? null
      if (useIpc && activeId.value != null) void ensureLoaded(activeId.value)
    }
    if (useIpc && s?.engineId) pushRequest('sessions.delete', { id: s.engineId })
  }

  function rename(id: number, title: string) {
    const s = byId(id)
    if (s && title.trim()) {
      s.title = title.trim()
      if (useIpc) pushUpsert(s, 'update-metadata')
    }
  }

  function setProject(id: number, project: string) {
    const s = byId(id)
    if (s) {
      s.project = project
      if (useIpc) pushUpsert(s, 'update-metadata')
    }
  }

  function setMode(id: number, mode: string) {
    const s = byId(id)
    if (s) {
      s.mode = mode
      if (useIpc) pushUpsert(s, 'update-metadata')
    }
  }

  function setModel(id: number, model: string) {
    const s = byId(id)
    if (s) {
      s.model = model
      if (useIpc) pushUpsert(s, 'update-metadata')
    }
  }

  // Legacy display-string setter (mock callers). When a real account id is known
  // it rides along; the model resets to that provider's first available model.
  function setAccount(id: number, account: string, accountId?: string) {
    const s = byId(id)
    if (!s) return
    s.account = account
    if (accountId !== undefined) s.accountId = accountId
    else if (s.accountId !== undefined) delete s.accountId
    const opt = accountId !== undefined ? accountById(accountId) : accountByDisplay(account)
    s.model = (opt ? modelsForAccount(opt) : modelsFor(account))[0] ?? s.model
    if (useIpc) pushUpsert(s, 'update-metadata')
  }

  // Select a REAL account (config/composer): sets the display + real id and resets
  // the model to the account's first available model. Preferred over setAccount.
  function selectAccount(id: number, account: { id: string; display: string }) {
    const s = byId(id)
    if (!s) return
    s.account = account.display
    s.accountId = account.id
    const opt = accountById(account.id)
    s.model = (opt ? modelsForAccount(opt) : modelsFor(account.display))[0] ?? s.model
    if (useIpc) pushUpsert(s, 'update-metadata')
  }

  function setStyle(id: number, style: string) {
    const s = byId(id)
    if (s) {
      s.style = style
      if (useIpc) pushUpsert(s, 'update-metadata')
    }
  }

  // ── Per-session model config (config popover → engineSettings/payload) ──────
  // In-memory on the session; takes effect on the NEXT turn via engineSettings /
  // the sendMessage payload (the engine reads settings per turn, not from store).
  function setThinking(id: number, level: ThinkingLevel) {
    const s = byId(id)
    if (!s) return
    s.thinkingLevel = level
    if (useIpc) pushUpsert(s, 'update-metadata')
  }
  function setNoMarkdown(id: number, value: boolean) {
    const s = byId(id)
    if (!s) return
    s.noMarkdown = value
    if (useIpc) pushUpsert(s, 'update-metadata')
  }
  function setDisabledTools(id: number, names: string[]) {
    const s = byId(id)
    if (!s) return
    s.disabledTools = [...names]
    if (useIpc) pushUpsert(s, 'update-metadata')
  }
  // undefined = all enabled servers (legacy); [] = none; [ids] = only those.
  function setMcpServerIds(id: number, ids: string[] | undefined) {
    const s = byId(id)
    if (!s) return
    if (ids === undefined) delete s.mcpServerIds
    else s.mcpServerIds = [...ids]
    if (useIpc) pushUpsert(s, 'update-metadata')
  }

  // ── Pin / bulk (§1) ─────────────────────────────────────────────────────────

  function togglePin(id: number) {
    const s = byId(id)
    if (!s) return
    s.pinned = !s.pinned
    if (useIpc) pushUpsert(s, 'update-metadata')
  }

  function toggleSelect(id: number) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }
  function clearSelection() {
    selectedIds.value = new Set()
  }
  function bulkRemove(ids?: number[]) {
    const target = ids ?? [...selectedIds.value]
    target.forEach((id) => remove(id))
    clearSelection()
  }

  // ── Queue (§2) ───────────────────────────────────────────────────────────────

  function enqueue(id: number, text: string, att?: SessionAttachment[]) {
    const s = byId(id)
    if (!s) return
    const trimmed = text.trim()
    const atts = att ?? []
    if (!trimmed && atts.length === 0) return
    const item = atts.length ? { text: trimmed, att: [...atts] } : { text: trimmed }
    s.queue = [...(s.queue ?? []), item]
  }
  function dequeue(id: number, i: number) {
    const s = byId(id)
    if (!s?.queue) return
    s.queue.splice(i, 1)
    if (!s.queue.length) delete s.queue
  }

  // Persist the composer's unsent text per session (in-memory) so switching
  // sessions doesn't drop a half-typed draft. No IPC: this is transient UI state.
  function setDraft(id: number, text: string) {
    const s = byId(id)
    if (!s) return
    if (text) s.draft = text
    else delete s.draft
  }
  // Drain the head of the queue as a fresh turn (FIFO). Called once a turn settles
  // and the session is idle/done.
  function drainQueue(id: number) {
    const s = byId(id)
    if (!s?.queue || !s.queue.length) return
    if (s.status === 'streaming' || s.status === 'awaiting') return
    const head = s.queue.shift()
    if (!s.queue.length) delete s.queue
    if (head) void sendMessage(id, head.text, head.att)
  }

  // ── Turn runner ──────────────────────────────────────────────────────────────

  // Per-engine-message typewriter state. Keyed by the assistant message eid so a
  // session can stream while the user is elsewhere. setInterval (not rAF) keeps
  // revealing when the window is briefly unfocused.
  type Typewriter = { target: string; timer: ReturnType<typeof setInterval> | null }
  const typers = new Map<string, Typewriter>()

  // Find the in-flight assistant message for an engine session + message id.
  function findStreamingMsg(eid: string, messageId: string): AssistantMessage | null {
    const s = byEngineId(eid)
    if (!s) return null
    const m = s.msgs.find((x) => x.role === 'assistant' && x.eid === messageId)
    return m && m.role === 'assistant' ? m : null
  }

  // Trailing text block (last block, if text) — the one being typed.
  function trailingText(m: AssistantMessage): { kind: 'text'; text: string } | null {
    const last = m.blocks[m.blocks.length - 1]
    return last && last.kind === 'text' ? last : null
  }

  function appendDelta(eid: string, messageId: string, delta: string) {
    const m = findStreamingMsg(eid, messageId)
    if (!m) return
    let tw = typers.get(messageId)
    const last = m.blocks[m.blocks.length - 1]
    if (!last || last.kind !== 'text') {
      m.blocks.push({ kind: 'text', text: '' })
      if (tw) tw.target = ''
    }
    if (!tw) {
      tw = { target: '', timer: null }
      typers.set(messageId, tw)
    }
    tw.target += delta
    ensureReveal(eid, messageId)
  }

  function ensureReveal(eid: string, messageId: string) {
    const tw = typers.get(messageId)
    if (!tw || tw.timer) return
    // Even, time-based reveal: holding the gap fraction constant per tick (the old
    // ceil(gap/6)) dumps a big chunk on the first frame of a burst then trickles —
    // reads as a lurch. Instead reveal `chars/sec · elapsed`, where the speed scales
    // with the backlog (so we keep up with fast bursts) but is capped (so catch-up
    // stays a smooth fast scroll, not a jump). dt-scaling also absorbs timer jitter.
    const BASE_CPS = 220 // steady pace ≈ typical token output
    const GAP_GAIN = 16 // +cps per char of backlog
    const MAX_CPS = 3000 // ceiling so catch-up never lurches
    let last = performance.now()
    tw.timer = setInterval(() => {
      const m = findStreamingMsg(eid, messageId)
      const t = typers.get(messageId)
      if (!m || !t) {
        stopReveal(messageId)
        return
      }
      const tp = trailingText(m)
      const now = performance.now()
      const dt = Math.min(64, now - last) // clamp jitter (tab refocus / GC pause)
      last = now
      if (!tp) return
      const gap = t.target.length - tp.text.length
      if (gap <= 0) return
      const cps = Math.min(MAX_CPS, BASE_CPS + gap * GAP_GAIN)
      const take = Math.max(1, Math.min(gap, Math.round((cps * dt) / 1000)))
      tp.text = t.target.slice(0, tp.text.length + take)
    }, 16)
  }
  function stopReveal(messageId: string) {
    const tw = typers.get(messageId)
    if (tw?.timer) clearInterval(tw.timer)
    typers.delete(messageId)
  }
  // Snap the trailing text run to all received deltas (finalize / cancel / error).
  function flushText(eid: string, messageId: string) {
    const tw = typers.get(messageId)
    const m = findStreamingMsg(eid, messageId)
    if (m && tw) {
      const tp = trailingText(m)
      if (tp) tp.text = tw.target
    }
    stopReveal(messageId)
  }

  // Upsert an engine step into the streaming assistant message's blocks. A
  // running → done repeat merges by eid in place; a new step closes the open text
  // run (so it splits the reply). Subagent steps (parentId) attach under their
  // parent step block's `sub.steps`.
  function upsertStep(eid: string, messageId: string, step: EngineStep) {
    const m = findStreamingMsg(eid, messageId)
    if (!m) return

    if (step.parentId) {
      const parent = m.blocks.find(
        (b): b is StepBlock => b.kind === 'step' && b.eid === step.parentId,
      )
      if (parent) {
        const sub = parent.sub ?? { agent: parent.target, steps: [] }
        const subStep = {
          tool: step.label || step.tool || 'Tool',
          target: step.target ?? '',
          ...(engineStepResult(step) ? { result: engineStepResult(step) } : {}),
          ...(engineStepDetail(step) ? { detail: engineStepDetail(step) } : {}),
        }
        // Merge a repeat by tool+target (subagent children have no stable id here).
        const idx = sub.steps.findIndex(
          (c) => c.tool === subStep.tool && c.target === subStep.target,
        )
        if (idx >= 0) sub.steps[idx] = subStep
        else sub.steps.push(subStep)
        parent.sub = sub
        return
      }
    }

    const block = engineStepToBlock(step)
    if (!block) return
    // Merge by eid (running → done, thinking re-emits, question answered).
    const existingIdx = m.blocks.findIndex((b) => 'eid' in b && b.eid != null && b.eid === step.id)
    if (existingIdx >= 0) {
      m.blocks[existingIdx] = block
      return
    }
    // Close the open text run so the step renders between text segments.
    const last = m.blocks[m.blocks.length - 1]
    if (last && last.kind === 'text') {
      const tw = typers.get(messageId)
      if (tw) {
        last.text = tw.target
        tw.target = ''
      }
    }
    m.blocks.push(block)
  }

  // Sidecar permission prompt (singleton — canUseTool serialises per turn). Wave 2
  // permission UI reads this; the gate card resolves via setPermission.
  const pendingPermission = ref<{
    sessionId: number
    messageId: string
    requestId: string
    toolName: string
    target: string
  } | null>(null)

  // Single app-lifetime subscription to engine events (set up at store init).
  let unlisten: (() => void) | null = null
  async function subscribe(): Promise<void> {
    if (!useIpc || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (evt.type === 'session.chunk') {
          if (!isChunk(evt.payload)) return
          appendDelta(evt.payload.sessionId, evt.payload.messageId, evt.payload.delta)
          // A delta means the model is actively generating again — clear any stale
          // 'awaiting' left by an auto-resolved gate so the indicator + composer
          // don't get stuck on "Waiting…"/busy while output is streaming.
          const sc2 = byEngineId(evt.payload.sessionId)
          if (sc2 && sc2.status === 'awaiting') sc2.status = 'streaming'
          return
        }
        if (evt.type === 'session.step') {
          if (!isStepPayload(evt.payload)) return
          upsertStep(evt.payload.sessionId, evt.payload.messageId, evt.payload.step)
          // Mirror LLM-driven plan-mode toggles onto the composer chip.
          const s = byEngineId(evt.payload.sessionId)
          const lbl = evt.payload.step.label
          if (s && lbl === 'Enter plan' && s.mode !== 'Plan') s.mode = 'Plan'
          else if (s && lbl === 'Exit plan' && s.mode === 'Plan') s.mode = 'Ask'
          // A question step parks the turn → status awaiting.
          if (s && evt.payload.step.kind === 'question' && !evt.payload.step.answers) {
            s.status = 'awaiting'
          }
          return
        }
        if (evt.type === 'session.permission-request') {
          if (!isPermissionPayload(evt.payload)) return
          const p = evt.payload
          const s = byEngineId(p.sessionId)
          if (!s) return
          const target =
            p.blockedPath ||
            (typeof p.input.command === 'string' ? p.input.command : '') ||
            (typeof p.input.file_path === 'string' ? p.input.file_path : '') ||
            (typeof p.input.url === 'string' ? p.input.url : '')
          pendingPermission.value = {
            sessionId: s.id,
            messageId: p.messageId,
            requestId: p.requestId,
            toolName: p.toolName,
            target,
          }
          // Surface a pending perm block in the transcript + flip status.
          const m = findStreamingMsg(p.sessionId, p.messageId)
          if (m) {
            const last = m.blocks[m.blocks.length - 1]
            if (last && last.kind === 'text') {
              const tw = typers.get(p.messageId)
              if (tw) {
                last.text = tw.target
                tw.target = ''
              }
            }
            const block: PermBlock = {
              kind: 'perm',
              tool: p.toolName,
              target,
              status: 'pending',
              eid: p.requestId,
            }
            m.blocks.push(block)
          }
          s.status = 'awaiting'
        }
      })
    } catch {
      // Browser-dev: onEvent throws when the bridge is absent. Ignore — mock path.
      unlisten = null
    }
  }

  // Persistence helpers (fire-and-forget; UI stays optimistic).
  function pushRequest(method: string, params: unknown): void {
    if (!useIpc) return
    sc.request(method, params).catch((err) => console.warn(`[sessions] ${method} failed`, err))
  }
  function engineIdFor(clientId: number): string {
    return `ses-${clientId.toString(36)}`
  }
  // Build the minimal sidecar session payload from the ui-next display fields. The
  // engine owns the canonical settings; we only forward what we can derive.
  function pushUpsert(s: Session, mode: 'create' | 'update-metadata'): void {
    if (!useIpc || !s.engineId) return
    // sessions.upsert SessionSchema requires the full session even for
    // update-metadata (a partial payload fails zod validation → nothing persists).
    // Settings carry the per-session model config so it survives restart.
    const settings: Record<string, unknown> = { ...engineSettings(s) }
    const now = new Date().toISOString()
    const session: Record<string, unknown> = {
      id: s.engineId,
      title: s.title,
      projectId: s.project || null,
      createdAt: now,
      updatedAt: now,
      pinned: s.pinned ?? false,
      invitedAgentIds: [],
      messages: [],
      pendingAgentIds: [],
      settings,
    }
    if (s.disabledTools) session.disabledTools = s.disabledTools
    if (s.mcpServerIds !== undefined) session.mcpServerIds = s.mcpServerIds
    pushRequest('sessions.upsert', { session, mode })
  }

  // Turn runner. Appends the user message + a placeholder assistant bubble, then
  // either streams the real reply (IPC) or appends a canned reply (mock).
  async function sendMessage(id: number, text: string, att?: SessionAttachment[]) {
    const s = byId(id)
    const trimmed = text.trim()
    const atts = att ?? []
    const quotes = s?.followups ?? []
    if (!s || (!trimmed && atts.length === 0 && quotes.length === 0)) return

    s.msgs.push({
      role: 'user',
      text: trimmed,
      at: new Date().toISOString(),
      att: atts.length ? atts : null,
      quotes: quotes.length ? quotes : null,
    })
    s.followups = []

    if (!useIpc) {
      // Mock turn: canned reply.
      const tNow = Date.now()
      s.msgs.push({
        role: 'assistant',
        at: new Date(tNow).toISOString(),
        startedAt: tNow,
        completedAt: tNow,
        blocks: [{ kind: 'text', text: '(mock reply — chưa nối turn runner thật qua IPC)' }],
      })
      s.status = 'done'
      return
    }

    await runEngineTurn(s, trimmed, atts)
  }

  // Drive one real turn over IPC: placeholder bubble + stream subscription folds
  // events into it; finalize / cancel / error stamps the bubble.
  async function runEngineTurn(s: Session, text: string, atts: SessionAttachment[]) {
    if (!s.engineId) s.engineId = engineIdFor(s.id)
    const messageId = `m-${Date.now().toString(36)}-${(seq++).toString(36)}`
    // First exchange? (no prior assistant reply) → auto-generate a title after it
    // finalizes. Captured before the placeholder is pushed.
    const isFirstTurn = !s.msgs.some((m) => m.role === 'assistant')
    const placeholder: AssistantMessage = {
      role: 'assistant',
      at: new Date().toISOString(),
      eid: messageId,
      streaming: true,
      startedAt: Date.now(),
      blocks: [],
    }
    s.msgs.push(placeholder)
    s.status = 'streaming'

    // Engine attachments: only image data URLs + text content reach the model.
    const engineAtts = atts
      .map((a, i) => {
        const base = {
          id: `att-${i}`,
          name: a.name,
          type: a.img ? ('image' as const) : ('file' as const),
        }
        if (a.img && a.dataUrl) return { ...base, url: a.dataUrl }
        if (a.img && a.src?.startsWith('data:')) return { ...base, url: a.src }
        if (a.text) return { ...base, preview: a.text }
        return null
      })
      .filter((a): a is NonNullable<typeof a> => a != null)

    try {
      const result = await sc.request<SendMessageResult>('sessions.sendMessage', {
        sessionId: s.engineId,
        messageId,
        text,
        ...(engineAtts.length ? { attachments: engineAtts } : {}),
        history: [],
        settings: engineSettings(s),
        // Project linkage → sidecar resolves the project's on-disk path as the
        // tools' cwd. WITHOUT this, tools fall back to process.cwd() (the repo the
        // engine was launched from) — so a medbase-platform session would wrongly
        // operate on the awog repo. `s.project` holds the engine projectId.
        ...(s.project ? { projectId: s.project } : {}),
        // Session-scoped tool denylist + MCP whitelist (config popover).
        ...(s.disabledTools && s.disabledTools.length ? { disabledTools: s.disabledTools } : {}),
        ...(s.mcpServerIds !== undefined ? { mcpServerIds: s.mcpServerIds } : {}),
      })
      flushText(s.engineId, messageId)
      // Stamp the authoritative full reply onto the trailing text run.
      const tp = trailingText(placeholder)
      if (tp && result.text) tp.text = result.text
      else if (result.text && !placeholder.blocks.some((b) => b.kind === 'text')) {
        placeholder.blocks.push({ kind: 'text', text: result.text })
      }
      placeholder.streaming = false
      placeholder.completedAt = Date.now()
      if (result.stopReason === 'error') {
        placeholder.blocks.push({
          kind: 'error',
          text: result.errorMessage || 'The model returned an error.',
        })
      }
      s.usage = mergeUsage(s.usage, result.usage, result.contextChars)
      // Reflect the actually-used model, but DON'T collapse a 1M variant: the
      // engine reports the API base id (`claude-opus-4-8`) for the AWOG-internal
      // `claude-opus-4-8-1m`, so overwriting unconditionally would snap the
      // selected 1M model back to the 200k base after the first reply. Only
      // update when the base genuinely differs (a real model substitution).
      const usedDisplay = modelDisplay(result.modelUsed)
      const selectedBase = modelIdFromDisplay(s.model).replace(/-1m$/, '')
      if (usedDisplay && result.modelUsed && result.modelUsed !== selectedBase) {
        s.model = usedDisplay
      }
      s.status = statusFromMessages(s.msgs)
      // Clean finish → drain the next queued message FIFO.
      if (result.stopReason !== 'error') drainQueue(s.id)
      // First exchange finalized (user + agent now persisted) → refine the default
      // "New session" title into a concise AI title. Fire-and-forget; a manual
      // rename (title ≠ default) is left untouched.
      if (isFirstTurn && result.stopReason !== 'error' && s.title === 'New session') {
        void autoGenerateTitle(s)
      }
    } catch (err) {
      flushText(s.engineId, messageId)
      placeholder.streaming = false
      placeholder.completedAt = Date.now()
      const canceled = err instanceof SidecarError && err.code === -32023
      if (!canceled) {
        let message = 'Unknown error'
        if (err instanceof SidecarUnavailableError) message = 'Sidecar unavailable'
        else if (err instanceof SidecarError)
          message = err.code ? `${err.message} (code ${err.code})` : err.message
        else if (err instanceof Error) message = err.message
        placeholder.blocks.push({ kind: 'error', text: message })
      }
      s.status = statusFromMessages(s.msgs)
    } finally {
      stopReveal(messageId)
      // Clear a stale permission for this turn so the UI doesn't block.
      if (pendingPermission.value && pendingPermission.value.messageId === messageId) {
        pendingPermission.value = null
      }
    }
  }

  // Build the engine SessionSettings from the ui-next display fields. The provider
  // is read from the selected account when known (else the display tail); modelId
  // reverse-maps the display name; accountId is the REAL sidecar id.
  function engineSettings(s: Session): Record<string, unknown> {
    const opt = s.accountId ? accountById(s.accountId) : undefined
    const provider = (opt?.provider ?? s.account.split(' · ')[1] ?? 'Anthropic').toLowerCase()
    const modelId = modelIdFromDisplay(s.model)
    const mode =
      s.mode === 'Plan'
        ? 'plan'
        : s.mode === 'Execute'
          ? 'execute'
          : s.mode === 'AcceptEdits'
            ? 'accept-edits'
            : 'ask'
    const settings: Record<string, unknown> = {
      provider,
      modelId,
      level: s.thinkingLevel ?? 'high',
      mode,
    }
    if (s.accountId) settings.accountId = s.accountId
    // Response style (ADR 0046): a non-Default style id is the directive; the
    // no-markdown modifier rides alongside. Omit when Default/unset = "Normal".
    if (s.style && s.style !== 'Default') settings.responseStyle = s.style
    if (s.noMarkdown) settings.responseStyleNoMarkdown = true
    return settings
  }

  // `/compact` (ADR 0047): summarise older turns to free token budget. Fires the
  // real RPC with the session's engine settings; the sidecar persists a
  // `session.compacted` checkpoint and trims model context on the NEXT turn (the
  // transcript is left intact). Returns false in browser-dev / on error / when
  // there is nothing to compact. keepRecentTokens 0 = keep only the last turn.
  async function compactSession(id: number): Promise<boolean> {
    const s = byId(id)
    if (!s || !useIpc || !s.engineId) return false
    const es = engineSettings(s)
    const messageId = `compact-${Date.now().toString(36)}`
    try {
      const res = await sc.request<{ ok?: boolean; reason?: string }>('sessions.compact', {
        sessionId: s.engineId,
        messageId,
        provider: es.provider,
        modelId: es.modelId,
        ...(es.accountId ? { accountId: es.accountId } : {}),
        ...(s.project ? { projectId: s.project } : {}),
        keepRecentTokens: 0,
      })
      return res?.ok !== false
    } catch (err) {
      console.warn('[sessions] compact failed', err)
      return false
    }
  }

  function mergeUsage(
    prev: SessionUsage | undefined,
    u: SendMessageResult['usage'],
    contextChars?: SendMessageResult['contextChars'],
  ): SessionUsage {
    const input = u.input_tokens ?? 0
    const output = u.output_tokens ?? 0
    const cacheRead = u.cache_read_tokens ?? 0
    const cacheWrite = u.cache_creation_tokens ?? 0
    const total = input + output + cacheRead + cacheWrite
    const usage: SessionUsage = { input, output, cacheRead, cacheWrite, total }
    if (prev?.max != null) usage.max = prev.max
    // Carry the latest engine breakdown (fall back to the previous turn's so the
    // panel keeps itemising if a later result omits it).
    const cc = contextChars ?? prev?.contextChars
    if (cc) usage.contextChars = cc
    return usage
  }

  // ── Gates ──────────────────────────────────────────────────────────────────

  // Answer an AskUserQuestion gate. `answer` is the chosen label(s) joined; the
  // engine needs the question header + selected labels. msgIndex/eid locate the block.
  function answerQuestion(id: number, msgIndex: number, answer: string) {
    const s = byId(id)
    const msg = s?.msgs[msgIndex]
    if (!s || !msg || msg.role !== 'assistant') return
    const block = msg.blocks.find((b): b is QuestionBlock => b.kind === 'question' && !b.answer)
    if (!block) return
    block.answer = answer
    if (!useIpc || !block.eid) return
    const selected = answer
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    pushRequest('sessions.answerQuestion', {
      requestId: block.eid,
      answers: [{ header: block.header ?? '', selected }],
    })
    // Turn resumes generating → flip status back to streaming (else it stays
    // "awaiting" / shows "Waiting…" even though the model is working again).
    if (s.msgs.some((m) => m.role === 'assistant' && m.streaming)) s.status = 'streaming'
  }

  // Allow / deny the pending permission prompt. msgIndex optional (the singleton
  // pendingPermission carries the requestId); the block status flips for display.
  // Resolve the pending permission. `alwaysAllow` (allow only) tells the engine to
  // apply the request's permission suggestions as a session-scoped allowlist so the
  // same tool stops prompting (sessions.permission `alwaysAllow`).
  function setPermission(
    id: number,
    msgIndex: number,
    decision: 'allow' | 'deny',
    alwaysAllow = false,
  ) {
    const s = byId(id)
    const msg = s?.msgs[msgIndex]
    if (msg && msg.role === 'assistant') {
      const block = msg.blocks.find(
        (b): b is PermBlock => b.kind === 'perm' && b.status === 'pending',
      )
      if (block) block.status = decision === 'allow' ? 'allowed' : 'denied'
    }
    const pending = pendingPermission.value
    if (!useIpc || !pending) return
    pendingPermission.value = null
    pushRequest('sessions.permission', {
      requestId: pending.requestId,
      decision,
      ...(alwaysAllow ? { alwaysAllow: true } : {}),
    })
    // Turn resumes generating → flip status back to streaming (else it stays
    // "awaiting" / shows "Waiting…" even though the model is working again).
    const ss = byId(id)
    if (ss && ss.msgs.some((m) => m.role === 'assistant' && m.streaming)) ss.status = 'streaming'
  }

  // Approve a proposed plan: flip the block to approved + (IPC) send a continuation
  // turn so the model carries it out. Mock just flips the local status.
  function approvePlan(id: number, msgIndex: number) {
    const s = byId(id)
    const msg = s?.msgs[msgIndex]
    if (!s || !msg || msg.role !== 'assistant') return
    const block = msg.blocks.find(
      (b): b is PlanBlock => b.kind === 'plan' && b.status !== 'approved',
    )
    if (!block) return
    block.status = 'approved'
    s.mode = 'Execute'
    if (useIpc) {
      void sendMessage(id, 'The plan is approved. Proceed to implement it now, following the plan.')
    }
  }

  // Mid-turn steering: inject text into the in-flight turn. Falls back to a normal
  // send when no turn is streaming.
  async function steer(id: number, text: string): Promise<void> {
    const s = byId(id)
    const trimmed = text.trim()
    if (!s || !trimmed) return
    const streamingMsg = s.msgs.find((m) => m.role === 'assistant' && m.streaming)
    if (!useIpc || !s.engineId || !streamingMsg || streamingMsg.role !== 'assistant') {
      await sendMessage(id, trimmed)
      return
    }
    try {
      const res = await sc.request<{ ok: boolean }>('sessions.steer', {
        sessionId: s.engineId,
        messageId: streamingMsg.eid,
        text: trimmed,
      })
      if (!res.ok) await sendMessage(id, trimmed)
    } catch (err) {
      console.warn('[sessions] steer failed', err)
      await sendMessage(id, trimmed)
    }
  }

  // Cancel the in-flight turn. `sessions.cancel` aborts session-wide
  // (sessionAborted), so optimistically end EVERY in-flight indicator + parked gate
  // in this session — clearing only the latest left the composer stuck on "Stop"
  // when a turn parked on a gate (its pending question/perm still read as
  // "awaiting") or a stale `streaming` flag lingered on another message.
  async function cancel(id: number): Promise<void> {
    const s = byId(id)
    if (!s || !useIpc || !s.engineId) return
    let target: AssistantMessage | null = null
    for (const m of s.msgs) {
      if (m.role !== 'assistant') continue
      const pendingGate = m.blocks.some(
        (b) =>
          (b.kind === 'question' && !b.answer && !b.cancelled) ||
          (b.kind === 'perm' && b.status === 'pending' && !b.cancelled),
      )
      if (!m.streaming && !pendingGate) continue
      // Optimistically end the streaming indicator NOW — don't wait for the abort
      // round-trip (which could be slow or, if eid is missing, never land). The
      // pending sendMessage RPC's reject/resolve still finalizes the same bubble.
      if (m.streaming) {
        flushText(s.engineId, m.eid ?? '')
        m.streaming = false
      }
      if (m.completedAt == null) m.completedAt = Date.now()
      if (m.eid) stopReveal(m.eid)
      // A parked gate is dead once the turn is aborted — mark it cancelled so it
      // stops counting as "awaiting" and renders as cancelled rather than an
      // interactive prompt that would now no-op.
      for (const b of m.blocks) {
        if (b.kind === 'question' && !b.answer) b.cancelled = true
        if (b.kind === 'perm' && b.status === 'pending') b.cancelled = true
      }
      target = m // keep the latest matched message for the RPC messageId
    }
    if (!target) return
    if (pendingPermission.value) pendingPermission.value = null
    s.status = statusFromMessages(s.msgs)
    try {
      // messageId is required by the RPC; fall back to the engine session id when
      // the eid is missing so the session-wide abort still fires (abortSession).
      await sc.request('sessions.cancel', {
        sessionId: s.engineId,
        messageId: target.eid || s.engineId,
      })
    } catch {
      // Race: the stream may have settled between click and RPC. Already finalized.
    }
  }

  // ── Enhance prompt (one-shot) ────────────────────────────────────────────────

  async function enhancePrompt(text: string): Promise<string> {
    if (!useIpc) {
      // Mock: wrap the draft with crude project context (mirrors the demo file).
      const s = active.value
      const ctx = s?.project ? `Bối cảnh: ${s.project}\nYêu cầu: ` : ''
      return `${ctx}${text}`
    }
    const s = active.value
    const settings = s ? engineSettings(s) : { provider: 'anthropic', modelId: 'claude-opus-4-8' }
    const res = await sc.request<{ text: string }>('sessions.enhancePrompt', {
      text,
      provider: settings.provider,
      modelId: settings.modelId,
    })
    return res.text
  }

  // Summarize the first exchange into a concise title + rename. Best-effort: any
  // failure keeps the "New session" placeholder. Reads persisted messages on the
  // sidecar, so call only after the first turn has finalized.
  async function autoGenerateTitle(s: Session): Promise<void> {
    if (!useIpc || !s.engineId) return
    const settings = engineSettings(s)
    try {
      const res = await sc.request<{ ok: boolean; title?: string }>('sessions.generateTitle', {
        sessionId: s.engineId,
        provider: settings.provider,
        modelId: settings.modelId,
        ...(s.accountId ? { accountId: s.accountId } : {}),
      })
      if (res.ok && res.title) rename(s.id, res.title)
    } catch (err) {
      console.warn('[sessions] generateTitle failed', err)
    }
  }

  // ── Existing local actions (preserved 1:1) ──────────────────────────────────

  function toggleTodo(id: number, i: number) {
    const td = byId(id)?.todos?.[i]
    if (td) td.done = !td.done
  }

  function regenerate(id: number, index: number) {
    const s = byId(id)
    if (!s) return
    s.msgs = s.msgs.slice(0, index)
    if (useIpc) {
      // Re-run the nearest preceding user turn.
      let ui = index - 1
      while (ui >= 0 && s.msgs[ui]?.role !== 'user') ui -= 1
      const userMsg = ui >= 0 ? s.msgs[ui] : undefined
      if (userMsg && userMsg.role === 'user') {
        s.msgs = s.msgs.slice(0, ui)
        const atts = userMsg.att ?? undefined
        void sendMessage(id, userMsg.text, atts ?? undefined)
      }
      return
    }
    s.msgs.push({
      role: 'assistant',
      at: 'vừa xong',
      blocks: [{ kind: 'text', text: '(mock reply — chưa nối turn runner thật qua IPC)' }],
    })
    s.status = 'done'
  }

  function retryModel(id: number, index: number) {
    const s = byId(id)
    if (!s) return
    if (useIpc) {
      regenerate(id, index)
      return
    }
    s.msgs = s.msgs.slice(0, index)
    s.msgs.push({ role: 'system', text: 'Thử lại với model khác', at: 'vừa xong' })
    s.msgs.push({
      role: 'assistant',
      at: 'vừa xong',
      blocks: [{ kind: 'text', text: '(mock reply — model khác — chưa nối turn runner thật)' }],
    })
    s.status = 'done'
  }

  function rewind(id: number, index: number) {
    const s = byId(id)
    if (!s) return
    s.msgs = s.msgs.slice(0, index)
    if (useIpc && s.engineId) {
      const target = s.msgs[index - 1]
      if (target && target.role === 'assistant' && target.eid) {
        pushRequest('sessions.rewind', { sessionId: s.engineId, messageId: target.eid })
      }
    }
  }

  function fork(id: number, index: number, suffix = 'fork') {
    const s = byId(id)
    if (!s) return
    const nid = newClientId()
    const msgs = JSON.parse(JSON.stringify(s.msgs.slice(0, index + 1))) as Session['msgs']
    // Strip engine-only fields from the clone (a fork is a brand-new session).
    msgs.forEach((m) => {
      if (m.role === 'assistant') {
        delete m.eid
        delete m.streaming
      }
    })
    const branch: Session = {
      ...s,
      id: nid,
      title: `${s.title} (${suffix})`,
      unread: false,
      msgs,
      loaded: true,
    }
    delete branch.engineId
    delete branch.queue
    sessions.value.unshift(branch)
    activeId.value = nid
    if (useIpc) {
      branch.engineId = engineIdFor(nid)
      pushUpsert(branch, 'create')
    }
  }

  // Composer prefill seed (quote / edit). The composer watches this and loads the
  // text into its draft; nonce retriggers the watch for identical seeds.
  const draftSeed = ref<{ text: string; nonce: number }>({ text: '', nonce: 0 })
  function seedComposer(text: string) {
    draftSeed.value = { text, nonce: draftSeed.value.nonce + 1 }
  }

  // Follow-up quotes (per session). `range` (§8): optional char range so the
  // highlight survives re-render from state. Existing callers (text/note) keep
  // working; range is additive/optional.
  function addQuote(
    id: number,
    msgIndex: number,
    text?: string,
    note?: string,
    range?: { blockIndex?: number; start?: number; end?: number },
  ) {
    const s = byId(id)
    const m = s?.msgs[msgIndex]
    if (!s || !m) return
    let excerpt = (text ?? '').replace(/\s+/g, ' ').trim()
    if (!excerpt) {
      if (m.role !== 'assistant') return
      const tb = m.blocks.find((b) => b.kind === 'text')
      excerpt = ((tb && 'text' in tb ? tb.text : '') || 'trích dẫn').replace(/\s+/g, ' ')
    }
    excerpt = excerpt.slice(0, 280)
    s.followups = s.followups ?? []
    const fu: Followup = { src: msgIndex, excerpt, note: note ?? '' }
    if (range?.blockIndex != null) fu.blockIndex = range.blockIndex
    if (range?.start != null) fu.start = range.start
    if (range?.end != null) fu.end = range.end
    s.followups.push(fu)
  }
  function removeQuote(id: number, i: number) {
    byId(id)?.followups?.splice(i, 1)
  }
  function setQuoteNote(id: number, i: number, note: string) {
    const q = byId(id)?.followups?.[i]
    if (q) q.note = note
  }

  // Accounts load async (after hydrate). Once they arrive, re-resolve the display
  // for hydrated sessions whose accountId now maps to a real account (so the chip
  // shows "label · Provider" instead of the raw id fallback).
  if (useIpc) {
    watch(accounts, (list) => {
      if (!list.length) return
      for (const s of sessions.value) {
        if (!s.accountId) continue
        const hit = accountById(s.accountId)
        if (hit && s.account !== hit.display) s.account = hit.display
      }
    })
  }

  // App-lifetime init: subscribe to engine events + hydrate the list (IPC only).
  if (useIpc) {
    void subscribe()
    void hydrate()
  }

  return {
    // state
    sessions,
    activeId,
    active,
    selectedIds,
    pendingPermission,
    // load (IPC)
    hydrate,
    ensureLoaded,
    // crud
    setActive,
    create,
    remove,
    rename,
    setProject,
    setMode,
    setModel,
    setAccount,
    selectAccount,
    setStyle,
    setThinking,
    setNoMarkdown,
    setDisabledTools,
    setMcpServerIds,
    compactSession,
    // pin / bulk
    togglePin,
    toggleSelect,
    clearSelection,
    bulkRemove,
    // queue
    enqueue,
    dequeue,
    drainQueue,
    setDraft,
    // turn runner + gates
    sendMessage,
    answerQuestion,
    setPermission,
    approvePlan,
    steer,
    cancel,
    enhancePrompt,
    // local message actions
    toggleTodo,
    regenerate,
    retryModel,
    rewind,
    fork,
    draftSeed,
    seedComposer,
    addQuote,
    removeQuote,
    setQuoteNote,
  }
})
