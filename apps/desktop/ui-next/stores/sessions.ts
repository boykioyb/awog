import { defineStore } from 'pinia'
import { computed, markRaw, ref, watch } from 'vue'
import { SidecarError, SidecarUnavailableError } from '~/composables/useSidecar'
import {
  modelDisplayName,
  modelIdFromDisplay,
  PROVIDER_DISPLAY,
  questionAnswered,
} from '~/composables/useSessionsData'
import { useAccounts } from '~/composables/useAccounts'
import { normalizeStyleSlug } from '~/composables/useSessionModelConfig'
import type { UsageEntry } from '~/composables/useAccountUsage'
import { useSettingsStore } from '~/stores/settings'
import { useProjectsStore } from '~/stores/projects'
import { contextLimitFor, contextTokensFromChars } from '~/utils/context-window'
import { slugSessionId } from '~/utils/session-slug'
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
  SessionStatus,
  SessionUsage,
  SlashCommandRef,
  SshApprovalMode,
  StepBlock,
  SubAgent,
  ThinkingLevel,
  Todo,
} from '~/composables/useSessionsData'

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

// Circled markers mirror the UI's numbered quote cards (①②③…) so the woven prompt
// lines up with the anchors the user sees in the bubble.
const QUOTE_MARKERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'] as const

// Weave follow-up quotes into the outgoing MODEL text. The `quotes` carried on the
// user message are DISPLAY-only (the numbered cards in the bubble); the model never
// sees them unless they're folded into the prompt here. Each quote renders as a
// markdown blockquote of the excerpt plus the user's note. Returns `text` unchanged
// when there are no quotes. Without this a quote-only turn (empty draft) sends empty
// text and the sidecar rejects it (the text-or-attachment invariant) → the turn
// stops instantly with no model action or log.
function composeQuotedText(quotes: Followup[], text: string): string {
  if (!quotes.length) return text
  const blocks = quotes.map((q, i) => {
    const marker = QUOTE_MARKERS[i] ?? `[${i + 1}]`
    const note = q.note.trim()
    const head = `> ${marker} ${q.excerpt}`
    return note ? `${head}\n\n${note}` : head
  })
  const joined = blocks.join('\n\n')
  return text ? `${joined}\n\n${text}` : joined
}

// One row of a TodoWrite call's checklist (sidecar SessionStep.todos). Carried on
// `note` steps; mapped to the ui Todo shape for the docked SessionTodoPanel.
type EngineTodo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

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
  todos?: EngineTodo[]
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
  // Provider error cause on a graceful `error` stop (or the budget-refusal
  // message). Surfaced from this event so the alert shows even when the
  // sendMessage RPC response is dropped/late — see surfaceTurnError.
  errorMessage?: string
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
  // Per-session SSH tool approval mode (ADR 0064 P2).
  sshApprovalMode?: SshApprovalMode
}
type SessionSummaryDto = {
  id: string
  title: string
  projectId: string | null
  updatedAt: string
  // Session creation time (sidecar SessionSummary.createdAt) — drives the list
  // "Sort by → Created". Optional for back-compat with a summary written before it.
  createdAt?: string
  pinned?: boolean
  settings?: EngineSessionSettings
  disabledTools?: string[]
  mcpServerIds?: string[]
  // Task this session discusses (ADR 0055) — mirrors sidecar SessionSummary.
  aboutTaskId?: string
  // SSH host this session works with (ADR 0064) — mirrors sidecar SessionSummary.
  aboutSshHostId?: string
  // GitHub issue/PR this session was opened from — mirrors sidecar SessionSummary.
  aboutGhUrl?: string
  // Fork parent (its session id) — mirrors sidecar SessionSummary; drives fork tree.
  parentSessionId?: string
  messageCount: number
  lastPreview?: string
  // Resting status derived by the sidecar from the last message (never 'streaming')
  // — lets the list badge awaiting/error/done without loading the transcript.
  // Optional for back-compat with an index.json written before the field shipped.
  status?: SessionStatus
}

// sessions.get full transcript (sidecar Session). Engine messages use string ids
// + role 'agent'; we translate to the ui-next SessionMessage shape on hydrate.
// Persisted attachment shape on an engine message (sidecar SessionAttachment).
// Distinct from the ui-next SessionAttachment — mapped back by engineAttToSession.
type EngineAttachment = {
  id?: string
  name: string
  type: 'file' | 'image'
  size?: string
  mime?: string
  url?: string
  preview?: string
  path?: string
}
type EngineMessage = {
  id: string
  role: 'user' | 'agent' | 'system'
  text: string
  at?: string
  steps?: EngineStep[]
  parts?: ({ kind: 'text'; text: string } | EngineStep)[]
  error?: { message: string }
  // User attachments persisted on the turn (sidecar SessionMessage.attachments).
  // Restored on hydrate so a reload keeps the attachment chips + previews.
  attachments?: EngineAttachment[]
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
  pinnedContext?: { files?: string[]; notes?: string; notePresets?: string[] }
  workspaceFolder?: string
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
  const { SESSIONS, modelsFor } = useSessionsData()
  const { accounts, accountById, accountByDisplay, modelsForAccount } = useAccounts()
  const settingsStore = useSettingsStore()
  const projectsStore = useProjectsStore()
  const useIpc = sc.available

  // In IPC mode start empty (hydrate from sidecar); in mock mode use the seed.
  const sessions = ref<Session[]>(useIpc ? [] : SESSIONS)
  const activeId = ref<number | null>(useIpc ? null : (sessions.value[0]?.id ?? null))
  const active = computed<Session | null>(
    () => sessions.value.find((s) => s.id === activeId.value) ?? null,
  )

  // Whether the ACTIVE session's runtime supports mid-turn steering. Only the Pi
  // runtime (non-anthropic providers) polls getSteeringMessages; the Claude SDK
  // path (anthropic) runs a single-prompt query with no steering hook, so a steer
  // there is dropped. The composer reads this to QUEUE instead of steer (never
  // silently swallow the message). Provider is derived the same way engineSettings
  // resolves it (selected account → the account's provider, else the display tail).
  const activeCanSteer = computed<boolean>(() => {
    const s = active.value
    if (!s) return false
    const opt = s.accountId ? accountById(s.accountId) : undefined
    const provider = (opt?.provider ?? s.account.split(' · ')[1] ?? 'Anthropic').toLowerCase()
    return provider !== 'anthropic'
  })

  // Selection state for bulk actions (§1). Reactive set of client ids. `selecting`
  // is the select-mode toggle (rows show checkboxes + the bulk bar appears); it
  // lives in the store rather than SessionList because the project-tab context menu
  // (SessionTabBar) also enters select mode (select-all-in-project).
  const selectedIds = ref<Set<number>>(new Set())
  const selecting = ref(false)

  // ── Project tabs (VSCode-style) ─────────────────────────────────────────────
  // The Sessions screen shows one tab per OPENED project ('' = the Default tab for
  // unassigned sessions). `activeTab` is the projectId currently shown; the list is
  // filtered to it (`tabSessions`). Each tab remembers the session last viewed in it
  // (`lastActiveByProject`) so switching tabs restores it — like a VSCode editor
  // group. A single global `activeId` stays the source of truth for the open session
  // (every consumer reads `active`/`activeId` unchanged); `activate()` keeps the
  // active tab + per-tab memory in sync with it. Only `openProjectTabs`/`activeTab`
  // persist (UI prefs, same class as the old `awog.sessions.filter.*` keys); the
  // per-tab memory stays in-memory so it never points at a deleted session.
  const STORAGE_OPEN_TABS = 'awog.sessions.tabs'
  const STORAGE_ACTIVE_TAB = 'awog.sessions.activeTab'

  function readOpenTabs(): string[] {
    try {
      const arr: unknown = JSON.parse(localStorage.getItem(STORAGE_OPEN_TABS) ?? '[]')
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string')
    } catch {
      // Corrupt value → no tabs (hydrate re-seeds from the loaded session list).
    }
    return []
  }

  const openProjectTabs = ref<string[]>(readOpenTabs())
  const activeTab = ref<string>(localStorage.getItem(STORAGE_ACTIVE_TAB) ?? '')
  const lastActiveByProject = ref<Record<string, number | null>>({})

  // Sessions in the active tab — the list operates on this (pinned-first sort is
  // applied by the list view, not here).
  const tabSessions = computed<Session[]>(() =>
    sessions.value.filter((s) => s.project === activeTab.value),
  )

  // Persist only the tab set + active tab. Both refs are always reassigned (never
  // mutated in place), so a shallow watch fires correctly.
  watch(openProjectTabs, (v) => localStorage.setItem(STORAGE_OPEN_TABS, JSON.stringify(v)))
  watch(activeTab, (v) => localStorage.setItem(STORAGE_ACTIVE_TAB, v))

  let seq = 1
  const newClientId = () => Date.now() + seq++

  const byId = (id: number) => sessions.value.find((s) => s.id === id)
  const byEngineId = (eid: string) => sessions.value.find((s) => s.engineId === eid)

  // Context-window usage percentage (0..100) for a session. Mirrors
  // useSessionContextUsage: occupancy = the assembled prompt content the model sees
  // (the engine's per-segment breakdown, contextTokensFromChars) over the SELECTED
  // model's window — NOT the API usage total, which double-counts the cached prefix
  // and adds output, inflating the gauge past 100%. 0 when no real turn has run yet
  // (no breakdown / browser-dev). Shared by the auto-compact trigger + quota guard.
  function usagePct(s: Session): number {
    const used = contextTokensFromChars(s.usage?.contextChars)
    if (!used) return 0
    const max = s.usage?.max ?? contextLimitFor(modelIdFromDisplay(s.model))
    if (!max) return 0
    return Math.min(100, (used / max) * 100)
  }

  // ── Account rate-limit quota (Settings → Usage quota) ─────────────────────
  // The REAL plan usage the account popover shows: the Anthropic 5-hour rate-limit
  // bucket (account.usage RPC → /api/oauth/usage), NOT the per-session context
  // window. Keyed by accountId, `fiveHour` is a 0..100 percentage. Refreshed by the
  // app-lifetime quota guard (useQuotaGuard) on a 60s cadence (matches the sidecar
  // cache) and forced right after one of the account's turns settles.
  const quotaUsage = ref<Record<string, { fiveHour: number; resetsAt?: number }>>({})
  // When each account's usage was last read (epoch ms). checkSendBlocked trusts the
  // polled cache within this window instead of paying a fresh account.usage round-trip
  // before every send — that latency showed up as a delay before the sent message
  // appeared. The app-lifetime guard already refreshes on a 60s cadence.
  const quotaFetchedAt = new Map<string, number>()
  const QUOTA_CACHE_TTL_MS = 90_000

  function quotaPctForAccount(accountId: string | undefined): number {
    if (!accountId) return 0
    return quotaUsage.value[accountId]?.fiveHour ?? 0
  }

  // account.usage only has a usage surface for anthropic + openai (subscription).
  function providerKeyOf(display: string): 'anthropic' | 'openai' | null {
    for (const [key, label] of Object.entries(PROVIDER_DISPLAY)) {
      if (label === display && (key === 'anthropic' || key === 'openai')) return key
    }
    return null
  }

  // Fetch one account's 5-hour utilization. Best-effort: the panel never hard-errors
  // (browser-dev, API-key account, or a rate-limited fetch) → keep the prior value.
  async function refreshAccountQuota(accountId: string, force = false): Promise<void> {
    if (!useIpc) return
    const acct = accountById(accountId)
    if (!acct) return
    const provider = providerKeyOf(acct.provider)
    if (!provider) return
    try {
      const res = await sc.request<{ usage: UsageEntry[] }>('account.usage', {
        provider,
        accountId,
        ...(force ? { force: true } : {}),
      })
      const five = res.usage?.find((u) => u.rateLimitType === 'five_hour')
      const next: { fiveHour: number; resetsAt?: number } = {
        fiveHour: five ? Math.min(100, Math.round(five.utilization * 100)) : 0,
      }
      if (five?.resetsAt) next.resetsAt = five.resetsAt
      quotaUsage.value = { ...quotaUsage.value, [accountId]: next }
      quotaFetchedAt.set(accountId, Date.now())
    } catch {
      // best-effort — keep the last known value
    }
  }

  // Refresh every account currently in use plus the default account (so the
  // block-new gate is accurate before any turn has run).
  function refreshQuotaUsage(force = false): void {
    if (!useIpc) return
    const ids = new Set<string>()
    for (const s of sessions.value) if (s.accountId) ids.add(s.accountId)
    const def = defaultAccountAndModel().acct
    if (def) ids.add(def.id)
    for (const id of ids) void refreshAccountQuota(id, force)
  }

  // Quota guard (Settings → Usage quota). True when the account a NEW session would
  // use has crossed the 5-hour usage threshold AND `blockNewSessionsOnThreshold` is
  // enabled — `create()` reads this to refuse the session. Per-account: a maxed
  // account never blocks a session on a different account.
  const newSessionsBlocked = computed<boolean>(() => {
    const q = settingsStore.quota
    if (!q.enabled || !q.blockNewSessionsOnThreshold) return false
    const acct = defaultAccountAndModel().acct
    if (!acct) return false
    return quotaPctForAccount(acct.id) >= q.threshold
  })

  // Block-reason notifier (registered by useQuotaGuard). The store owns the gate in
  // create() but has no i18n, so the guard registers a callback to push a localised
  // "blocked" toast when a new session is refused. No-op until registered.
  let notifyBlocked: ((account: string, kind: 'create' | 'send') => void) | null = null
  function onQuotaBlocked(fn: (account: string, kind: 'create' | 'send') => void): void {
    notifyBlocked = fn
  }

  // True when Settings → Usage quota blocking is on AND the session's account has
  // crossed its 5-hour threshold, using whatever usage is currently cached (sync).
  function isSendBlocked(sessionId: number): boolean {
    const q = settingsStore.quota
    if (!q.enabled || !q.blockNewSessionsOnThreshold) return false
    const s = byId(sessionId)
    if (!s) return false
    return quotaPctForAccount(s.accountId) >= q.threshold
  }

  // Block-BEFORE-send check: ensure the account's 5-hour usage is fresh (awaits one
  // refresh — cheap, the sidecar caches it 60s and each turn force-refreshes on
  // settle) THEN decide. Closes the fail-open window where a just-opened app hasn't
  // polled yet. The composer awaits this to refuse a turn while keeping the draft;
  // sendMessage awaits it as the backstop for every other turn-starting path (queue
  // drain, resend, run-as-task, regenerate).
  async function checkSendBlocked(sessionId: number): Promise<boolean> {
    const q = settingsStore.quota
    if (!q.enabled || !q.blockNewSessionsOnThreshold) return false
    const s = byId(sessionId)
    if (!s?.accountId) return false
    // Trust a recently-read cache (the guard polls every 60s + forces on turn settle)
    // so the common send pays no account.usage round-trip — that latency was showing up
    // as a delay before the sent message appeared. Only refresh when the cache is stale
    // or was never read (e.g. right after app open), which keeps the fail-open window
    // closed exactly where it matters. Also dedupes the composer + store double-check:
    // the first refresh stamps the cache, the second sees it fresh.
    const fetchedAt = quotaFetchedAt.get(s.accountId) ?? 0
    if (Date.now() - fetchedAt < QUOTA_CACHE_TTL_MS) return isSendBlocked(sessionId)
    await refreshAccountQuota(s.accountId)
    return isSendBlocked(sessionId)
  }

  // Auto-compaction trigger (Settings → Sessions → autoCompact). The sidecar has no
  // server-side auto-compact loop — `/compact` is a client-driven RPC — so we drive
  // it here: once a turn settles and the session crosses the auto-compact threshold,
  // fire compactSession() (the real ADR 0047 RPC, same as the manual button). The
  // sidecar persists a checkpoint and trims the model context on the NEXT turn; the
  // transcript is left intact. Guarded so it never fires twice for one threshold
  // crossing (a per-engineId latch reset when usage drops back below the band).
  const AUTO_COMPACT_PCT = 85
  const autoCompactedAt = new Map<string, boolean>()
  function maybeAutoCompact(s: Session): void {
    if (!useIpc || !s.engineId || !settingsStore.sessions.autoCompact) return
    const pct = usagePct(s)
    const latched = autoCompactedAt.get(s.engineId) ?? false
    // Reset the latch once usage falls well below the band (a fresh compaction cut
    // frees space) so a later re-fill can auto-compact again.
    if (pct < AUTO_COMPACT_PCT - 15) {
      if (latched) autoCompactedAt.set(s.engineId, false)
      return
    }
    if (pct < AUTO_COMPACT_PCT || latched) return
    autoCompactedAt.set(s.engineId, true)
    void compactSession(s.id)
  }

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
    // TodoWrite (`note`) → a carrier block holding the checklist. It is NOT rendered
    // inline (SessionMessageItem skips todo blocks → no empty "(no output)" step);
    // the docked SessionTodoPanel scans the transcript for the latest one. Always
    // carry a `todos` array (possibly empty) so the block stays identifiable.
    if (step.kind === 'note') {
      return {
        kind: 'step',
        tool: step.label || 'Todos',
        target: '',
        eid: step.id,
        todos: mapTodos(step.todos),
      }
    }
    // tool / group → a step block.
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

  // Engine TodoItem[] → ui Todo[]: carry the 3-state status; `done` mirrors completed.
  function mapTodos(items?: EngineTodo[]): Todo[] {
    if (!items?.length) return []
    return items.map((it) => ({
      t: it.content,
      done: it.status === 'completed',
      status: it.status,
    }))
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
    // A subagent's TodoWrite has no inline representation (it'd render an empty
    // "(no output)" row); the docked panel only tracks the main agent's checklist.
    if (c.kind === 'note') return null
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
      // Canonicalize to the engine slug: an old session may have persisted the
      // display label (pre-fix bug) — normalize so it round-trips + re-applies.
      style: normalizeStyleSlug(dto.settings?.responseStyle),
      // Resting status from the sidecar (derived from the last message) so the list
      // badges awaiting/error/done without opening the session. Fallback for a
      // legacy index.json missing the field: a session with messages is a finished
      // turn → 'done', an empty one is a fresh draft → 'idle'. Opening still refines
      // it via ensureLoaded → statusFromMessages.
      status: dto.status ?? (dto.messageCount > 0 ? 'done' : 'idle'),
      when: relativeWhen(dto.updatedAt),
      pinned: dto.pinned ?? false,
      mode: modeDisplay(dto.settings?.mode),
      msgs: [],
      loaded: false,
    }
    if (dto.createdAt) session.createdAt = dto.createdAt
    if (dto.updatedAt) session.updatedAt = dto.updatedAt
    if (dto.settings?.accountId) session.accountId = dto.settings.accountId
    if (dto.settings?.level) session.thinkingLevel = dto.settings.level
    if (dto.settings?.responseStyleNoMarkdown) session.noMarkdown = true
    if (dto.settings?.sshApprovalMode) session.sshApprovalMode = dto.settings.sshApprovalMode
    if (dto.disabledTools) session.disabledTools = [...dto.disabledTools]
    if (dto.mcpServerIds) session.mcpServerIds = [...dto.mcpServerIds]
    if (dto.aboutTaskId) session.aboutTaskId = dto.aboutTaskId
    if (dto.aboutSshHostId) session.aboutSshHostId = dto.aboutSshHostId
    if (dto.aboutGhUrl) session.aboutGhUrl = dto.aboutGhUrl
    if (dto.parentSessionId) session.parentSessionId = dto.parentSessionId
    return session
  }

  // Snapshot relative-time label for `when` at hydrate. NOTE: this is a one-shot
  // snapshot — the session LIST renders its own LIVE label off `updatedAt` + useNow
  // (see SessionListItem), so it never goes stale. `when` remains for the other,
  // lower-churn consumers (tray, fork graph, home dashboard's parseWhen).
  function relativeWhen(iso?: string): string {
    return relativeTime(iso)
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
      seedTabsFromSessions()
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
        const mapped = full.messages.map((m) => engineMessageToSessionMessage(m))
        // Historical messages never change once persisted, so mark them raw: Vue then
        // skips building reactive proxies for their (often deep) blocks/steps subtree.
        // That proxy construction — realized when a full-transcript computed such as
        // useSessionContextUsage iterates msgs — was the O(messages) scripting spike on
        // opening a long session, even though only the last few turns actually render.
        // The LAST message stays reactive so a restored interactive tail (pending
        // permission / question / plan) and the next streamed turn still update live.
        mapped.forEach((m, i) => {
          if (i < mapped.length - 1) markRaw(m)
        })
        target.msgs = mapped
        target.status = statusFromMessages(target.msgs)
        // Hydrate pinned context / budget / fork lineage (full session only).
        if (full.pinnedContext) target.pinnedContext = full.pinnedContext
        if (full.workspaceFolder) target.workspaceFolder = full.workspaceFolder
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

  // Engine attachment (persisted on a user turn) → ui-next SessionAttachment so a
  // JSONL reload restores the attachment chips + previews. Mirrors the forward map
  // in sendMessage (att → engineAtts): image/PDF `url` (base64) → dataUrl (drives
  // both re-feed and the in-app preview), text file `preview` → text, everything
  // else keeps its `path` reference.
  function engineAttToSession(a: EngineAttachment): SessionAttachment {
    const att: SessionAttachment = { name: a.name, img: a.type === 'image' }
    if (a.url) {
      att.dataUrl = a.url
      att.src = a.url
    }
    if (a.preview) att.text = a.preview
    if (a.path) att.path = a.path
    if (a.mime) att.mime = a.mime
    return att
  }

  function engineMessageToSessionMessage(m: EngineMessage): Session['msgs'][number] {
    if (m.role === 'user') {
      return {
        role: 'user',
        text: m.text,
        at: m.at ?? '',
        ...(m.attachments?.length ? { att: m.attachments.map(engineAttToSession) } : {}),
      }
    }
    if (m.role === 'system') {
      return { role: 'system', text: m.text, at: m.at ?? '' }
    }
    return { role: 'assistant', at: m.at ?? '', eid: m.id, blocks: engineMessageToBlocks(m) }
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  // Open a session AND sync the project tab + per-tab memory to it. The single
  // internal entry point for every "open a session" path (setActive, create,
  // createForTask, fork, the remove fallback) — so selecting a session ANYWHERE
  // (incl. Command Palette / Project overview / tray) auto-opens + activates its
  // project tab with no callsite changes.
  function activate(id: number) {
    const s = byId(id)
    if (!s) return
    activeId.value = id
    s.unread = false
    const proj = s.project
    if (!openProjectTabs.value.includes(proj)) {
      openProjectTabs.value = [...openProjectTabs.value, proj]
    }
    activeTab.value = proj
    lastActiveByProject.value = { ...lastActiveByProject.value, [proj]: id }
    if (useIpc) void ensureLoaded(id)
  }

  // Add a project's tab to the open set (no activation). '' = the Default tab.
  function openTab(projectId: string) {
    if (!openProjectTabs.value.includes(projectId)) {
      openProjectTabs.value = [...openProjectTabs.value, projectId]
    }
  }

  // Switch to a project's tab, restoring the session last viewed there (else the
  // project's first session, else leave nothing active → the tab's empty state).
  function setActiveTab(projectId: string) {
    openTab(projectId)
    const remembered = lastActiveByProject.value[projectId]
    const target =
      remembered != null && byId(remembered)?.project === projectId
        ? remembered
        : (sessions.value.find((s) => s.project === projectId)?.id ?? null)
    if (target != null) {
      activate(target) // sets activeTab + activeId + last-active + ensureLoaded
    } else {
      activeTab.value = projectId
      activeId.value = null
    }
  }

  // The Default tab ('') auto-closes once it has no sessions AND ≥1 other tab is
  // open (it's implicit, not user-opened). Returns true when it pruned. Real project
  // tabs stay open when empty (the user opened them; they show an empty state).
  function pruneEmptyDefaultTab(): boolean {
    if (sessions.value.some((s) => !s.project)) return false
    const others = openProjectTabs.value.filter((p) => p !== '')
    if (!others.length) return false
    if (openProjectTabs.value.includes('')) openProjectTabs.value = others
    if (activeTab.value === '') setActiveTab(others[0]!)
    return true
  }

  // Close a tab (VSCode-style): never deletes sessions. Closing the active tab moves
  // to the left neighbour (else right, else any). The Default tab is not user-closable
  // (pruneEmptyDefaultTab manages it).
  function closeTab(projectId: string) {
    if (projectId === '') return
    const idx = openProjectTabs.value.indexOf(projectId)
    if (idx < 0) return
    const next = openProjectTabs.value.filter((p) => p !== projectId)
    openProjectTabs.value = next
    if (activeTab.value !== projectId) return
    const fallback = next[idx - 1] ?? next[idx] ?? null
    if (fallback != null) setActiveTab(fallback)
    else {
      activeTab.value = ''
      activeId.value = null
    }
  }

  // Bulk tab-close (VSCode-style). None of these delete sessions — they only drop
  // tabs from the open set; the Default tab ('') is never closed (it's the unscoped
  // "home", auto-managed by pruneEmptyDefaultTab).
  function closeOtherTabs(keepProjectId: string) {
    openProjectTabs.value = openProjectTabs.value.filter((p) => p === keepProjectId || p === '')
    setActiveTab(keepProjectId)
    pruneEmptyDefaultTab()
  }
  function closeTabsToRight(projectId: string) {
    const idx = openProjectTabs.value.indexOf(projectId)
    if (idx < 0) return
    openProjectTabs.value = openProjectTabs.value.filter((p, i) => i <= idx || p === '')
    if (!openProjectTabs.value.includes(activeTab.value)) setActiveTab(projectId)
    pruneEmptyDefaultTab()
  }
  function closeAllTabs() {
    // Everything closed → fall back to the Default tab (the unscoped "home").
    openProjectTabs.value = ['']
    setActiveTab('')
  }
  // Move the tab `fromId` to `toIndex` in the tab order (drag-to-reorder in the tab
  // bar). Reassigns `openProjectTabs` (persisted via the watch) so `closeTabsToRight`
  // and friends keep working against the new index order. Active tab / per-tab memory
  // are untouched — reorder never changes which tab is selected. Dropping back to the
  // same slot is a no-op (no redundant persist).
  function reorderTabs(fromId: string, toIndex: number) {
    const tabs = openProjectTabs.value
    const from = tabs.indexOf(fromId)
    if (from < 0) return
    const clamped = Math.max(0, Math.min(toIndex, tabs.length - 1))
    if (from === clamped) return
    const next = tabs.slice()
    next.splice(from, 1)
    next.splice(clamped, 0, fromId)
    openProjectTabs.value = next
  }

  // Seed the open-tab set + active tab/session from the loaded sessions, reconciled
  // with the persisted tabs. Persisted tabs are kept only when they still have ≥1
  // session ('' kept only when unassigned sessions exist) so deleted projects don't
  // leave ghost tabs. First run (nothing valid persisted): open the most-recent
  // session's tab plus Default when any unassigned session exists.
  function seedTabsFromSessions(): void {
    const projectsWithSessions = new Set(sessions.value.map((s) => s.project))
    let seeded = openProjectTabs.value.filter((p) => projectsWithSessions.has(p))
    if (!seeded.length) {
      const first = sessions.value[0]
      if (first) seeded = [first.project]
      if (projectsWithSessions.has('') && !seeded.includes('')) seeded.unshift('')
    }
    openProjectTabs.value = seeded
    const persistedActiveValid = seeded.includes(activeTab.value)
    const wantTab = persistedActiveValid ? activeTab.value : (sessions.value[0]?.project ?? '')
    setActiveTab(wantTab)
  }

  function setActive(id: number) {
    activate(id)
  }

  // A turn just settled for `s` (terminal done/error). Flag it unread — drives the
  // session-list dot (`.undot`), the "Unread" group bucket, the NavRail "wait"
  // badge, and the tray indicator — UNLESS the user is actively viewing it: the
  // active session WITH the window focused. setActive() clears the flag when the
  // session is opened. Background turns, and turns that finish while the app is
  // blurred/hidden, get the dot. `awaiting` parks aren't flagged here — they
  // already surface via the amber status indicator + NavRail (status === 'awaiting').
  // Idempotent: safe to call from every settle path (RPC resolve, done event, throw).
  function flagSettledUnread(s: Session): void {
    if (s.status !== 'done' && s.status !== 'error') return
    const viewing =
      s.id === activeId.value &&
      typeof document !== 'undefined' &&
      !document.hidden &&
      document.hasFocus()
    if (!viewing) s.unread = true
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

  // Resolve the default account for a NEW session from Settings → Defaults: prefer
  // the configured provider's ACTIVE account (the one the user marked "Set active"),
  // then any account on that provider, then any account at all (else the mock seed
  // off-shell). Preferring the active account matters because a custom endpoint that
  // speaks the Anthropic/OpenAI protocol lives in that provider's bucket and shares
  // its display provider — without the active check, the first such account (e.g. a
  // custom endpoint) would win over the user's real subscription. Returns the chosen
  // account + the model display to seed (the default model when it's available on
  // that account, otherwise the account's first model).
  // Resolve the initial account / model / reasoning effort / MCP whitelist for a NEW
  // session. A project's "Session LLM defaults" (Sessions → right-click a project, or
  // the Project overview) take precedence over the global Settings → Defaults; any
  // field a project leaves unset falls back to the global default. The account is
  // chosen by: project-pinned account (when it still exists) → provider active account
  // → first account on the provider → any account. Preferring the active account
  // matters because a custom endpoint speaking the Anthropic/OpenAI protocol lives in
  // that provider's bucket and would otherwise win over the real subscription.
  // mcpServerIds: undefined = all enabled servers (default); [id…] = whitelist.
  function defaultsForNewSession(projectId?: string): {
    acct: ReturnType<typeof accountById>
    model: string
    level: ThinkingLevel
    mcpServerIds: string[] | undefined
  } {
    const g = settingsStore.defaults
    const ld = projectId ? projectsStore.projectById(projectId)?.llmDefaults : undefined
    const provider = ld?.provider ?? g.provider
    const modelId = ld?.modelId ?? g.modelId
    const level = ld?.level ?? g.thinkingLevel
    const mcpServerIds = ld?.mcpServerIds
    if (!useIpc) return { acct: undefined, model: 'Opus 4.8', level, mcpServerIds }
    const wantProvider = PROVIDER_DISPLAY[provider] ?? 'Anthropic'
    const inProvider = accounts.value.filter((a) => a.provider === wantProvider)
    const acct =
      (ld?.accountId ? inProvider.find((a) => a.id === ld.accountId) : undefined) ??
      inProvider.find((a) => a.isActive) ??
      inProvider[0] ??
      accounts.value[0] ??
      undefined
    const available = acct ? modelsForAccount(acct) : []
    // Default model id (e.g. 'claude-opus-4-8') → display name; use it only when the
    // chosen account actually offers it, else the account's first model.
    const wantModel = modelDisplayName(modelId)
    const model = available.includes(wantModel) ? wantModel : (available[0] ?? 'Opus 4.8')
    return { acct, model, level, mcpServerIds }
  }

  // Global default account/model (no project context) — the quota gate + usage
  // refresh read this. Thin wrapper over defaultsForNewSession().
  function defaultAccountAndModel(): { acct: ReturnType<typeof accountById>; model: string } {
    const { acct, model } = defaultsForNewSession()
    return { acct, model }
  }

  // Create a new session. `projectId` assigns it to a project up front (the
  // per-group "+" passes the group's project); omitted (the global "+") leaves the
  // project UNSET ('' = default) — the user picks one later via the crumb, since
  // at global-create time there's no project context to guess from.
  //
  // Quota guard (Settings → Usage quota): when `blockNewSessionsOnThreshold` is on
  // and the account this session would use has crossed its 5-hour usage threshold,
  // refuse to spawn it (returns null) — the single gate for every "+" callsite.
  // Disabled / under threshold → always creates.
  function create(projectId?: string): number | null {
    // Resolve the account THIS session would actually use — a project's "Session LLM
    // defaults" win over the global default — and gate quota on THAT account, not the
    // global default. Otherwise a maxed global-default account wrongly blocks a
    // project bound to a different, under-quota account (per-account is the point).
    const { acct, model, level, mcpServerIds } = defaultsForNewSession(projectId)
    const q = settingsStore.quota
    if (
      q.enabled &&
      q.blockNewSessionsOnThreshold &&
      acct &&
      quotaPctForAccount(acct.id) >= q.threshold
    ) {
      notifyBlocked?.(acct.label ?? acct.display ?? '', 'create')
      return null
    }
    // Dedup: don't pile up empties when "+" is clicked repeatedly. A blank "New
    // session" (fully loaded, no messages, no half-typed draft, idle, and not bound
    // to a task/issue) for the same project scope is reused — just re-select it.
    const scope = projectId ?? ''
    const blank = sessions.value.find(
      (s) =>
        s.project === scope &&
        s.loaded === true &&
        s.status === 'idle' &&
        s.msgs.length === 0 &&
        !s.draft?.trim() &&
        !s.aboutTaskId &&
        !s.aboutGhUrl,
    )
    if (blank) {
      activate(blank.id)
      return blank.id
    }
    const id = newClientId()
    // acct/model/level/mcpServerIds were resolved above (project defaults → global).
    const session: Session = {
      id,
      title: 'New session',
      project: projectId ?? '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model,
      account: acct?.display ?? 'hoatq · Anthropic',
      style: 'Default',
      status: 'idle',
      when: 'vừa xong',
      mode: modeDisplay(settingsStore.defaults.mode),
      thinkingLevel: level,
      msgs: [],
      loaded: true,
    }
    if (acct) session.accountId = acct.id
    if (mcpServerIds !== undefined) session.mcpServerIds = [...mcpServerIds]
    sessions.value.unshift(session)
    activate(id)
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
    const { acct, model, level, mcpServerIds } = defaultsForNewSession(projectId)
    const session: Session = {
      id,
      title,
      project: projectId,
      model,
      account: acct?.display ?? 'hoatq · Anthropic',
      style: 'Default',
      status: 'idle',
      when: 'vừa xong',
      mode: modeDisplay(settingsStore.defaults.mode),
      thinkingLevel: level,
      msgs: [],
      loaded: true,
      aboutTaskId: taskId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    if (acct) session.accountId = acct.id
    if (mcpServerIds !== undefined) session.mcpServerIds = [...mcpServerIds]
    sessions.value.unshift(session)
    activate(id)
    if (useIpc) {
      session.engineId = engineIdFor(id)
      pushUpsert(session, 'create')
    }
    return id
  }

  // Create a session bound to an SSH host to work with (ADR 0064, P1). Mirrors
  // createForTask() but seeds aboutSshHostId so the sidecar injects the
  // <linked_ssh_host> context each turn and the UI shows the "working with host"
  // banner. Returns the new client id so the caller (SSH → "Open in session") can
  // navigate to it.
  function createForSshHost(hostId: string, projectId?: string, title?: string): number {
    const id = newClientId()
    const { acct, model, level, mcpServerIds } = defaultsForNewSession(projectId)
    const session: Session = {
      id,
      title: title ?? '',
      project: projectId ?? '',
      model,
      account: acct?.display ?? 'hoatq · Anthropic',
      style: 'Default',
      status: 'idle',
      when: 'vừa xong',
      mode: modeDisplay(settingsStore.defaults.mode),
      thinkingLevel: level,
      msgs: [],
      loaded: true,
      aboutSshHostId: hostId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    if (acct) session.accountId = acct.id
    if (mcpServerIds !== undefined) session.mcpServerIds = [...mcpServerIds]
    sessions.value.unshift(session)
    activate(id)
    if (useIpc) {
      session.engineId = engineIdFor(id)
      pushUpsert(session, 'create')
    }
    return id
  }

  function remove(id: number) {
    const s = byId(id)
    const wasActive = activeId.value === id
    const proj = s?.project ?? ''
    sessions.value = sessions.value.filter((x) => x.id !== id)
    selectedIds.value.delete(id)
    // Forget per-tab memory pointing at the deleted session.
    if (lastActiveByProject.value[proj] === id) {
      lastActiveByProject.value = { ...lastActiveByProject.value, [proj]: null }
    }
    if (wasActive) {
      // Re-select within the SAME tab first (its remembered session if still there,
      // else its first session), then fall back to pruning/clearing.
      const inTab = sessions.value.filter((x) => x.project === activeTab.value)
      const remembered = lastActiveByProject.value[activeTab.value]
      const next =
        (remembered != null && inTab.some((x) => x.id === remembered)
          ? remembered
          : inTab[0]?.id) ?? null
      if (next != null) activate(next)
      else if (!pruneEmptyDefaultTab()) activeId.value = null
    } else {
      pruneEmptyDefaultTab()
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
    if (!s) return
    const wasActive = activeId.value === id
    s.project = project
    if (useIpc) pushUpsert(s, 'update-metadata')
    // The session moved buckets. If it's the one being viewed, follow it to the
    // destination tab (open + activate); always prune the source if it was an
    // emptied Default tab.
    if (wasActive) activate(id)
    pruneEmptyDefaultTab()
  }

  // Folder dragged into the session → becomes the runtime tools' cwd (forwarded
  // as workspacePath each turn). Persisted via update-metadata so it survives reload.
  function setWorkspaceFolder(id: number, path: string) {
    const s = byId(id)
    if (s) {
      s.workspaceFolder = path
      if (useIpc) pushUpsert(s, 'update-metadata')
    }
  }
  function clearWorkspaceFolder(id: number) {
    const s = byId(id)
    if (s) {
      delete s.workspaceFolder
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

  // Attach/detach the SSH host a session works with (ADR 0064). hostId → link (agent
  // gets the scoped ssh_* tools next turn); null → detach. Clear is persisted as ''
  // (buildUpsert sends aboutSshHostId when defined, so the sidecar patch clears it).
  function setAboutSshHost(id: number, hostId: string | null) {
    const s = byId(id)
    if (!s) return
    s.aboutSshHostId = hostId ?? ''
    if (useIpc) pushUpsert(s, 'update-metadata')
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
  // SSH tool approval mode (ADR 0064 P2). Persisted as metadata; takes effect on
  // the next turn via engineSettings (the sidecar reads it per turn).
  function setSshApprovalMode(id: number, mode: SshApprovalMode) {
    const s = byId(id)
    if (!s) return
    s.sshApprovalMode = mode
    if (useIpc) pushUpsert(s, 'update-metadata')
  }
  // SSH terminal co-pilot (ADR 0064): bind/unbind the visible terminal connId this
  // session drives. TRANSIENT — no upsert (the connId is ephemeral); only forwarded
  // per-turn in sendMessage. The docked SSH session panel calls this reactively.
  function setSshTerminalConnId(id: number, connId: string | null) {
    const s = byId(id)
    if (!s) return
    if (connId) s.sshTerminalConnId = connId
    else delete s.sshTerminalConnId
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
    if (
      p &&
      !(p.files && p.files.length) &&
      !(p.notes && p.notes.trim()) &&
      !(p.notePresets && p.notePresets.length)
    ) {
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
  // Applied reusable notes (from the preset/recent library), toggled like file pins:
  // each rides into the turn as its own <notes> entry, independent of the free-text
  // `notes`. Stored as the note TEXT (not a preset id) so it's self-contained — it
  // survives deleting the source preset or opening on another device. Toggling an
  // already-applied note removes it.
  function togglePinnedNotePreset(id: number, text: string) {
    const s = byId(id)
    const t = text.trim()
    if (!s || !t) return
    const cur = s.pinnedContext?.notePresets ?? []
    const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
    s.pinnedContext = { ...s.pinnedContext, notePresets: next }
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
  // Enter/exit multi-select mode; exiting clears the current selection.
  function setSelectMode(on: boolean) {
    selecting.value = on
    if (!on) clearSelection()
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
    // Snapshot the follow-up quotes attached right now so a quote-only queue (empty
    // draft + a quote) is a valid queued turn and the quotes survive to drain.
    const quotes = s.followups ?? []
    if (!trimmed && atts.length === 0 && quotes.length === 0) return
    const item: QueuedMessage = { text: trimmed }
    if (atts.length) item.att = [...atts]
    if (command) item.command = command
    if (quotes.length) item.quotes = [...quotes]
    s.queue = [...(s.queue ?? []), item]
    // Move the quotes into the queued item — clear the live set so they don't also
    // ride the composer's next message (and the composer's cards disappear, matching
    // how the queued draft/attachments clear).
    if (quotes.length) s.followups = []
  }
  function dequeue(id: number, i: number) {
    const s = byId(id)
    if (!s?.queue) return
    s.queue.splice(i, 1)
    if (!s.queue.length) delete s.queue
  }

  // Revise the text of a still-queued message before it drains. In-memory only, like
  // enqueue/dequeue — the queue is transient session state (no IPC / persistence).
  function editQueued(id: number, i: number, text: string) {
    const item = byId(id)?.queue?.[i]
    if (item) item.text = text
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
    // Pass the item's own quote snapshot as an override so draining doesn't consume
    // (or get clobbered by) any quotes the user added to the composer meanwhile.
    if (head) void sendMessage(id, head.text, head.att, head.command, head.quotes)
  }
  // "Send now" from a queued chip: stop the current turn and run THIS queued message
  // immediately (jump the queue). The sidecar serializes turns per session
  // (withSessionLock) + `sessions.cancel` aborts the in-flight turn to release that
  // lock, so the new turn safely queues behind the aborting one and starts once it
  // unwinds — no need to poll for the abort to finish. Removed from the queue up front
  // so neither the abort's (non-draining) finalize nor a racing drain re-fires it.
  async function sendQueuedNow(id: number, index: number) {
    const s = byId(id)
    const queue = s?.queue
    const item = queue?.[index]
    if (!s || !queue || !item) return
    queue.splice(index, 1)
    if (!queue.length) delete s.queue
    await cancel(id)
    await sendMessage(id, item.text, item.att, item.command, item.quotes)
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
    // Typewriter OFF (Settings → Sessions → typewriter): reveal text immediately
    // instead of animating it in. We still track the target on the typewriter so
    // flushText/upsertStep's "snap the open run" logic keeps working — just write
    // the trailing text run straight through with no reveal timer.
    if (!settingsStore.sessions.typewriter) {
      const tp = trailingText(m)
      if (tp) tp.text = tw.target
      return
    }
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

  // ── Stall watchdog ─────────────────────────────────────────────────────────
  // A bubble's "Streaming…" indicator + typewriter caret are driven by m.streaming,
  // cleared on EITHER the sendMessage RPC resolve/reject OR the session.message.done
  // event. Both ride the sidecar's stdout/event channel; if BOTH are lost in transit
  // (a dropped/corrupted stdout response line, or a webContents.send to a momentarily
  // absent window) the bubble is stranded "streaming" forever — the reply is complete
  // but the spinner + caret never stop. This watchdog recovers that: for any turn that
  // has been streaming past a grace period it asks the sidecar whether the turn is
  // still in flight (its aborter is live); when the turn has actually ended it
  // finalizes the bubble defensively. A genuinely-running turn (a long silent tool
  // call, a turn parked on a gate) reports active=true and is left untouched.
  //
  // Timing: recovery latency after a lost finalize signal ≈ the poll interval (the
  // stranded turn is almost always already past the grace by the time it finishes),
  // so the poll interval is the lever that decides how long the spinner lingers — kept
  // short. The grace can be low because the real safety net is the `blocks.length === 0`
  // guard below (a turn with rendered output has provably registered its aborter, so a
  // turnActive=false reading then is conclusive — the turn ended); the grace only avoids
  // probing a turn during its first second of setup, before any output.
  const STALL_GRACE_MS = 8_000 // min streaming age before a bubble is eligible to probe
  const STALL_POLL_MS = 3_000 // how often the watchdog sweeps
  let stallTimer: ReturnType<typeof setInterval> | null = null

  // Snap a stranded turn to its streamed text and drop the streaming flag — the same
  // settle the lost RPC resolve / done event would have done (minus the authoritative
  // usage/title, which can't be recovered here; the streamed chunks already carry the
  // visible reply). Idempotent: a no-op once the flag is cleared.
  function finalizeStuckTurn(s: Session, m: AssistantMessage): void {
    if (!m.streaming) return
    flushText(s.engineId ?? '', m.eid ?? '')
    m.streaming = false
    if (m.completedAt == null) m.completedAt = Date.now()
    s.status = statusFromMessages(s.msgs)
    flagSettledUnread(s)
  }

  // The engine died out from under EVERY session at once (engine.crashed). There
  // is no per-turn done event in this case, so finalize each in-flight streaming
  // turn with a terminal error alert — block-agnostic (a turn that crashed before
  // emitting any output is stranded on "Streaming…" otherwise and the stall
  // watchdog skips it). Idempotent: pushErrorBlock keeps one error block per turn,
  // and a turn already settled by its RPC reject is left untouched.
  function errorFinalizeStreamingTurns(message: string): void {
    for (const s of sessions.value) {
      let touched = false
      for (const m of s.msgs) {
        if (m.role !== 'assistant' || !m.streaming) continue
        flushText(s.engineId ?? '', m.eid ?? '')
        pushErrorBlock(m, message)
        m.streaming = false
        if (m.completedAt == null) m.completedAt = Date.now()
        touched = true
      }
      if (touched) {
        s.status = statusFromMessages(s.msgs)
        flagSettledUnread(s)
      }
    }
  }

  async function sweepStalledTurns(): Promise<void> {
    const now = Date.now()
    for (const s of sessions.value) {
      if (!s.engineId) continue
      const m = s.msgs.find((x) => x.role === 'assistant' && x.streaming)
      if (!m || m.role !== 'assistant' || !m.eid) continue
      if (m.startedAt == null || now - m.startedAt < STALL_GRACE_MS) continue
      try {
        const res = await sc.request<{ active: boolean }>('sessions.turnActive', {
          sessionId: s.engineId,
          messageId: m.eid,
        })
        // active=false is CONCLUSIVE only for a turn that has produced output (it has
        // provably registered its aborter). A bubble with no blocks yet is still in
        // long startup (folding a big transcript) — probing it could read active=false
        // and finalize a turn that is genuinely about to run, so leave it.
        // Re-check m.streaming after the await: the real finalize may have landed
        // meanwhile (its handlers are idempotent, but skip the redundant work).
        if (!res.active && m.streaming && m.blocks.length > 0) finalizeStuckTurn(s, m)
      } catch (err) {
        // A dead/unavailable engine means the turn is gone for good (the sidecar
        // crashed — engine.crashed normally finalizes it first; this covers a missed
        // event or the restart window). Finalize with an error alert REGARDLESS of
        // blocks, so a turn that crashed before emitting output isn't stranded on
        // "Streaming…". A transient probe failure with a live engine (any other code)
        // is left for the next sweep.
        const dead =
          err instanceof SidecarUnavailableError ||
          (err instanceof SidecarError && err.code === -32000)
        if (dead && m.streaming) {
          pushErrorBlock(m, 'The engine stopped unexpectedly. Retry to continue.')
          finalizeStuckTurn(s, m)
        }
      }
    }
  }

  function startStallWatchdog(): void {
    if (!useIpc || stallTimer) return
    stallTimer = setInterval(() => void sweepStalledTurns(), STALL_POLL_MS)
  }

  // Append a turn error block (rendered as an alert + retry by SessionMessageItem).
  // Idempotent: a turn carries at most one terminal error, and several paths may try
  // to surface it — the RPC resolve, the RPC reject (catch), and the
  // session.message.done event (whichever lands; the RPC response can be dropped or
  // land late). Guarding on an existing error block keeps it to a single alert.
  function pushErrorBlock(m: AssistantMessage, text: string): void {
    if (m.blocks.some((b) => b.kind === 'error')) return
    m.blocks.push({ kind: 'error', text })
  }

  // Surface a terminal turn outcome that carries a stopReason: a graceful provider
  // `error` stop, or a pre-turn budget refusal. Other stopReasons (clean finish,
  // 'aborted' cancel) surface nothing. Thrown errors go through pushErrorBlock
  // directly (the catch has a richer, code-tagged message).
  function surfaceTurnError(
    m: AssistantMessage,
    stopReason?: string | null,
    errorMessage?: string,
  ): void {
    if (stopReason !== 'error' && stopReason !== 'budget-exceeded') return
    const fallback =
      stopReason === 'budget-exceeded' ? 'Session budget exceeded.' : 'The model returned an error.'
    pushErrorBlock(m, errorMessage || fallback)
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
          // title); this stops the spinner AND surfaces a terminal error.
          flushText(p.sessionId, p.messageId)
          // The done event carries no `parts`; reconcile only recovers the full
          // text on a single-run turn (safe), and leaves a multi-run turn's
          // per-run deltas intact. The RPC resolve still owns the authoritative
          // parts-based reconcile.
          if (typeof p.text === 'string') reconcileReplyText(m, p.text)
          m.streaming = false
          if (m.completedAt == null) m.completedAt = Date.now()
          // Surface a graceful `error` stop (e.g. "Request timed out.") / budget
          // refusal from THIS event, not only from the RPC resolve — the RPC
          // response can be dropped/late, which used to clear the spinner here
          // while the error alert (owned solely by the resolve) never appeared.
          // Idempotent with the RPC path (see surfaceTurnError).
          surfaceTurnError(m, p.stopReason, p.errorMessage)
          const s = byEngineId(p.sessionId)
          if (s) {
            s.status = statusFromMessages(s.msgs)
            // A turn just settled = the session was updated. Mirror the sidecar's
            // updatedAt bump so the list's live time label + "Updated" sort reflect it
            // (covers background/live turns not started via this client's sendMessage).
            s.updatedAt = new Date().toISOString()
            flagSettledUnread(s)
            // Drain the next queued message ONLY on a clean finish. A failed
            // ('error'), refused ('budget-exceeded'), or user-aborted ('aborted')
            // turn must not auto-run the queue — the next message would likely fail
            // the same way / wasn't meant to fire after a cancel. Idempotent with the
            // RPC path: whichever runs second sees the queue drained and no-ops.
            const clean =
              p.stopReason !== 'error' &&
              p.stopReason !== 'budget-exceeded' &&
              p.stopReason !== 'aborted'
            if (clean) drainQueue(s.id)
          }
          return
        }
        if (evt.type === 'engine.crashed' || evt.type === 'engine.fatal') {
          // The sidecar died unexpectedly out from under all sessions (see
          // electron/engine.ts). Every in-flight turn is dead — surface WHY on each
          // streaming bubble instead of leaving it stranded on "Streaming…". This is
          // the reliable, block-agnostic signal (the per-turn RPC reject races the UI
          // stream state; the stall watchdog skips turns that crashed before emitting
          // output). 'crashed' auto-restarts; 'fatal' gave up after a crash-loop.
          const message =
            evt.type === 'engine.fatal'
              ? 'The engine crashed repeatedly and could not restart. Restart the app to continue.'
              : 'The engine crashed and was restarted. This turn was interrupted — retry to continue.'
          errorFinalizeStreamingTurns(message)
          return
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
  // Human-readable, deterministic engine id (YYMMDD-adjective-noun-tail). MUST stay
  // deterministic + synchronous — the `if (!s.engineId) s.engineId = engineIdFor(s.id)`
  // fallback recomputes it from the same clientId. Existing sessions keep their old
  // `ses-…` ids (ids are never migrated); only new sessions get a slug.
  function engineIdFor(clientId: number): string {
    return slugSessionId(clientId)
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
    return (
      !!p &&
      ((p.files?.length ?? 0) > 0 ||
        (p.notes?.trim()?.length ?? 0) > 0 ||
        (p.notePresets?.length ?? 0) > 0)
    )
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
    // Send when defined (incl. '' = detach) so the sidecar patch can CLEAR the link;
    // omitted only for sessions that never linked a host (undefined). See setAboutSshHost.
    if (s.aboutSshHostId !== undefined) session.aboutSshHostId = s.aboutSshHostId
    if (s.aboutGhUrl) session.aboutGhUrl = s.aboutGhUrl
    if (s.pinnedContext) session.pinnedContext = s.pinnedContext
    if (s.workspaceFolder) session.workspaceFolder = s.workspaceFolder
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
    // A quote snapshot to use INSTEAD of the session's live `followups` (queue drain
    // passes the item's own quotes). When given, the live set is left untouched — the
    // user may have added new quotes for their next message meanwhile.
    quotesOverride?: Followup[],
  ) {
    const s = byId(id)
    const trimmed = text.trim()
    const atts = att ?? []
    const quotes = quotesOverride ?? s?.followups ?? []
    if (!s || (!trimmed && atts.length === 0 && quotes.length === 0)) return

    // Usage-quota gate (Settings → Usage quota): when blocking is on and this session's
    // account has crossed its 5-hour threshold, refuse to start a turn — the message is
    // NOT added. Awaits a fresh usage read so it blocks reliably even right after app
    // open. Same gate as create(), extended to new messages; backstop for every
    // turn-starting path (the composer also gates sendNow to preserve the draft).
    if (await checkSendBlocked(id)) {
      notifyBlocked?.(accountById(s.accountId ?? '')?.label ?? '', 'send')
      return
    }

    // Composing + sending here is definitive "I'm reading this": clear any unread flag
    // a prior turn set (e.g. it settled while the window was blurred, so flagSettledUnread
    // marked it) — otherwise the tab / NavRail / list badges linger on the session the
    // user is actively chatting in. Covers both the immediate send and the re-queue path.
    s.unread = false
    // Stamp last-activity so the list "Updated" sort + live time label track chatting
    // (the sidecar re-stamps on persist; this keeps the client order fresh until reload).
    // The list label is derived reactively from `updatedAt`, so we must NOT freeze a
    // "vừa xong" string onto `when` here — that used to strand the row on "vừa xong".
    s.updatedAt = new Date().toISOString()

    // Concurrency guard — never run two turns at once. A turn already streaming here
    // means a racing turn-start reached us mid-flight: the two finalize signals (the
    // done event + the RPC resolve) can BOTH call drainQueue, and the `await` above lets
    // the second slip past drainQueue's status check before the first flips it. Without
    // this, each pushes a user message + a streaming placeholder → the transcript shows
    // two "Streaming…" turns while only the first actually runs, and the queue drains out
    // of order. Re-queue at the FRONT so this message runs next, in FIFO order, once the
    // in-flight turn settles (drainQueue fires again on that turn's clean finish).
    if (s.msgs.some((m) => m.role === 'assistant' && m.streaming)) {
      const requeued: QueuedMessage = { text: trimmed }
      if (atts.length) requeued.att = [...atts]
      if (command) requeued.command = command
      if (quotes.length) requeued.quotes = [...quotes]
      s.queue = [requeued, ...(s.queue ?? [])]
      if (!quotesOverride) s.followups = []
      return
    }

    s.msgs.push({
      role: 'user',
      text: trimmed,
      at: new Date().toISOString(),
      att: atts.length ? atts : null,
      quotes: quotes.length ? quotes : null,
      command: command ?? null,
    })
    // Only clear the LIVE follow-ups when we consumed them (immediate send). A drain
    // passing `quotesOverride` must not wipe the quotes the user is staging next.
    if (!quotesOverride) s.followups = []

    // Model text folds the quoted excerpts + notes into the prompt (the `quotes`
    // above are display-only). This is also what makes a quote-only turn (empty
    // draft) carry content — otherwise the sidecar rejects the empty payload.
    const modelText = composeQuotedText(quotes, trimmed)

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

    await runEngineTurn(s, modelText, atts)
  }

  // Drive one real turn over IPC: placeholder bubble + stream subscription folds
  // events into it; finalize / cancel / error stamps the bubble.
  async function runEngineTurn(s: Session, text: string, atts: SessionAttachment[]) {
    if (!s.engineId) s.engineId = engineIdFor(s.id)
    const messageId = `m-${Date.now().toString(36)}-${(seq++).toString(36)}`
    // First exchange? (no prior assistant reply). Captured before the placeholder is
    // pushed. Drives early title generation below + the post-turn fallback.
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
    // Re-read the just-pushed element as the REACTIVE array proxy and mutate THAT
    // from here on. Mutating the raw `placeholder` local directly (placeholder.streaming
    // = false at finalize) does NOT trigger Vue reactivity — only writes through the
    // array's reactive proxy do (the live streaming path already goes through it via
    // findStreamingMsg). Using the raw ref made a finalize that ran via the RPC resolve
    // — rather than the done-event path, which re-reads the proxy — non-reactive: the
    // reply completed but the "working" indicator + elapsed timer never stopped, and the
    // done event / stall watchdog could no longer see it as streaming (raw was already
    // false) to recover it. Index right after push is provably the placeholder.
    const live = (s.msgs[s.msgs.length - 1] ?? placeholder) as AssistantMessage
    s.status = 'streaming'

    // Kick off the AI title NOW, in parallel with the turn — titling from the user's
    // opening message (passed directly, no dependency on the turn finishing or the
    // message being persisted). A long agentic first turn otherwise leaves the session
    // "New session" for minutes. The post-turn call below is the fallback if this fails.
    if (isFirstTurn) kickoffAutoTitle(s, text)

    // Engine attachments → what the sidecar delivers to the model per type:
    //   • image        → `url` (base64 data URL) → image block.
    //   • PDF          → `url` (base64 data URL) → document block (Anthropic path;
    //                    the Pi path can't take documents → it degrades to a `path`
    //                    reference). We send `path` too so the model can Read it.
    //   • text file    → `preview` (UTF-8 content) → delimited text block.
    //   • binary file  → `path` only → a reference line the model can Read via tool.
    // Folder attachments carry no model content — they ride to `contextFolders`
    // below (read-only <workspace_tree> context), so they're excluded here.
    const engineAtts = atts
      .map((a, i) => {
        if (a.folder) return null
        const base = {
          id: `att-${i}`,
          name: a.name,
          type: a.img ? ('image' as const) : ('file' as const),
          // Persist the MIME so a JSONL reload reconstructs the right data URL. The
          // mime otherwise lives only inside the base64 `url`, which the sidecar drops
          // when it externalizes the bytes — leaving reload to fall back to
          // application/octet-stream (memory: session-image-attachments).
          ...(a.mime ? { mime: a.mime } : {}),
        }
        const dataUrl = a.dataUrl ?? (a.src?.startsWith('data:') ? a.src : undefined)
        if (a.img) return dataUrl ? { ...base, url: dataUrl } : null
        // PDF (base64 data URL) → document/reference; carry `path` for Read too.
        if (dataUrl) return { ...base, url: dataUrl, ...(a.path ? { path: a.path } : {}) }
        if (a.text) return { ...base, preview: a.text, ...(a.path ? { path: a.path } : {}) }
        // Binary with a resolved on-disk path → reference-only.
        if (a.path) return { ...base, path: a.path }
        return null
      })
      .filter((a): a is NonNullable<typeof a> => a != null)

    // Folders attached to this turn → read-only <workspace_tree> context (multi-
    // folder). Absolute paths only; deduped. They do NOT change the cwd (the user
    // chose context, not a working dir), so the tools' cwd stays project/home.
    const contextFolders = [
      ...new Set(atts.filter((a) => a.folder && a.path).map((a) => a.path as string)),
    ]

    // Functional session prefs (Settings → Defaults / Sessions). Read per turn so a
    // settings change takes effect on the next message without recreating the session.
    //   • systemPrompt — replaces the sidecar's base prompt (blank = engine default).
    //   • instructions — appended after the base prompt (sidecar systemPromptAppend).
    //   • autoApprove  — skip the permission park (auto-allow gated tools).
    //   • refeedImages — re-feed prior-turn image attachments each turn (false = only
    //     the turn that sent them).
    const defaults = settingsStore.defaults
    const sessionPrefs = settingsStore.sessions
    const sysPrompt = defaults.systemPrompt.trim()
    const instructions = defaults.instructions.trim()

    try {
      const result = await sc.request<SendMessageResult>('sessions.sendMessage', {
        sessionId: s.engineId,
        messageId,
        text,
        ...(engineAtts.length ? { attachments: engineAtts } : {}),
        history: [],
        settings: engineSettings(s),
        // Session defaults / behaviour prefs (functional — consumed by the runtime).
        ...(sysPrompt ? { systemPrompt: sysPrompt } : {}),
        ...(instructions ? { instructions } : {}),
        ...(sessionPrefs.autoApprove ? { autoApprove: true } : {}),
        // refeedImages defaults true sidecar-side; forward only the opt-OUT so the
        // payload stays minimal and the engine keeps its current default otherwise.
        ...(sessionPrefs.refeedImages === false ? { refeedImages: false } : {}),
        // Co-author trailer (Settings → Git). commitCoAuthor defaults on; forward
        // only the opt-OUT so the runtime keeps its default-on trailer otherwise.
        ...(settingsStore.git.commitCoAuthor === false ? { commitCoAuthor: false } : {}),
        // Project linkage → sidecar resolves the project's on-disk path as the
        // tools' cwd. WITHOUT this, tools fall back to process.cwd() (the repo the
        // engine was launched from) — so a medbase-platform session would wrongly
        // operate on the awog repo. `s.project` holds the engine projectId.
        ...(s.project ? { projectId: s.project } : {}),
        // Dragged working folder → cwd for the turn (takes precedence over the
        // project path sidecar-side) + a <workspace_tree> orientation block.
        // (Legacy: folder attachments no longer set this — see contextFolders.)
        ...(s.workspaceFolder ? { workspacePath: s.workspaceFolder } : {}),
        // Attached folders → read-only <workspace_tree> context (multi-folder), does
        // NOT change the cwd.
        ...(contextFolders.length ? { contextFolders } : {}),
        // Session-scoped tool denylist + MCP whitelist (config popover).
        ...(s.disabledTools && s.disabledTools.length ? { disabledTools: s.disabledTools } : {}),
        ...(s.mcpServerIds !== undefined ? { mcpServerIds: s.mcpServerIds } : {}),
        // Discuss link (ADR 0055): the sidecar injects this task's output + trace
        // as <linked_task> context so the agent can reason about its results.
        ...(s.aboutTaskId ? { aboutTaskId: s.aboutTaskId } : {}),
        // Work link (ADR 0064): the sidecar injects this SSH host's connection info
        // as <linked_ssh_host> context so the agent knows the machine.
        ...(s.aboutSshHostId ? { aboutSshHostId: s.aboutSshHostId } : {}),
        // Co-pilot: the visible terminal to drive (ssh_terminal_run). Ephemeral, so
        // forwarded per-turn only (never persisted via upsert).
        ...(s.sshTerminalConnId ? { sshTerminalConnId: s.sshTerminalConnId } : {}),
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
      reconcileReplyText(live, result.text, result.parts)
      live.streaming = false
      live.completedAt = Date.now()
      // Surface a graceful provider `error` stop or a pre-turn budget refusal as an
      // error block. Idempotent with the session.message.done path (whichever lands
      // first wins; the RPC response here can be dropped/late) — see surfaceTurnError.
      surfaceTurnError(live, result.stopReason, result.errorMessage)
      // A budget-refused turn never reached the model: don't merge its zero usage
      // (that would wipe the context-window snapshot), don't drain the queue (the
      // next message would be refused too), and don't auto-title (a model call that
      // would bypass the very cap we just enforced).
      const refused = result.stopReason === 'budget-exceeded'
      if (!refused) {
        s.usage = mergeUsage(s.usage, result.usage, result.contextChars)
        // Auto-compaction (Settings → Sessions): client-driven /compact once this
        // session's context-window usage crosses the threshold (ADR 0047 RPC).
        maybeAutoCompact(s)
      }
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
      flagSettledUnread(s)
      // Clean finish → drain the next queued message FIFO.
      if (result.stopReason !== 'error' && !refused) drainQueue(s.id)
      // Fallback: if the early (on-send) title kickoff failed/raced, retry now that
      // the full first exchange is persisted (uses user + agent text from disk).
      // Deduped via kickoffAutoTitle — a no-op when the early one already landed, and
      // a manual rename (title ≠ default) is left untouched.
      if (isFirstTurn && result.stopReason !== 'error' && !refused) {
        kickoffAutoTitle(s)
      }
    } catch (err) {
      flushText(s.engineId, messageId)
      live.streaming = false
      live.completedAt = Date.now()
      const canceled = err instanceof SidecarError && err.code === -32023
      if (!canceled) {
        let message = 'Unknown error'
        if (err instanceof SidecarUnavailableError) message = 'Sidecar unavailable'
        else if (err instanceof SidecarError)
          message = err.code ? `${err.message} (code ${err.code})` : err.message
        else if (err instanceof Error && err.message) message = err.message
        else if (err != null) message = String(err)
        // Idempotent with the session.message.done path (the sidecar now emits a
        // terminal 'error' event on throw too, so the alert shows even if this reject
        // is dropped). Whichever lands first owns the single error block.
        pushErrorBlock(live, message)
      }
      s.status = statusFromMessages(s.msgs)
      // A user-cancel (-32023) is self-aware — don't flag unread. A real error does.
      if (!canceled) flagSettledUnread(s)
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
    // Response style (ADR 0046): send the ENGINE SLUG (STYLE_DIRECTIVES key) — the
    // sidecar keys its directives by slug, so sending the display label silently
    // dropped the style. normalizeStyleSlug guards any stale label in s.style.
    // Omitted when Default/unset = "Normal" (no directive). The no-markdown
    // modifier rides alongside.
    const styleSlug = normalizeStyleSlug(s.style)
    if (styleSlug !== 'Default') settings.responseStyle = styleSlug
    if (s.noMarkdown) settings.responseStyleNoMarkdown = true
    // SSH tool approval mode (ADR 0064 P2) — only forwarded when set to a
    // non-default; the sidecar defaults to 'prompt'. Meaningful only when the
    // session links an SSH host, but harmless to send otherwise.
    if (s.sshApprovalMode && s.sshApprovalMode !== 'prompt') {
      settings.sshApprovalMode = s.sshApprovalMode
    }
    return settings
  }

  // `/compact` (ADR 0047): summarise older turns to free token budget. Fires the
  // real RPC with the session's engine settings; the sidecar persists a
  // `session.compacted` checkpoint and trims model context on the NEXT turn (the
  // transcript is left intact). Returns false in browser-dev / on error / when
  // there is nothing to compact. keepRecentTokens 0 = keep only the last turn.
  async function compactSession(id: number): Promise<'compacted' | 'nothing' | 'error'> {
    const s = byId(id)
    if (!s || !useIpc || !s.engineId) return 'error'
    const es = engineSettings(s)
    const messageId = `compact-${Date.now().toString(36)}`
    // Guard against overlapping /compact calls (auto-compact + manual button) and
    // drive the composer's "compacting…" indicator + Send lock for the whole RPC.
    if (s.compacting) return 'nothing'
    s.compacting = true
    try {
      const res = await sc.request<{ ok?: boolean; reason?: string; historyChars?: number }>(
        'sessions.compact',
        {
          sessionId: s.engineId,
          messageId,
          provider: es.provider,
          modelId: es.modelId,
          ...(es.accountId ? { accountId: es.accountId } : {}),
          ...(s.project ? { projectId: s.project } : {}),
          keepRecentTokens: 0,
        },
      )
      if (res?.ok === false) {
        // Nothing summarised (transcript too short / no session) is not an error.
        return res.reason === 'nothing-to-compact' || res.reason === 'no-session'
          ? 'nothing'
          : 'error'
      }
      // Drop the context gauge IMMEDIATELY (before the next turn): swap the stale
      // `history` bucket for the post-compaction estimate the engine returned so the
      // reduction is visible the instant the checkpoint lands (ADR 0058). Other
      // buckets (system/tools/…) are unchanged by compaction.
      if (typeof res?.historyChars === 'number' && s.usage?.contextChars) {
        s.usage.contextChars = { ...s.usage.contextChars, history: res.historyChars }
      }
      return 'compacted'
    } catch (err) {
      console.warn('[sessions] compact failed', err)
      return 'error'
    } finally {
      s.compacting = false
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
    // Fallback when the steer doesn't land: a turn is still in flight (that's why we
    // tried to steer), so the text must NOT be dropped. If the session is still busy
    // — the common case: a runtime with no steering hook (Claude SDK → ok:false) —
    // QUEUE it as a follow-up turn so it runs (and shows as a chip) once the current
    // turn settles. If the turn already ended between click and RPC, send it now.
    const notLanded = () => {
      if (s.status === 'streaming' || s.status === 'awaiting') enqueue(id, trimmed)
      else void sendMessage(id, trimmed)
    }
    try {
      const res = await sc.request<{ ok: boolean }>('sessions.steer', {
        sessionId: s.engineId,
        messageId: streamingMsg.eid,
        text: trimmed,
      })
      if (!res.ok) notLanded()
    } catch (err) {
      console.warn('[sessions] steer failed', err)
      notLanded()
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

  // Distill the whole session into ONE self-contained handoff prompt (streaming
  // one-shot LLM). Used by the Export dialog's "Prompt" mode. When onDelta is given,
  // text chunks are forwarded live as the model generates; the returned string is the
  // authoritative full text. Throws on failure so the caller can surface it; the
  // transcript is read sidecar-side (needs engineId).
  let summarizeSeq = 0
  async function summarizeToPrompt(id: number, onDelta?: (delta: string) => void): Promise<string> {
    const s = byId(id)
    if (!s) throw new Error('Session not found')
    if (!useIpc || !s.engineId) {
      // Browser-dev / no engine: no model to call — return a crude placeholder.
      return `Continue the session "${s.title}".`
    }
    const settings = engineSettings(s)
    const requestId = `sum-${s.engineId}-${++summarizeSeq}`
    let unlistenChunks: (() => void) | undefined
    if (onDelta) {
      unlistenChunks = await sc.onEvent((evt) => {
        if (evt.type !== 'sessions.summarizePrompt.chunk') return
        const p = evt.payload as { requestId?: string; delta?: string }
        if (p.requestId === requestId && typeof p.delta === 'string') onDelta(p.delta)
      })
    }
    try {
      const res = await sc.request<{ text: string }>('sessions.summarizePrompt', {
        requestId,
        sessionId: s.engineId,
        provider: settings.provider,
        modelId: settings.modelId,
        ...(s.accountId ? { accountId: s.accountId } : {}),
      })
      return res.text
    } finally {
      unlistenChunks?.()
    }
  }

  // Summarize the first exchange into a concise title + rename. Best-effort: any
  // failure keeps the "New session" placeholder. Reads persisted messages on the
  // sidecar, so call only after the first turn has finalized.
  // Public wrapper for the session context menu: regenerate the title by id.
  async function regenerateTitle(id: number): Promise<void> {
    const s = byId(id)
    if (s) await autoGenerateTitle(s)
  }

  // Engine ids whose auto-title generation has already been kicked off, so the early
  // (parallel-with-turn) trigger and the post-turn fallback never double-fire. Cleared
  // on failure so a later turn can retry. Manual regenerate bypasses this entirely.
  const autoTitleStarted = new Set<string>()

  // Fire-and-forget auto title for a still-unnamed first-turn session, deduped across
  // the early + fallback triggers. `userText` lets it run BEFORE the turn finishes
  // (titles from the user's opening message alone, like Claude Code).
  function kickoffAutoTitle(s: Session, userText?: string): void {
    if (!useIpc || !s.engineId || s.title !== 'New session') return
    const eid = s.engineId
    if (autoTitleStarted.has(eid)) return
    autoTitleStarted.add(eid)
    void autoGenerateTitle(s, userText).then((ok) => {
      // Failed (race / model error) → allow a later turn to retry.
      if (!ok) autoTitleStarted.delete(eid)
    })
  }

  async function autoGenerateTitle(s: Session, userText?: string): Promise<boolean> {
    if (!useIpc || !s.engineId) return false
    const settings = engineSettings(s)
    try {
      const res = await sc.request<{ ok: boolean; title?: string }>('sessions.generateTitle', {
        sessionId: s.engineId,
        provider: settings.provider,
        modelId: settings.modelId,
        ...(s.accountId ? { accountId: s.accountId } : {}),
        ...(userText?.trim() ? { userText: userText.trim() } : {}),
      })
      if (res.ok && res.title) {
        rename(s.id, res.title)
        return true
      }
      return false
    } catch (err) {
      console.warn('[sessions] generateTitle failed', err)
      return false
    }
  }

  // ── Existing local actions (preserved 1:1) ──────────────────────────────────

  // Sessions with a regenerate/retry in flight. `regenerate` runs an async
  // truncate→re-run with an IPC round-trip in the middle; the message hover-action
  // buttons that call it carry no per-button disabled state, so a second click
  // during that window would fire a duplicate turn and corrupt the transcript.
  const regenInFlight = new Set<number>()

  async function regenerate(id: number, index: number) {
    const s = byId(id)
    if (!s) return
    // Block re-entry (same-tick double-click in the truncate window) and never
    // regenerate over a live streaming turn — same guard `resend` uses.
    if (regenInFlight.has(id)) return
    if (s.msgs.some((m) => m.role === 'assistant' && m.streaming)) return
    regenInFlight.add(id)
    try {
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
    } finally {
      regenInFlight.delete(id)
    }
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
      // Reset the source's LIVE run-state: the clone is a fresh idle session, not a
      // continuation of the source's in-flight turn. `...s` copies `status`, so forking
      // a RUNNING session used to inherit `status: 'streaming'` — which locks the
      // composer (Send → Stop/Queue, so new messages silently queue instead of sending)
      // and shows the fork stuck "running" with no turn to ever settle it. Derive the
      // status from the cloned (all-finalized) messages instead.
      status: statusFromMessages(msgs),
      // A fork is a brand-new session created now — override the timestamps copied
      // from the source via `...s` so it sorts as freshly created / updated.
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    delete branch.engineId
    delete branch.queue
    // Drop the rest of the source's transient run/UI state so the fork opens clean:
    // an in-flight `/compact`, a fetch-in-progress skeleton, and staged follow-up quotes
    // all belong to the source session, not the branch.
    delete branch.compacting
    branch.loading = false
    delete branch.followups
    // Record fork lineage: the branch's parent is THIS session (override any lineage
    // copied via `...s`). forkFromMessageId = the engine id of the fork point (the
    // last kept message). Drives the fork-tree graph; persisted via upsert.
    const forkPoint = msgs[msgs.length - 1]
    if (s.engineId) branch.parentSessionId = s.engineId
    else delete branch.parentSessionId
    if (forkPoint?.role === 'assistant' && forkPoint.eid) branch.forkFromMessageId = forkPoint.eid
    else delete branch.forkFromMessageId
    sessions.value.unshift(branch)
    activate(nid)
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
    // Keep the FULL selection (whitespace-collapsed only): the excerpt doubles as the
    // needle that locateMarks uses to paint the in-place highlight (§8), so truncating it
    // would highlight only the head of the quote. The display surfaces (composer card
    // `.fwq`, user-bubble `.uqx`) clamp it with CSS, so a long quote stays tidy on screen
    // without shrinking the highlighted span.
    let excerpt = (text ?? '').replace(/\s+/g, ' ').trim()
    if (!excerpt) {
      if (m.role !== 'assistant') return
      const tb = m.blocks.find((b) => b.kind === 'text')
      excerpt = ((tb && 'text' in tb ? tb.text : '') || 'trích dẫn').replace(/\s+/g, ' ').trim()
    }
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
    startStallWatchdog()
    // Returning to the window clears the OPEN session's unread flag. A turn that
    // settled while the app was blurred flags it (flagSettledUnread's focus check),
    // but coming back to look at it IS reading it — the symmetric clear. Background
    // sessions keep their dot until opened. App-lifetime listener (store is a
    // singleton), so no teardown — matches subscribe()/hydrate() above.
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', () => {
        const s = active.value
        if (s?.unread) s.unread = false
      })
    }
  } else {
    // Browser-dev: sessions are seeded synchronously from the mock; seed the tabs
    // from them (hydrate, which normally does this, is IPC-only).
    seedTabsFromSessions()
  }

  return {
    // state
    sessions,
    activeId,
    active,
    activeCanSteer,
    selectedIds,
    selecting,
    pendingPermission,
    // project tabs (VSCode-style)
    openProjectTabs,
    activeTab,
    tabSessions,
    openTab,
    closeTab,
    closeOtherTabs,
    closeTabsToRight,
    closeAllTabs,
    reorderTabs,
    setActiveTab,
    // quota / usage (Settings → Usage quota)
    usagePct,
    quotaUsage,
    quotaPctForAccount,
    refreshQuotaUsage,
    refreshAccountQuota,
    newSessionsBlocked,
    isSendBlocked,
    checkSendBlocked,
    onQuotaBlocked,
    // load (IPC)
    hydrate,
    ensureLoaded,
    openByEngineId,
    // crud
    setActive,
    create,
    createForTask,
    createForSshHost,
    remove,
    rename,
    regenerateTitle,
    summarizeToPrompt,
    setProject,
    setWorkspaceFolder,
    clearWorkspaceFolder,
    setAboutGh,
    setMode,
    setModel,
    setAccount,
    selectAccount,
    setStyle,
    setThinking,
    setNoMarkdown,
    setSshApprovalMode,
    setAboutSshHost,
    setSshTerminalConnId,
    setDisabledTools,
    setMcpServerIds,
    addPinnedFile,
    removePinnedFile,
    setPinnedNotes,
    togglePinnedNotePreset,
    setBudget,
    compactSession,
    // pin / bulk
    togglePin,
    toggleSelect,
    clearSelection,
    setSelectMode,
    bulkRemove,
    // queue
    enqueue,
    dequeue,
    editQueued,
    drainQueue,
    sendQueuedNow,
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
