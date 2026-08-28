// Sessions domain home: the canonical session TYPES (Session + message/assistant
// blocks, diff/tree shapes…) and the UI display helpers/catalog (STATUS_COLOR,
// model/provider display maps, GROUPBY, wpIcon, providerOf…) that the whole
// Sessions feature imports. TYPES + display helpers ONLY — this module carries no
// seed/sample data: every surface renders what the sidecar reports, or an empty
// state. Fabricated entities used to live here and leaked into the packaged app
// (a sample project, a sample account, a sample diff), so they are gone.

import type { ProviderName } from '~/stores/settings'
import type { TodoStatus } from '~/types'
import {
  providerModelsShown,
  providerModelDisplayName,
  providerModelIdFromDisplay,
} from '~/composables/useProviderModels'

export type Provider = 'Anthropic' | 'OpenAI' | 'Google'
export type SessionStatus = 'idle' | 'streaming' | 'awaiting' | 'done' | 'error'

export type DiffLine = { t: '+' | '-' | ' ' | '@'; n?: number; s: string }

export type SessionAttachment = {
  name: string
  img: boolean
  // Filled when a real file is dropped/picked (object URL for images, text content
  // for text-like files) so the shared PreviewModal can render an actual preview.
  // Absent when the engine reported no path → preview falls back to a placeholder.
  src?: string
  text?: string
  size?: number
  mime?: string
  // Inline base64 `data:` URL for an image, carried to the model (re-fed every
  // turn — see memory image-attachments). Set when the engine path needs to send
  // the image content; unset when only a `src` is known (preview uses that).
  dataUrl?: string
  // A dragged FOLDER (not a file): `path` is its absolute on-disk path. Shown on
  // the bubble as a folder chip (click → tree preview); on send it sets the
  // session's working folder (cwd). Carries no inline content — skipped by the
  // engine attachment mapping (the cwd is forwarded as workspacePath instead).
  folder?: boolean
  path?: string
}

// A quoted message carried into the next user turn (follow-up). `src` = index of the
// quoted message; `excerpt`/`note` show in the follow-up card + the user bubble.
// Persistent-highlight fields (§8): when a quote came from a text selection, the
// block index + char range let the UI re-render the highlight from STATE (survives
// message re-render) instead of mutating the DOM. Absent for whole-message quotes.
export type Followup = {
  src: number
  excerpt: string
  note: string
  blockIndex?: number
  start?: number
  end?: number
}

// How a step's `detail` string should render: a unified diff, full file content,
// terminal output, plain text, or a list. Drives SessionStepBody's view (so live
// Edit/Write show their real diff/file). Absent when the tool captured no detail.
export type StepDetailKind = 'diff' | 'file' | 'terminal' | 'text' | 'list'
export type SubStep = {
  // Engine step id — present on the IPC path so live deltas of the SAME subagent
  // step (e.g. a streaming `thinking` block whose label grows each delta) merge
  // in place instead of pushing a new row per delta.
  eid?: string
  tool: string
  target: string
  result?: string
  detail?: string
  detailKind?: StepDetailKind
}
export type SubAgent = { agent: string; steps: SubStep[] }

// `eid` (engine step/request id) is set only on the IPC path so live events can
// merge-by-id (running → done) and gate cards can resolve back to the sidecar
// (answerQuestion / permission).
export type ThinkingBlock = { kind: 'thinking'; text: string; eid?: string }
export type TextBlock = { kind: 'text'; text: string }
export type StepBlock = {
  kind: 'step'
  tool: string
  target: string
  result?: string
  detail?: string
  detailKind?: StepDetailKind
  sub?: SubAgent
  eid?: string
  status?: 'running' | 'done' | 'error'
  // A TodoWrite `note` step carries its checklist here instead of a detail body.
  // Such blocks are NOT rendered inline (SessionMessageItem skips them); the docked
  // SessionTodoPanel scans for the latest one. `undefined` = not a todo step.
  todos?: Todo[]
}
export type PlanBlock = {
  kind: 'plan'
  title: string
  // Authoritative plan source: the model's own markdown (headers, nested lists,
  // bold, blockquotes) rendered as a document in the card. `items` is the legacy
  // flattened fallback (engine steps with no planMarkdown).
  markdown?: string
  items: string[]
  status?: 'pending' | 'approved'
  eid?: string
}
export type QuestionOption = { label: string; desc?: string }
// One question within an AskUserQuestion call. A call carries 1–4 questions that
// are answered and submitted TOGETHER (the sidecar parks once and resumes with
// all answers), so each item keeps its own selection/answer state.
export type QuestionItem = {
  prompt: string
  options: QuestionOption[]
  multi?: boolean
  // Per-question header from the engine (AskUserQuestion) — needed to map the
  // answer back to the right question in the sidecar.
  header?: string
  // The user's chosen answer for THIS question (label(s)/free-text joined by
  // ", "); null/absent until submitted.
  answer?: string | null
}
export type QuestionBlock = {
  kind: 'question'
  // Every question in the call — render them all in one card with one Submit.
  items: QuestionItem[]
  eid?: string
  // Set when the turn was cancelled while this gate was still parked: the gate is
  // dead (answering it is a no-op), so it renders as "cancelled" and no longer
  // counts as "awaiting" (which otherwise kept the composer stuck on Stop).
  cancelled?: boolean
}
// A question gate is answered once EVERY question in the call has a recorded
// answer (one AskUserQuestion call = 1–4 questions submitted in one go).
export function questionAnswered(b: QuestionBlock): boolean {
  return b.items.length > 0 && b.items.every((it) => !!it.answer)
}
export type PermBlock = {
  kind: 'perm'
  tool: string
  target: string
  status?: 'pending' | 'allowed' | 'denied'
  // Permission request id from the engine — passed to sessions.permission.
  eid?: string
  // See QuestionBlock.cancelled — a parked permission abandoned by a turn cancel.
  cancelled?: boolean
}
export type SteerBlock = { kind: 'steer'; text: string }
export type ErrorBlock = { kind: 'error'; text: string }

export type AssistantBlock =
  | ThinkingBlock
  | TextBlock
  | StepBlock
  | PlanBlock
  | QuestionBlock
  | PermBlock
  | SteerBlock
  | ErrorBlock

// A slash-command invocation shown compactly in the user bubble (`/name args`).
// `text` still holds the expanded body (what the model receives + persists); this
// is display-only metadata, mirroring `quotes` (in-memory, lost on reload).
export type SlashCommandRef = { name: string; args: string }

export type UserMessage = {
  role: 'user'
  text: string
  at?: string
  // Persisted engine message id (ADR 0074). Hydrated from JSONL on load and minted
  // client-side when the turn is sent, so a message can be anchored by id — the
  // durable address — while the array index stays the runtime address only.
  eid?: string
  att?: SessionAttachment[] | null
  quotes?: Followup[] | null
  command?: SlashCommandRef | null
}
export type AssistantMessage = {
  role: 'assistant'
  blocks: AssistantBlock[]
  at?: string
  // Engine messageId for the in-flight/finalized assistant turn (IPC path). Used
  // to target session.chunk/session.step events at the right placeholder bubble.
  eid?: string
  // True while this turn is still streaming (placeholder). Cleared on finalize.
  streaming?: boolean
  // Epoch ms: turn start / finish — drives the live "Streaming… {elapsed}" ticker
  // and the elapsed shown on a completed turn (mirrors the old flow).
  startedAt?: number
  completedAt?: number
}
// `eid`: same durable anchor as on the other two roles. Absent on the locally
// pushed "engine unavailable" notice — that one never reaches the transcript file.
export type SystemMessage = { role: 'system'; text: string; at?: string; eid?: string }
export type SessionMessage = UserMessage | AssistantMessage | SystemMessage

export type GitMeta = {
  branch: string
  ahead: number
  changed: number
  pr?: number | false
  prTitle?: string
  issue?: number
  issueTitle?: string
}
// One row in the model's live checklist (a TodoWrite `note` step). `t` = label,
// `done` = completed (kept for simple checks); `status` carries the
// full 3-state so the panel can show an in-progress marker, not just done/undone.
// `TodoStatus` itself lives in ~/types (shared with the tasks store) — re-exporting
// it from here would put the same name in two auto-import roots.
export type Todo = { t: string; done: boolean; status?: TodoStatus }

// One bulk-loaded memory file / custom agent / skill in the breakdown (label +
// char size; ÷4 ≈ tokens). Drives the expandable MEMORY FILES / CUSTOM AGENTS
// sections of the usage panel.
export type ContextItemSize = { label: string; chars: number }

// Engine-reported context-window breakdown (char sizes of each segment of the
// last prompt; ÷4 ≈ tokens), itemised the way Claude Code's `/context` reports
// it. Every field is OPTIONAL: a session hydrated from a message persisted with
// the legacy shape carries only `system`/`tools`/`history`, so the panel reads
// each field defensively.
export type ContextChars = {
  systemPrompt?: number
  instructions?: number
  systemTools?: number
  mcpTools?: number
  customAgents?: number
  skills?: number
  memoryFiles?: number
  history?: number
  // Legacy aggregate fields (pre-itemisation) — fallback for old messages.
  system?: number
  tools?: number
  // Itemised lists for the expandable sections.
  memoryFilesList?: ContextItemSize[]
  customAgentsList?: ContextItemSize[]
  skillsList?: ContextItemSize[]
}

// Context-window usage for the session (engine path). `total` = input + cacheRead +
// cacheWrite + output (raw API tally, kept for reference/debugging). NOTE: the
// context-window OCCUPANCY gauge does NOT use `total` — it sums the assembled
// content from `contextChars` (see contextTokensFromChars), because cache read/write
// is the cached split of that same content and `output` is the response, not the
// input window. `max` is the model's context window when known.
export type SessionUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  max?: number
  // Engine-reported context-window breakdown (see ContextChars). Lets the usage
  // panel itemise System prompt / Instructions / System tools / MCP tools /
  // Custom agents / Skills / Memory files / Messages instead of token totals only.
  contextChars?: ContextChars
  // Cumulative cost in USD across all turns of this session. Computed sidecar-side
  // (single source of truth = activity/pricing.ts) from per-turn usage + modelUsed,
  // then summed here. Absent when no priced turn has run (or model has no price → n/a).
  cost?: number
}

// Per-session budget. `limitUsd` is a SOFT cap (warning banner only). `hardLimitUsd`
// + `maxToolCalls` + `maxWallclockMs` are HARD caps enforced sidecar-side (block the
// turn / tool call when exceeded — closes the "budget per task" security invariant).
// All optional: unset = no budget. Round-trips through sessions.upsert (metadata).
export type SessionBudget = {
  limitUsd?: number
  hardLimitUsd?: number
  maxToolCalls?: number
  maxWallclockMs?: number
}

// A file/note pinned to a session that the sidecar re-feeds into EVERY turn as a
// `<pinned_context>` block (distinct from one-shot attachments and global/project
// rules — see ADR-tier). `files` are workspace-relative paths read fresh per turn
// (path-sanitized sidecar-side); `notes` is free text. Round-trips through upsert.
export type PinnedContext = {
  files?: string[]
  notes?: string
  // Reusable notes (from the preset/recent library) applied to this session as
  // discrete toggled units — each fed to the turn as its own <notes> entry, distinct
  // from the free-text `notes`. Stored as text so they survive preset deletion.
  notePresets?: string[]
}

// A message the user queued while a turn was streaming (§2). Auto-drained FIFO as
// a fresh turn once the current turn returns to idle/done. `quotes` snapshots the
// follow-up quotes attached when it was queued so they survive the queue → drain
// round-trip (they're woven into the model text on send, like an immediate send).
export type QueuedMessage = {
  text: string
  att?: SessionAttachment[]
  command?: SlashCommandRef
  quotes?: Followup[]
}

// Reasoning effort (Claude Code vocabulary) — forwarded as `settings.level`.
export type ThinkingLevel = 'low' | 'medium' | 'high' | 'extra-high' | 'max'

// The one catalog every effort picker renders (Settings → Defaults, the session
// status-bar chip, per-project LLM defaults), ordered low → max. Labels come from
// the shared `common.thinking.<level>` i18n keys — keep both in one place so the
// pickers can't drift apart (one used to omit 'extra-high' and show English only).
export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'low',
  'medium',
  'high',
  'extra-high',
  'max',
]

// How the agent's mutating SSH tools (ssh_exec / ssh_write_file) are approved for a
// session linked to an SSH host (ADR 0064 P2). Mirrors the sidecar SshApprovalMode.
//   prompt  — ask before every remote command / write (default, safest)
//   session — ask once per tool, then remember for the rest of the session
//   auto    — run without prompting (explicit opt-in; the UI warns)
export type SshApprovalMode = 'prompt' | 'session' | 'auto'

// A reading anchor the user placed on one message (ADR 0074). `id` is the message's
// persisted engine id (`SessionMessage.eid`), `at` the MESSAGE's timestamp. Mirrors
// the sidecar SessionBookmark; deliberately no excerpt (derived at render time).
export type SessionBookmark = { id: string; at: string }

// Hard cap on bookmarks per session. Mirrors MAX_BOOKMARKS in
// apps/desktop/sidecar/src/sessions/ids.ts, which enforces the same number at the RPC
// boundary AND on the load path. The two packages share no module, so the constant is
// duplicated on purpose: raising it here alone would only make the write bounce back.
export const MAX_BOOKMARKS = 30

export type Session = {
  id: number
  title: string
  project: string
  model: string
  account: string
  // Real sidecar account id (IPC path). The `account` display string is for the
  // UI; `accountId` round-trips to engine settings. Unset without a bridge (the
  // display string doubles as the id there).
  accountId?: string
  style: string
  status: SessionStatus
  when: string
  // Raw ISO timestamps from the sidecar summary — drive the list "Sort by"
  // (created / updated). `when` stays the display label derived from updatedAt.
  // Optional: unset on a legacy summary written before the field shipped.
  createdAt?: string
  updatedAt?: string
  unread?: boolean
  pinned?: boolean
  mode?: string
  git?: GitMeta
  todos?: Todo[]
  // Reading anchors on this session's messages (ADR 0074). Session-level array on
  // purpose: ensureLoaded markRaw()s every message but the last, so a flag stored on
  // a message would not be reactive. Persisted in the JSONL header via
  // sessions.updateBookmarks; hydrated by ensureLoaded.
  bookmarks?: SessionBookmark[]
  followups?: Followup[]
  msgs: SessionMessage[]
  // ── Per-session model config (config popover → engine settings) ──────────
  // Reasoning effort → settings.level (default 'high' when unset).
  thinkingLevel?: ThinkingLevel
  // Response style (ADR 0046): suppress markdown in replies → responseStyleNoMarkdown.
  noMarkdown?: boolean
  // Session-scoped tool DENYLIST (Claude Code tool names) → params.disabledTools.
  disabledTools?: string[]
  // Session-scoped MCP server whitelist → params.mcpServerIds. undefined = all
  // enabled (legacy); [] = none; [ids] = only those.
  mcpServerIds?: string[]
  // Files/notes pinned to this session, re-fed into every turn as <pinned_context>.
  pinnedContext?: PinnedContext
  // Absolute path of a folder dragged into the session. Becomes the runtime tools'
  // cwd (forwarded as params.workspacePath, takes precedence over the project path)
  // so the model reads/writes inside it. Surfaced as a folder chip in the composer.
  workspaceFolder?: string
  // Soft + hard spend caps for this session (see SessionBudget).
  budget?: SessionBudget
  // ── Fork lineage (set when this session was forked off another) ────────────
  // engineId of the session this one was forked from; the message (eid) it forked
  // at. Drives the fork-tree graph. Persisted via sessions.upsert (metadata).
  parentSessionId?: string
  forkFromMessageId?: string
  // ── Engine-bridge fields (IPC path only; unset without a bridge) ──────────
  // Sidecar session id (string). The numeric `id` stays the stable client key
  // for Vue lists; `engineId` is what the RPCs use. Set when hydrated from
  // sessions.list / created via the engine.
  engineId?: string
  // Task this session was opened to discuss (ADR 0055). Set when created via the
  // "Discuss in session" action on a Task; drives the SessionDetail banner + the
  // sidecar <linked_task> context injection. Round-trips through sessions.upsert.
  aboutTaskId?: string
  // SSH host this session works with (ADR 0064, P1). Set when created via the
  // "Open in session" action on an SSH host; drives the SessionDetail banner + the
  // sidecar <linked_ssh_host> context injection. Round-trips through sessions.upsert.
  aboutSshHostId?: string
  // Approval mode for the agent's mutating SSH tools (ADR 0064 P2). Only meaningful
  // when aboutSshHostId is set. Forwarded per-turn in engine settings; the sidecar
  // defaults to 'prompt' when unset.
  sshApprovalMode?: SshApprovalMode
  // SSH terminal co-pilot (ADR 0064): connId of the visible interactive shell this
  // session drives. TRANSIENT (renderer-only, NOT persisted) — set by the docked SSH
  // session panel; forwarded per-turn in sendMessage so the agent gets
  // ssh_terminal_run targeting THIS terminal instead of headless ssh_exec.
  sshTerminalConnId?: string
  // GitHub issue/PR URL this session was opened from ("New session" on an issue/PR
  // row). Surfaced in the Info panel as a link; round-trips through sessions.upsert.
  aboutGhUrl?: string
  // Real context-window usage from turn events.
  usage?: SessionUsage
  // Queued messages (auto-sent after the current turn finishes).
  queue?: QueuedMessage[]
  // Unsent composer text, kept per session so switching sessions doesn't lose a
  // half-typed message. In-memory UI state only (like `followups`/`queue`) — never
  // persisted to JSONL.
  draft?: string
  // True once this session's full transcript has been fetched (sessions.get).
  // Lazy-load guard — see ADR 0048. Unset/false = summary only (msgs empty).
  loaded?: boolean
  // True while the transcript fetch is in flight (drives the skeleton so opening
  // an old session shows a loading placeholder, not the empty "new session"
  // welcome). Set by ensureLoaded; cleared when it settles.
  loading?: boolean
  // True while a `/compact` RPC is in flight (ADR 0047). Drives the composer's
  // persistent "compacting…" notice + a disabled Send button so the user can't
  // queue a turn mid-compaction. In-memory UI state only. Set by compactSession.
  compacting?: boolean
}

export type TreeFile = { f: string; st?: 'M' | 'A' }
export type TreeDir = { d: string; ch?: TreeNode[] }
export type TreeNode = TreeFile | TreeDir

const providerOf = (account: string): Provider =>
  (account.split(' · ')[1] as Provider | undefined) ?? 'Anthropic'
const modelsFor = (account: string): string[] => modelsForProvider(providerOf(account))

// Engine provider id (settings.provider) ↔ display name. Shared by the store
// (engineSettings/summaryToSession) and useAccounts so both resolve identically.
export const PROVIDER_DISPLAY: Record<string, Provider> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}
// Reverse of PROVIDER_DISPLAY — friendly display name → engine provider id, to key
// the provider-model catalog (which is keyed by ProviderName).
const PROVIDER_NAME: Record<Provider, ProviderName> = {
  Anthropic: 'anthropic',
  OpenAI: 'openai',
  Google: 'google',
}
// Model display/catalog helpers now delegate to the single provider-model catalog
// (useProviderModels) — the source of truth shared by every picker. These thin
// wrappers keep the historical sync signatures the many call sites depend on.
// modelId → display (unknown → raw id); reverse maps a display back to a modelId.
export const modelDisplayName = (modelId: string): string => providerModelDisplayName(modelId)
export const modelIdFromDisplay = (display: string): string => providerModelIdFromDisplay(display)
// Per-provider model catalog (display names) — the auto-filtered "modern" subset
// the picker shows when an account has no explicit list.
export const modelsForProvider = (provider: Provider): string[] =>
  providerModelsShown(PROVIDER_NAME[provider]).map((m) => m.name)

// Project grouping moved to the VSCode-style tab strip (SessionTabBar), so it's no
// longer a group-by option — the active tab IS the project filter. The remaining
// options sub-group WITHIN a tab.
const GROUPBY: [string, string][] = [
  ['provider', 'Connection'],
  ['model', 'Model'],
  ['unread', 'Unread'],
  ['none', 'None (phẳng)'],
]

// Sort options for the list within a tab. Time fields sort newest-first; `title`
// sorts A→Z (locale-aware). Labels come from i18n (sessions.sort.*); `updated` is
// the default (matches the sidecar's newest-updated-first list order).
export const SORTBY = ['updated', 'created', 'title'] as const
export type SortBy = (typeof SORTBY)[number]

// Workspace views — [name, icon sprite id, shortcut]
const WPVIEWS: [string, string, string][] = [
  ['Preview', 'sessions', '⇧⌘P'],
  ['Diff', 'git', '⇧⌘D'],
  ['Terminal', 'commands', '^`'],
  ['Files', 'folder', '⇧⌘F'],
  ['Tasks', 'tasks', ''],
  ['Plan', 'rules', ''],
  ['Cost', 'zap', ''],
  ['Info', 'alert', ''],
]
const wpIcon = (t: string): string => WPVIEWS.find((v) => v[0] === t)?.[1] || 'folder'

// Status → dot color + Vietnamese label (SD / SLBL in the prototype).
const STATUS_COLOR: Record<SessionStatus, string> = {
  idle: 'var(--textFaint)',
  streaming: 'var(--accent)',
  awaiting: 'var(--amber)',
  done: 'var(--textFaint)',
  error: 'var(--danger)',
}

// Circled numerals for follow-up quote badges (①② … up to 10 quotes).
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

export function useSessionsData() {
  return {
    CIRCLED,
    GROUPBY,
    SORTBY,
    STATUS_COLOR,
    providerOf,
    modelsFor,
    wpIcon,
  }
}
