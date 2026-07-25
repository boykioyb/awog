// Sessions domain home: the canonical session TYPES (Session + message/assistant
// blocks, diff/tree shapes…) and the UI display helpers/catalog (STATUS_COLOR,
// model/provider display maps, GROUPBY, wpIcon, providerOf…) that the whole
// Sessions feature imports. `useSessionsData()` also exposes a small browser-dev
// SEED (SESSIONS, FTREE, DEMO_DIFF, ACCOUNTS) used only as the `!available`
// fallback so the UI is browsable without the Electron shell + sidecar; in the
// desktop app the live stores load real data over IPC and ignore these.

export type Provider = 'Anthropic' | 'OpenAI' | 'Google'
export type SessionStatus = 'idle' | 'streaming' | 'awaiting' | 'done' | 'error'

export type DiffLine = { t: '+' | '-' | ' ' | '@'; n?: number; s: string }

export type SessionAttachment = {
  name: string
  img: boolean
  // Filled when a real file is dropped/picked (object URL for images, text content
  // for text-like files) so the shared PreviewModal can render an actual preview.
  // Absent on seed mock data → preview falls back to a placeholder.
  src?: string
  text?: string
  size?: number
  mime?: string
  // Inline base64 `data:` URL for an image, carried to the model (re-fed every
  // turn — see memory image-attachments). Set when the engine path needs to send
  // the image content; mock mode leaves it unset (preview uses `src`).
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
// Edit/Write show the REAL diff/file, not the mock DEMO_DIFF). Absent on mock seed.
export type StepDetailKind = 'diff' | 'file' | 'terminal' | 'text' | 'list'
export type SubStep = {
  // Engine step id — present on the IPC path so live deltas of the SAME subagent
  // step (e.g. a streaming `thinking` block whose label grows each delta) merge
  // in place instead of pushing a new row per delta. Absent on mock seed.
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
// (answerQuestion / permission). Absent on mock seed + local mock turns.
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
  // flattened fallback (mock data + engine steps with no planMarkdown).
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
  // answer back to the right question in the sidecar. Absent on mock questions.
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
export type SystemMessage = { role: 'system'; text: string; at?: string }
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
// `done` = completed (kept for the mock seed + simple checks); `status` carries the
// full 3-state so the panel can show an in-progress marker, not just done/undone.
export type Todo = { t: string; done: boolean; status?: 'pending' | 'in_progress' | 'completed' }

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

// How the agent's mutating SSH tools (ssh_exec / ssh_write_file) are approved for a
// session linked to an SSH host (ADR 0064 P2). Mirrors the sidecar SshApprovalMode.
//   prompt  — ask before every remote command / write (default, safest)
//   session — ask once per tool, then remember for the rest of the session
//   auto    — run without prompting (explicit opt-in; the UI warns)
export type SshApprovalMode = 'prompt' | 'session' | 'auto'

export type Session = {
  id: number
  title: string
  project: string
  model: string
  account: string
  // Real sidecar account id (IPC path). The `account` display string is for the
  // UI; `accountId` round-trips to engine settings. Unset in mock mode (the
  // display string doubles as the id there).
  accountId?: string
  style: string
  status: SessionStatus
  when: string
  // Raw ISO timestamps from the sidecar summary — drive the list "Sort by"
  // (created / updated). `when` stays the display label derived from updatedAt.
  // Optional: unset in mock mode / a legacy summary written before the field shipped.
  createdAt?: string
  updatedAt?: string
  unread?: boolean
  pinned?: boolean
  mode?: string
  git?: GitMeta
  todos?: Todo[]
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
  // ── Engine-bridge fields (IPC path only; unset in mock mode) ──────────────
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

const PROVIDER_MODELS: Record<Provider, string[]> = {
  Anthropic: ['Fable 5', 'Opus 5', 'Opus 5 (1M)', 'Sonnet 5', 'Haiku 4.5'],
  OpenAI: ['GPT-5', 'GPT-5 mini', 'o3', 'GPT-4.1'],
  Google: ['Gemini 2.5 Pro', 'Gemini 2.5 Flash', 'Gemini 2.0 Flash'],
}
const providerOf = (account: string): Provider =>
  (account.split(' · ')[1] as Provider | undefined) ?? 'Anthropic'
const modelsFor = (account: string): string[] => PROVIDER_MODELS[providerOf(account)]

// Engine provider id (settings.provider) ↔ display name. Shared by the store
// (engineSettings/summaryToSession) and useAccounts so both resolve identically.
export const PROVIDER_DISPLAY: Record<string, Provider> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}
// Engine modelId (e.g. `claude-opus-4-8`) → friendly display name. Best effort:
// unknown ids fall back to the raw id (see modelDisplayName).
export const MODEL_DISPLAY: Record<string, string> = {
  'claude-fable-5': 'Fable 5',
  'claude-opus-5': 'Opus 5',
  'claude-opus-5-1m': 'Opus 5 (1M)',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-opus-4-8-1m': 'Opus 4.8 (1M)',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5': 'Haiku 4.5',
  'gpt-5': 'GPT-5',
  'gpt-5-mini': 'GPT-5 mini',
  o3: 'o3',
  'gpt-4.1': 'GPT-4.1',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
}
// modelId → display (unknown → raw id). reverse maps a display back to a modelId.
export const modelDisplayName = (modelId: string): string => MODEL_DISPLAY[modelId] ?? modelId
export const modelIdFromDisplay = (display: string): string =>
  Object.entries(MODEL_DISPLAY).find(([, name]) => name === display)?.[0] ?? display
// Per-provider model catalog (display names) when an account has no explicit list.
export const modelsForProvider = (provider: Provider): string[] => PROVIDER_MODELS[provider]

const ACCOUNTS = ['hoatq · Anthropic', 'team · OpenAI', 'personal · Google']

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

const FTREE: TreeNode[] = [
  {
    d: 'apps/desktop',
    ch: [
      {
        d: 'ui/components/session',
        ch: [
          { f: 'SessionComposer.vue', st: 'M' },
          { f: 'SessionMessageItem.vue', st: 'M' },
        ],
      },
      { d: 'ui/stores', ch: [{ f: 'sessions.ts', st: 'M' }] },
      { d: 'sidecar/src/methods', ch: [{ f: 'sessions.enhance-prompt.ts', st: 'A' }] },
    ],
  },
  { f: 'CLAUDE.md' },
]

const DEMO_DIFF: DiffLine[] = [
  { t: '@', s: '@@ -210,4 +210,5 @@ const send = () => {' },
  { t: ' ', n: 210, s: '  const text = draft.value.trim()' },
  { t: ' ', n: 211, s: '  if (!text) return' },
  { t: '-', n: 212, s: '  emit("send", text)' },
  { t: '+', n: 212, s: '  const enhanced = await enhancePrompt(text)' },
  { t: '+', n: 213, s: '  emit("send", enhanced)' },
  { t: ' ', n: 214, s: '}' },
]

// Status → dot color + Vietnamese label (SD / SLBL in the prototype).
const STATUS_COLOR: Record<SessionStatus, string> = {
  idle: 'var(--textFaint)',
  streaming: 'var(--accent)',
  awaiting: 'var(--amber)',
  done: 'var(--textFaint)',
  error: 'var(--danger)',
}

const SESSIONS: Session[] = [
  {
    id: 1,
    title: 'Migrate session store → MCP pool',
    project: 'awog',
    model: 'Opus 5',
    account: 'hoatq · Anthropic',
    style: 'Default',
    status: 'awaiting',
    when: '3m',
    unread: true,
    git: {
      branch: 'fix/session-mcp-pool',
      ahead: 2,
      changed: 7,
      pr: 128,
      prTitle: 'Reuse MCP server child',
      issue: 45,
      issueTitle: 'Server spawn mỗi turn',
    },
    todos: [
      { t: 'Đọc runner + McpManager', done: true },
      { t: 'Tách pool theo (session,server)', done: true },
      { t: 'Giữ idle-stop 5 phút', done: false },
      { t: 'Typecheck + commit', done: false },
    ],
    msgs: [
      {
        role: 'user',
        text: 'Refactor lại runner để mỗi session reuse một MCP server child, tránh spawn lại mỗi turn.',
      },
      {
        role: 'assistant',
        blocks: [
          {
            kind: 'thinking',
            text: 'Cần đọc runner.ts để hiểu vòng đời server trước khi tách pool. Sau đó hỏi user về cơ chế concurrency.',
          },
          {
            kind: 'step',
            tool: 'Read',
            target: 'apps/desktop/sidecar/src/sessions/runner.ts',
            result: '214 lines',
            detail: 'class SessionRunner {\n  spawnServer(id) {...}\n}',
          },
          {
            kind: 'step',
            tool: 'Grep',
            target: '"spawn"',
            result: '4 matches',
            detail: 'runner.ts:88\nrunner.ts:142\nmcp/manager.ts:51\nmcp/manager.ts:77',
          },
          {
            kind: 'text',
            text: 'Server đang spawn ở 4 chỗ. Mình đề xuất tách một pool dùng chung, key theo (sessionId, serverId), giữ nguyên idle-stop.',
          },
          {
            kind: 'plan',
            title: 'Tách MCP pool dùng chung',
            items: [
              'Tạo McpPool keyed theo (sessionId, serverId)',
              'Runner acquire()/release() thay cho spawn() mỗi turn',
              'Giữ idle-stop 5 phút',
              'Typecheck + commit',
            ],
            status: 'approved',
          },
          {
            kind: 'step',
            tool: 'Edit',
            target: 'apps/desktop/sidecar/src/mcp/pool.ts',
            result: '+18 −4',
          },
          {
            kind: 'step',
            tool: 'Write',
            target: 'apps/desktop/sidecar/src/mcp/pool.test.ts',
            result: 'file mới',
          },
          {
            kind: 'step',
            tool: 'Bash',
            target: 'pnpm typecheck',
            result: '✓ 0 errors',
            detail: '> vue-tsc --noEmit\n✓ 0 errors',
          },
          {
            kind: 'step',
            tool: 'Task',
            target: 'infosec · audit fs.* sinks',
            result: '2 findings',
            sub: {
              agent: 'infosec',
              steps: [
                { tool: 'Grep', target: '"writeFile"', result: '6 hits' },
                { tool: 'Read', target: 'sidecar/src/fs/guard.ts', result: '92 lines' },
                { tool: 'Edit', target: 'sidecar/src/fs/guard.ts', result: '+5 −1' },
              ],
            },
          },
          {
            kind: 'step',
            tool: 'Skill',
            target: 'security-audit',
            detail: 'Áp 21-rule catalog + 8 invariant AWOG; xuất findings theo severity.',
          },
          {
            kind: 'perm',
            tool: 'writeFile',
            target: 'apps/desktop/sidecar/src/mcp/pool.ts',
            status: 'allowed',
          },
          {
            kind: 'question',
            items: [
              {
                prompt:
                  'Với task chạy song song trong cùng một session, dùng cơ chế nào cho server child?',
                options: [
                  {
                    label: 'Worktree isolation',
                    desc: 'Mỗi task một worktree riêng — an toàn nhất, tốn đĩa hơn',
                  },
                  {
                    label: 'Shared lock',
                    desc: 'Một child dùng chung + mutex — nhẹ, có thể nghẽn khi tải cao',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 2,
    title: 'Byte-minimal JSONL persist',
    project: 'awog',
    model: 'Opus 5',
    account: 'hoatq · Anthropic',
    style: 'Default',
    status: 'done',
    when: '12m',
    msgs: [
      {
        role: 'user',
        text: 'JSONL persist đang O(n²), file phình tới 1.2GB. Sửa giúp mình.',
        att: [
          { name: 'profiler.png', img: true },
          { name: 'persist.ts', img: false },
        ],
      },
      {
        role: 'assistant',
        blocks: [
          {
            kind: 'step',
            tool: 'Read',
            target: 'sessions/persist.ts',
            result: '180 lines',
            detail: 'writeFileSync(path, JSON.stringify(full)) // mỗi delta!',
          },
          {
            kind: 'text',
            text: 'Đúng vậy — mid-stream đang re-persist toàn bộ steps[] mỗi delta. Mình đổi sang ghi message.progress incremental + loader stream từng dòng. File sẽ nhỏ lại đáng kể.',
          },
          {
            kind: 'steer',
            text: 'Nhớ giữ backup + nén file cũ trước khi đổi format nhé.',
          },
          {
            kind: 'question',
            items: [
              {
                prompt: 'Áp cho session cũ luôn hay chỉ session mới?',
                multi: true,
                options: [
                  { label: 'Migrate session cũ (1 lần)' },
                  { label: 'Nén backup .jsonl.gz' },
                  { label: 'Chỉ áp session mới' },
                ],
              },
            ],
          },
          {
            kind: 'error',
            text: 'Migration script timeout ở session #1842 (file 1.2GB). Đã chia batch 50MB và retry thành công.',
          },
        ],
      },
    ],
  },
  {
    id: 3,
    title: 'Reuse MCP server child per session',
    project: 'awog',
    model: 'Sonnet 5',
    account: 'hoatq · Anthropic',
    style: 'Concise',
    status: 'done',
    when: '2h',
    msgs: [
      { role: 'user', text: 'Mỗi tool call lại spawn server mới rất chậm. Gộp lại được không?' },
      {
        role: 'assistant',
        blocks: [
          {
            kind: 'text',
            text: 'Được. Mình giữ một child cho mỗi cặp (session, server) và idle-stop sau 5 phút không dùng.',
          },
        ],
      },
    ],
  },
  {
    id: 5,
    title: 'Scan SSRF trong HttpMcpClient',
    project: 'vbsec',
    model: 'GPT-5',
    account: 'team · OpenAI',
    style: 'Học thuật',
    status: 'done',
    when: '5h',
    unread: true,
    git: {
      branch: 'audit/ssrf',
      ahead: 0,
      changed: 2,
      pr: false,
      issue: 12,
      issueTitle: 'SSRF redirect chưa re-check IP',
    },
    msgs: [
      {
        role: 'user',
        text: 'Audit HttpMcpClient xem có chặn private IP + redirect không kiểm soát chưa.',
      },
      {
        role: 'assistant',
        blocks: [
          {
            kind: 'text',
            text: 'Mình đã rà: allowlist host OK, nhưng redirect chưa re-check IP đích. Đề xuất chặn ở mỗi hop.',
          },
        ],
      },
    ],
  },
  {
    id: 6,
    title: '21-rule catalog mapping',
    project: 'vbsec',
    model: 'Opus 5',
    account: 'hoatq · Anthropic',
    style: 'Default',
    status: 'idle',
    when: '1d',
    msgs: [],
  },
  {
    id: 7,
    title: 'Landing hero responsive',
    project: 'spacelinks-web',
    model: 'Gemini 2.5 Flash',
    account: 'personal · Google',
    style: 'Explanatory',
    status: 'done',
    when: '2d',
    unread: true,
    msgs: [
      {
        role: 'user',
        text: 'Hero bị tràn ngang trên mobile.',
        att: [{ name: 'mobile-bug.png', img: true }],
      },
      {
        role: 'assistant',
        blocks: [
          {
            kind: 'text',
            text: 'Do ảnh nền dùng width cố định. Mình đổi sang max-width:100% + object-fit cover.',
          },
        ],
      },
    ],
  },
  {
    id: 4,
    title: 'Hide todo panel khi turn end',
    project: 'awog',
    model: 'Opus 5',
    account: 'hoatq · Anthropic',
    style: 'Default',
    status: 'done',
    when: '3d',
    msgs: [
      {
        role: 'user',
        text: 'Todo panel đang ẩn khi all-done — nên ẩn khi turn kết thúc thôi.',
      },
      {
        role: 'assistant',
        blocks: [
          {
            kind: 'text',
            text: 'Đã chuyển điều kiện ẩn sang sự kiện turn-end thay vì all-todos-done.',
          },
        ],
      },
    ],
  },
]

// Circled numerals for follow-up quote badges (①② … up to 10 quotes).
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

export function useSessionsData() {
  return {
    PROVIDER_MODELS,
    CIRCLED,
    ACCOUNTS,
    GROUPBY,
    SORTBY,
    FTREE,
    DEMO_DIFF,
    SESSIONS,
    STATUS_COLOR,
    providerOf,
    modelsFor,
    wpIcon,
  }
}
