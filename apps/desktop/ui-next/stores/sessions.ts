import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { SidecarError, SidecarUnavailableError } from '~/composables/useSidecar'
import {
  modelDisplayName,
  modelIdFromDisplay,
  PROVIDER_DISPLAY,
  questionAnswered,
} from '~/composables/useSessionsMock'
import { useAccounts } from '~/composables/useAccounts'
import type {
  AssistantBlock,
  AssistantMessage,
  ContextChars,
  Followup,
  PermBlock,
  QuestionBlock,
  QuestionItem,
  QueuedMessage,
  Session,
  SessionAttachment,
  SessionUsage,
  SlashCommandRef,
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

// Terminal "turn finished" event (sidecar emits it right before returning the
// sessions.sendMessage result). We only need the ids to clear the streaming
// indicator; text/stopReason ride along so the byline can settle authoritatively.
type MessageDonePayload = {
  sessionId: string
  messageId: string
  text?: string
  stopReason?: string | null
}
const isMessageDonePayload = (raw: unknown): raw is MessageDonePayload => {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  return typeof p.sessionId === 'string' && typeof p.messageId === 'string'
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
  // Task this session discusses (ADR 0055) — mirrors sidecar SessionSummary.
  aboutTaskId?: string
  // GitHub issue/PR this session was opened from — mirrors sidecar SessionSummary.
  aboutGhUrl?: string
  // Fork parent (its session id) — mirrors sidecar SessionSummary; drives fork tree.
  parentSessionId?: string
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
  // Pinned context + budget + fork lineage (full session only; not on the summary).
  pinnedContext?: { files?: string[]; notes?: string }
  budget?: {
    limitUsd?: number
    hardLimitUsd?: number
    maxToolCalls?: number
    maxWallclockMs?: number
  }
  parentSessionId?: string
  forkFromMessageId?: string
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
    // Cost of THIS turn in USD (sidecar-computed via activity/pricing.ts). Summed
    // into the session's cumulative SessionUsage.cost. Absent → model has no price.
    cost_usd?: number
  }
  // Char sizes of each context segment of the last prompt (itemised the way
  // Claude Code's `/context` reports it), forwarded so the usage panel can break
  // the window down. See ContextChars.
  contextChars?: ContextChars
  stopReason: string | null
  errorMessage?: string
  // Authoritative ordered timeline (ADR 0032): reply-text runs interleaved with
  // steps in arrival order. When present it is the source of truth for the final
  // per-run text — finalize reconciles each text block against its matching run
  // rather than stamping the whole reply onto the trailing block (which merged
  // every run + duplicated earlier ones). May be absent (non-streaming reply) or
  // arrive late/dropped, so the consumer falls back gracefully.
  parts?: ({ kind: 'text'; text: string } | EngineStep)[]
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
      if (last.blocks.some((b) => b.kind === 'question' && !questionAnswered(b) && !b.cancelled))
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
      // Carry the model's full markdown so the card renders it as a document
      // (headers/lists/bold survive); `items` stays the flattened fallback.
      const md = step.planMarkdown?.trim()
      return {
        kind: 'plan',
        title: step.label || 'Plan',
        items,
        ...(md ? { markdown: md } : {}),
        status,
        eid: step.id,
      }
    }
    if (step.kind === 'question') {
      // A question step with no questions = a validation-failed / no-op
      // AskUserQuestion call (the tool returns details.questions:[]). Don't render
      // a ghost "Questions" card — the model will have retried with a valid call.
      if (!step.questions?.length) return null
      const byHeader = new Map((step.answers ?? []).map((a) => [a.header, a.selected]))
      const items: QuestionItem[] = step.questions.map((q) => {
        const item: QuestionItem = {
          prompt: q.question,
          options: (q.options ?? []).map((o) =>
            o.description ? { label: o.label, desc: o.description } : { label: o.label },
          ),
        }
        if (q.header) item.header = q.header
        if (q.multiSelect) item.multi = true
        const sel = byHeader.get(q.header)
        if (sel?.length) item.answer = sel.join(', ')
        return item
      })
      return { kind: 'question', items, eid: step.id }
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
  // Map a single engine child step to the ui-next SubStep shape. Returns null for
  // a no-op subagent question (validation-failed / headless — no questions) so it
  // never shows as a ghost "Questions" sub-row.
  function engineStepToSubStep(c: EngineStep): SubAgent['steps'][number] | null {
    if (c.kind === 'question' && !c.questions?.length) return null
    const sub: SubAgent['steps'][number] = {
      eid: c.id,
      tool: c.label || c.tool || 'Tool',
      target: c.target ?? '',
    }
    const res = engineStepResult(c)
    const det = engineStepDetail(c)
    if (res) sub.result = res
    if (det) sub.detail = det
    if (det && c.detail?.kind) sub.detailKind = c.detail.kind
    return sub
  }
  // Map a Task step's children to the ui-next SubAgent shape.
  function engineSubAgent(step: EngineStep): SubAgent {
    return {
      agent: step.target ?? step.label,
      steps: (step.children ?? [])
        .map(engineStepToSubStep)
        .filter((s): s is SubAgent['steps'][number] => s != null),
    }
  }

  // Build a finalized assistant message's blocks from engine parts/steps. Steps are
  // stored FLAT (subagent children carry `parentId`); re-nest them under their
  // parent step's `sub.steps` here — mirroring the live `upsertStep` path — so a
  // subagent step never leaks out as a top-level block (which, for a done-but-
  // unanswered subagent question, would otherwise read as a pending gate and keep
  // the composer stuck on "Stop").
  function engineMessageToBlocks(m: EngineMessage): AssistantBlock[] {
    const out: AssistantBlock[] = []
    const stepBlockById = new Map<string, StepBlock>()
    const addStep = (p: EngineStep): void => {
      if (p.parentId) {
        const parent = stepBlockById.get(p.parentId)
        if (parent) {
          const subStep = engineStepToSubStep(p)
          if (subStep) {
            const sub = parent.sub ?? { agent: parent.target, steps: [] }
            sub.steps.push(subStep)
            parent.sub = sub
          }
          return // a subagent child is never a top-level block
        }
        // Unknown parent (shouldn't happen) → fall through to top-level, defensively.
      }
      const b = engineStepToBlock(p)
      if (!b) return
      out.push(b)
      if (b.kind === 'step' && p.id) stepBlockById.set(p.id, b)
    }
    if (m.parts?.length) {
      for (const p of m.parts) {
        if (p.kind === 'text') {
          if (p.text) out.push({ kind: 'text', text: p.text })
        } else {
          addStep(p)
        }
      }
    } else {
      if (m.text) out.push({ kind: 'text', text: m.text })
      for (const s of m.steps ?? []) addStep(s)
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
    if (dto.aboutTaskId) session.aboutTaskId = dto.aboutTaskId
    if (dto.aboutGhUrl) session.aboutGhUrl = dto.aboutGhUrl
    if (dto.parentSessionId) session.parentSessionId = dto.parentSessionId
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
    // Mark loading so the transcript shows a skeleton instead of the empty welcome
    // while sessions.get is in flight. Skip the flag when msgs are already present
    // (e.g. a re-load) so we don't blank an existing transcript.
    if (!s.msgs.length) s.loading = true
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
        // Hydrate pinned context / budget / fork lineage (full session only).
        if (full.pinnedContext) target.pinnedContext = full.pinnedContext
        if (full.budget) target.budget = full.budget
        if (full.parentSessionId) target.parentSessionId = full.parentSessionId
        if (full.forkFromMessageId) target.forkFromMessageId = full.forkFromMessageId
      }
      target.loaded = true
    } catch (err) {
      console.warn('[sessions] ensureLoaded failed', id, err)
    } finally {
      const target = byId(id)
      if (target) target.loading = false
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

  // Open a session by its sidecar engineId (ADR 0055 — Task → origin/discussion
  // navigation). Hydrates the list first so it works even when arriving from the
  // Tasks page before the Sessions page has loaded. Returns false when no session
  // with that id exists (deleted) so the caller can surface a "not found" hint.
  async function openByEngineId(eid: string): Promise<boolean> {
    await hydrate()
    const s = byEngineId(eid)
    if (!s) return false
    setActive(s.id)
    return true
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
    return id
  }

  // Create a session bound to a task to discuss (ADR 0055). Mirrors create() but
  // seeds the title + aboutTaskId so the sidecar injects the <linked_task> context
  // and the UI shows the "discussing task" banner. Returns the new client id so the
  // caller (Task → "Discuss in session") can navigate to it.
  function createForTask(taskId: string, projectId: string, title: string): number {
    const id = newClientId()
    const acct = useIpc ? accounts.value[0] : undefined
    const session: Session = {
      id,
      title,
      project: projectId,
      model: acct ? (modelsForAccount(acct)[0] ?? 'Opus 4.8') : 'Opus 4.8',
      account: acct?.display ?? 'hoatq · Anthropic',
      style: 'Default',
      status: 'idle',
      when: 'vừa xong',
      mode: 'Ask',
      msgs: [],
      loaded: true,
      aboutTaskId: taskId,
    }
    if (acct) session.accountId = acct.id
    sessions.value.unshift(session)
    activeId.value = id
    if (useIpc) {
      session.engineId = engineIdFor(id)
      pushUpsert(session, 'create')
    }
    return id
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

  // Link a session to the GitHub issue/PR it was opened from (persisted; shown as
  // a link in the Info panel). Set right after create() for a "New session" on a
  // GH row.
  function setAboutGh(id: number, url: string) {
    const s = byId(id)
    if (s) {
      s.aboutGhUrl = url
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

  // ── Pinned context (session working-set) ─────────────────────────────────────
  // Files/notes the sidecar re-feeds into every turn as <pinned_context>. Persisted
  // via upsert metadata so they survive restart. Drop an empty container so we never
  // persist `{}` (keeps the round-trip clean).
  function pruneEmptyPinned(s: Session) {
    const p = s.pinnedContext
    if (p && !(p.files && p.files.length) && !(p.notes && p.notes.trim())) {
      delete s.pinnedContext
    }
  }
  function addPinnedFile(id: number, path: string) {
    const s = byId(id)
    const rel = path.trim()
    if (!s || !rel) return
    const files = s.pinnedContext?.files ?? []
    if (files.includes(rel)) return
    s.pinnedContext = { ...s.pinnedContext, files: [...files, rel] }
    if (useIpc) pushUpsert(s, 'update-metadata')
  }
  function removePinnedFile(id: number, path: string) {
    const s = byId(id)
    if (!s?.pinnedContext?.files) return
    s.pinnedContext = { ...s.pinnedContext, files: s.pinnedContext.files.filter((f) => f !== path) }
    pruneEmptyPinned(s)
    if (useIpc) pushUpsert(s, 'update-metadata')
  }
  function setPinnedNotes(id: number, notes: string) {
    const s = byId(id)
    if (!s) return
    s.pinnedContext = { ...s.pinnedContext, notes }
    pruneEmptyPinned(s)
    if (useIpc) pushUpsert(s, 'update-metadata')
  }

  // ── Budget (cost cap) ─────────────────────────────────────────────────────────
  // Soft (`limitUsd`, warning only) + hard (`hardLimitUsd`/`maxToolCalls`/
  // `maxWallclockMs`, enforced sidecar-side) spend caps. Merge the patch so setting
  // one field doesn't drop the others; drop an all-empty budget so we don't persist {}.
  function setBudget(id: number, patch: Partial<NonNullable<Session['budget']>>) {
    const s = byId(id)
    if (!s) return
    const next = { ...s.budget, ...patch }
    // Strip undefined/empty values so an emptied field clears cleanly.
    ;(Object.keys(next) as (keyof typeof next)[]).forEach((k) => {
      const v = next[k]
      if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) {
        delete next[k]
      }
    })
    if (Object.keys(next).length) s.budget = next
    else delete s.budget
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

  function enqueue(id: number, text: string, att?: SessionAttachment[], command?: SlashCommandRef) {
    const s = byId(id)
    if (!s) return
    const trimmed = text.trim()
    const atts = att ?? []
    if (!trimmed && atts.length === 0) return
    const item: QueuedMessage = { text: trimmed }
    if (atts.length) item.att = [...atts]
    if (command) item.command = command
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
    if (head) void sendMessage(id, head.text, head.att, head.command)
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
    const BASE_CPS = 200 // steady pace ≈ typical token output
    const GAP_GAIN = 12 // +cps per char of backlog
    const MAX_CPS = 1400 // ceiling so even a whole-reply burst types out (not dumps)
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

  // Finalize an assistant turn's reply text WITHOUT collapsing its interleaved
  // structure. The live stream already split the reply into text runs around steps
  // (`upsertStep` closes the open run before pushing a step), so a multi-run turn
  // has several text blocks. The authoritative ordered `parts` carries each run's
  // final text in arrival order → assign run-by-run, matching 1:1 (both the live
  // blocks and `parts` are driven by the same onChunk/onStep callbacks).
  //
  // WITHOUT parts (non-streaming reply or a dropped payload) only stamp the full
  // reply when the turn is a SINGLE run; stamping it onto the trailing run of a
  // multi-run turn would merge every run into the last block AND duplicate the
  // earlier ones — the "giao cho Dev agent" duplicate-after-step bug this fixes.
  function reconcileReplyText(
    m: AssistantMessage,
    fullText: string,
    parts?: ({ kind: 'text'; text: string } | EngineStep)[],
  ): void {
    const textBlocks = m.blocks.filter(
      (b): b is Extract<AssistantBlock, { kind: 'text' }> => b.kind === 'text',
    )
    const runs = (parts ?? []).filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
    if (runs.length) {
      // Reconcile the matching prefix; never clobber across run boundaries. Extra
      // live blocks keep their streamed text, extra runs are ignored (rare drift).
      textBlocks.forEach((b, i) => {
        const run = runs[i]
        if (run) b.text = run.text
      })
      return
    }
    if (!fullText) return
    const only = textBlocks[0]
    if (textBlocks.length === 1 && only) only.text = fullText
    else if (textBlocks.length === 0) m.blocks.push({ kind: 'text', text: fullText })
    // Multi-run turn with no parts: trust the per-run deltas (already snapped at
    // each step boundary + by flushText) — do NOT stamp the whole reply.
  }

  // Upsert an engine step into the streaming assistant message's blocks. A
  // running → done repeat merges by eid in place; a new step closes the open text
  // run (so it splits the reply). Subagent steps (parentId) attach under their
  // parent step block's `sub.steps`.
  function upsertStep(eid: string, messageId: string, step: EngineStep) {
    const m = findStreamingMsg(eid, messageId)
    if (!m) return

    // A question step that arrives with no questions = a validation-failed / no-op
    // AskUserQuestion call (the model retried with a valid one). Never leave a
    // ghost "Questions" card: drop any block OR subagent sub-step already shown
    // for this id (the start event may have pushed one), then stop.
    if (step.kind === 'question' && !step.questions?.length) {
      const bi = m.blocks.findIndex((b) => 'eid' in b && b.eid === step.id)
      if (bi >= 0) m.blocks.splice(bi, 1)
      for (const b of m.blocks) {
        if (b.kind !== 'step' || !b.sub) continue
        const si = b.sub.steps.findIndex((c) => c.eid === step.id)
        if (si >= 0) b.sub.steps.splice(si, 1)
      }
      return
    }

    if (step.parentId) {
      const parent = m.blocks.find(
        (b): b is StepBlock => b.kind === 'step' && b.eid === step.parentId,
      )
      if (parent) {
        const sub = parent.sub ?? { agent: parent.target, steps: [] }
        const subStep: SubAgent['steps'][number] = {
          eid: step.id,
          tool: step.label || step.tool || 'Tool',
          target: step.target ?? '',
          ...(engineStepResult(step) ? { result: engineStepResult(step) } : {}),
          ...(engineStepDetail(step) ? { detail: engineStepDetail(step) } : {}),
          ...(engineStepDetail(step) && step.detail?.kind ? { detailKind: step.detail.kind } : {}),
        }
        // Merge a repeat by engine step id — subagent steps DO carry a stable id
        // (e.g. `thinking-6-0`), and a streaming step re-emits it on every delta
        // with a GROWING label. Keying on id (not tool+target, which IS the
        // mutating label) keeps one row per step instead of one row per delta.
        const idx = sub.steps.findIndex((c) =>
          c.eid && step.id
            ? c.eid === step.id
            : c.tool === subStep.tool && c.target === subStep.target,
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
      // Preserve nested subagent steps: a Task's children arrive as separate
      // `parentId` events DURING the run, so the tool's own end event (which carries
      // no children) must not wipe the `sub` already attached to the live block.
      const prev = m.blocks[existingIdx]
      if (prev?.kind === 'step' && prev.sub && block.kind === 'step' && !block.sub) {
        block.sub = prev.sub
      }
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
          return
        }
        if (evt.type === 'session.message.done') {
          if (!isMessageDonePayload(evt.payload)) return
          const p = evt.payload
          const m = findStreamingMsg(p.sessionId, p.messageId)
          // Already finalized (RPC landed first, the healthy case) → nothing to do.
          if (!m || !m.streaming) return
          // Clear the "Streaming…" indicator straight from the stream rather than
          // waiting on the sessions.sendMessage RPC response — its large `parts`
          // payload can land late or be dropped, which used to leave the byline
          // stuck on "Streaming… {elapsed}" forever after the reply had finished.
          // The RPC resolve still owns the authoritative finalize (usage, model,
          // title, error block); this just stops the spinner.
          flushText(p.sessionId, p.messageId)
          // The done event carries no `parts`; reconcile only recovers the full
          // text on a single-run turn (safe), and leaves a multi-run turn's
          // per-run deltas intact. The RPC resolve still owns the authoritative
          // parts-based reconcile.
          if (typeof p.text === 'string') reconcileReplyText(m, p.text)
          m.streaming = false
          if (m.completedAt == null) m.completedAt = Date.now()
          const s = byEngineId(p.sessionId)
          if (s) {
            s.status = statusFromMessages(s.msgs)
            // Clean finish → drain the next queued message (idempotent with the
            // RPC path: whichever runs second sees the queue drained / a new turn
            // already streaming and no-ops).
            if (p.stopReason !== 'error') drainQueue(s.id)
          }
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

  // Concatenate an assistant turn's text runs. Tool / thinking / plan blocks are
  // NOT replayed to the model — this mirrors the sidecar, which persists assistant
  // turns text-only (no tool blocks in JSONL). For a parts-based or single-text
  // turn the runs join back to the full reply.
  function assistantText(blocks: AssistantBlock[]): string {
    let text = ''
    for (const b of blocks) if (b.kind === 'text') text += b.text
    return text.trim()
  }

  // True when a session has any pinned context worth forwarding to the turn (≥1
  // file or non-empty notes) — so we don't ship an empty `{}` in the payload.
  function hasPinnedContext(p: Session['pinnedContext']): boolean {
    return !!p && ((p.files?.length ?? 0) > 0 || (p.notes?.trim()?.length ?? 0) > 0)
  }

  // The HARD budget fields only (the soft `limitUsd` stays UI-side, never enforced
  // by the sidecar). Forwarded to sendMessage so the sidecar can refuse / cap a turn.
  function hardBudgetOf(b: Session['budget']): {
    hardLimitUsd?: number
    maxToolCalls?: number
    maxWallclockMs?: number
  } {
    const out: { hardLimitUsd?: number; maxToolCalls?: number; maxWallclockMs?: number } = {}
    if (b?.hardLimitUsd != null) out.hardLimitUsd = b.hardLimitUsd
    if (b?.maxToolCalls != null) out.maxToolCalls = b.maxToolCalls
    if (b?.maxWallclockMs != null) out.maxWallclockMs = b.maxWallclockMs
    return out
  }
  function hasHardBudget(b: Session['budget']): boolean {
    return Object.keys(hardBudgetOf(b)).length > 0
  }

  // Map ui-next display messages → engine SessionMessage shape (id/role/text/at).
  // The sidecar resumes a session from its JSONL transcript, so a session created
  // WITH prior turns (a fork) must carry them on disk or the model would see an
  // empty context. Reuses an assistant turn's `eid` as the engine message id so the
  // forked transcript's ids match what hydrate later assigns. Attachments are not
  // replicated (best-effort: the conversational text is what drives forked context).
  function msgsToEngineMessages(msgs: Session['msgs']): Record<string, unknown>[] {
    const now = new Date().toISOString()
    return msgs.map((m, i) => {
      const at = m.at || now
      if (m.role === 'user') return { id: `fm-${i}-${seq++}`, role: 'user', text: m.text, at }
      if (m.role === 'system') return { id: `fm-${i}-${seq++}`, role: 'system', text: m.text, at }
      return { id: m.eid ?? `fm-${i}-${seq++}`, role: 'agent', text: assistantText(m.blocks), at }
    })
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
      // Persist the transcript only on create (a fork seeds prior turns; a plain
      // new session has none). update-metadata ignores messages sidecar-side, so
      // sending [] there avoids bloating every pin/rename/mode change.
      messages: mode === 'create' ? msgsToEngineMessages(s.msgs) : [],
      pendingAgentIds: [],
      settings,
    }
    if (s.disabledTools) session.disabledTools = s.disabledTools
    if (s.mcpServerIds !== undefined) session.mcpServerIds = s.mcpServerIds
    if (s.aboutTaskId) session.aboutTaskId = s.aboutTaskId
    if (s.aboutGhUrl) session.aboutGhUrl = s.aboutGhUrl
    if (s.pinnedContext) session.pinnedContext = s.pinnedContext
    if (s.budget) session.budget = s.budget
    if (s.parentSessionId) session.parentSessionId = s.parentSessionId
    if (s.forkFromMessageId) session.forkFromMessageId = s.forkFromMessageId
    pushRequest('sessions.upsert', { session, mode })
  }

  // Turn runner. Appends the user message + a placeholder assistant bubble, then
  // either streams the real reply (IPC) or appends a canned reply (mock).
  async function sendMessage(
    id: number,
    text: string,
    att?: SessionAttachment[],
    command?: SlashCommandRef,
  ) {
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
      command: command ?? null,
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
        // Discuss link (ADR 0055): the sidecar injects this task's output + trace
        // as <linked_task> context so the agent can reason about its results.
        ...(s.aboutTaskId ? { aboutTaskId: s.aboutTaskId } : {}),
        // Pinned working-set: sidecar reads these files (path-sanitized) + notes
        // each turn and injects a <pinned_context> block.
        ...(hasPinnedContext(s.pinnedContext) ? { pinnedContext: s.pinnedContext } : {}),
        // Hard budget caps (Pha 3): pre-turn cost refusal + per-turn tool-call /
        // wallclock caps enforced sidecar-side. Forward only the hard fields.
        ...(hasHardBudget(s.budget) ? { budget: hardBudgetOf(s.budget) } : {}),
      })
      flushText(s.engineId, messageId)
      // Reconcile the reply text from the authoritative ordered `parts` (per-run),
      // never by stamping the whole reply onto the trailing block (which merged
      // every run + duplicated earlier ones around a step/subagent card).
      reconcileReplyText(placeholder, result.text, result.parts)
      placeholder.streaming = false
      placeholder.completedAt = Date.now()
      if (result.stopReason === 'error') {
        placeholder.blocks.push({
          kind: 'error',
          text: result.errorMessage || 'The model returned an error.',
        })
      } else if (result.stopReason === 'budget-exceeded') {
        // Hard budget cap (Pha 3): the sidecar refused the turn before any model
        // call. Surface as an error block; the user raises the cap in config + retries.
        placeholder.blocks.push({
          kind: 'error',
          text: result.errorMessage || 'Session budget exceeded.',
        })
      }
      // A budget-refused turn never reached the model: don't merge its zero usage
      // (that would wipe the context-window snapshot), don't drain the queue (the
      // next message would be refused too), and don't auto-title (a model call that
      // would bypass the very cap we just enforced).
      const refused = result.stopReason === 'budget-exceeded'
      if (!refused) s.usage = mergeUsage(s.usage, result.usage, result.contextChars)
      // Reflect the actually-used model, but DON'T collapse a 1M variant: the
      // engine reports the API base id (`claude-opus-4-8`) for the AWOG-internal
      // `claude-opus-4-8-1m`, so overwriting unconditionally would snap the
      // selected 1M model back to the 200k base after the first reply. Only
      // update when the base genuinely differs (a real model substitution).
      const usedDisplay = modelDisplay(result.modelUsed)
      const selectedBase = modelIdFromDisplay(s.model).replace(/-1m$/, '')
      if (!refused && usedDisplay && result.modelUsed && result.modelUsed !== selectedBase) {
        s.model = usedDisplay
      }
      s.status = statusFromMessages(s.msgs)
      // Clean finish → drain the next queued message FIFO.
      if (result.stopReason !== 'error' && !refused) drainQueue(s.id)
      // First exchange finalized (user + agent now persisted) → refine the default
      // "New session" title into a concise AI title. Fire-and-forget; a manual
      // rename (title ≠ default) is left untouched.
      if (isFirstTurn && result.stopReason !== 'error' && !refused && s.title === 'New session') {
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
    // Cost is CUMULATIVE across turns (unlike the token figures above, which are a
    // per-turn context-window snapshot). Sum this turn's cost onto the prior total;
    // omit entirely when neither side has a priced figure (UI then shows "n/a").
    const prevCost = prev?.cost ?? 0
    const turnCost = u.cost_usd ?? 0
    if (prevCost > 0 || turnCost > 0) usage.cost = prevCost + turnCost
    return usage
  }

  // ── Gates ──────────────────────────────────────────────────────────────────

  // Answer an AskUserQuestion gate. One call carries 1–4 questions answered
  // together: `answers` holds one entry per question ({header, selected labels}).
  // The whole set resumes the single parked tool call. msgIndex/eid locate the block.
  function answerQuestion(
    id: number,
    msgIndex: number,
    answers: { header: string; selected: string[] }[],
  ) {
    const s = byId(id)
    const msg = s?.msgs[msgIndex]
    if (!s || !msg || msg.role !== 'assistant') return
    const block = msg.blocks.find(
      (b): b is QuestionBlock => b.kind === 'question' && !questionAnswered(b),
    )
    if (!block) return
    // Record each answer onto its question (match by header, fall back positional).
    const byHeader = new Map(answers.map((a) => [a.header, a.selected]))
    block.items.forEach((it, i) => {
      const sel = (it.header != null ? byHeader.get(it.header) : undefined) ?? answers[i]?.selected
      it.answer = (sel ?? []).join(', ')
    })
    if (!useIpc || !block.eid) return
    pushRequest('sessions.answerQuestion', {
      requestId: block.eid,
      answers: answers.map((a) => ({ header: a.header, selected: a.selected })),
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
          (b.kind === 'question' && !questionAnswered(b) && !b.cancelled) ||
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
        if (b.kind === 'question' && !questionAnswered(b)) b.cancelled = true
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

  async function regenerate(id: number, index: number) {
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
        // The sidecar resumes from the JSONL transcript (sendMessage sends no
        // history), so slicing the in-memory copy is not enough — persist the
        // truncation first, else the regenerated turn would replay the very reply
        // it replaces. Keep through the assistant turn before the re-run user
        // message (null = drop all). AWAIT so loadSession on the next turn reads
        // the already-truncated file (avoids a read-before-write race).
        if (s.engineId) {
          const prev = ui > 0 ? s.msgs[ui - 1] : undefined
          const keepThroughId = prev && prev.role === 'assistant' ? (prev.eid ?? null) : null
          try {
            await sc.request('sessions.truncate', { sessionId: s.engineId, keepThroughId })
          } catch (err) {
            console.warn('[sessions] truncate before regenerate failed', err)
          }
        }
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

  // Re-run a USER turn (the bubble at `index`): drop that message + everything
  // after it and send it again (optionally with edited text). Mirrors regenerate's
  // truncate-then-resend, but anchored at this user turn instead of the nearest
  // preceding one. `overrideText` powers "edit & resend".
  async function resend(id: number, index: number, overrideText?: string) {
    const s = byId(id)
    if (!s) return
    const userMsg = s.msgs[index]
    if (!userMsg || userMsg.role !== 'user') return
    // Never resend under a live turn (would race the streaming reply).
    if (s.msgs.some((m) => m.role === 'assistant' && m.streaming)) return
    const text = overrideText ?? userMsg.text
    const atts = userMsg.att ?? undefined
    // Drop this user message + everything after; sendMessage re-appends a fresh
    // user bubble and runs the turn.
    s.msgs = s.msgs.slice(0, index)
    // Persist the truncation BEFORE re-running (the sidecar resumes from JSONL, so
    // slicing in-memory alone would replay the dropped reply). Keep through the
    // assistant turn before this one (null = drop all). AWAIT to avoid a
    // read-before-write race on the next turn's loadSession.
    if (useIpc && s.engineId) {
      const prev = index > 0 ? s.msgs[index - 1] : undefined
      const keepThroughId = prev && prev.role === 'assistant' ? (prev.eid ?? null) : null
      try {
        await sc.request('sessions.truncate', { sessionId: s.engineId, keepThroughId })
      } catch (err) {
        console.warn('[sessions] truncate before resend failed', err)
      }
    }
    void sendMessage(id, text, atts ?? undefined)
  }

  function fork(id: number, index: number, suffix = 'fork') {
    const s = byId(id)
    if (!s) return
    const nid = newClientId()
    const msgs = JSON.parse(JSON.stringify(s.msgs.slice(0, index + 1))) as Session['msgs']
    // Clear the streaming flag on the clone (a fork's turns are all finalized).
    // Keep `eid`: msgsToEngineMessages reuses it as the persisted engine message id
    // so the forked transcript on disk lines up with the display.
    msgs.forEach((m) => {
      if (m.role === 'assistant') delete m.streaming
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
    // Record fork lineage: the branch's parent is THIS session (override any lineage
    // copied via `...s`). forkFromMessageId = the engine id of the fork point (the
    // last kept message). Drives the fork-tree graph; persisted via upsert.
    const forkPoint = msgs[msgs.length - 1]
    if (s.engineId) branch.parentSessionId = s.engineId
    else delete branch.parentSessionId
    if (forkPoint?.role === 'assistant' && forkPoint.eid) branch.forkFromMessageId = forkPoint.eid
    else delete branch.forkFromMessageId
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
    openByEngineId,
    // crud
    setActive,
    create,
    createForTask,
    remove,
    rename,
    setProject,
    setAboutGh,
    setMode,
    setModel,
    setAccount,
    selectAccount,
    setStyle,
    setThinking,
    setNoMarkdown,
    setDisabledTools,
    setMcpServerIds,
    addPinnedFile,
    removePinnedFile,
    setPinnedNotes,
    setBudget,
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
    resend,
    fork,
    draftSeed,
    seedComposer,
    addQuote,
    removeQuote,
    setQuoteNote,
  }
})
