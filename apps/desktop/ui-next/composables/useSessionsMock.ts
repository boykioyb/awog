// Typed static mock for the Sessions page — ported verbatim from awog-prototype.html
// (SS state ~1180, PROVIDER_MODELS 1130, ACCOUNTS 1174, STYLES 1175, GROUPBY 1179,
// MODES 1641, WPVIEWS 1380, FTREE 1382, FILE_SRC 1390, DEMO_DIFF 1873, FILES 1876).
// VISUAL ONLY: no Pinia / IPC. Renderers consume these consts to mirror the prototype.

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
}
export type PlanBlock = {
  kind: 'plan'
  title: string
  items: string[]
  status?: 'pending' | 'approved'
  eid?: string
}
export type QuestionOption = { label: string; desc?: string }
export type QuestionBlock = {
  kind: 'question'
  prompt: string
  options: QuestionOption[]
  multi?: boolean
  sel?: string[]
  other?: string
  answer?: string | null
  eid?: string
  // Per-question header from the engine (AskUserQuestion) — needed to build the
  // answer payload back to the sidecar. Absent on mock questions.
  header?: string
  // Set when the turn was cancelled while this gate was still parked: the gate is
  // dead (answering it is a no-op), so it renders as "cancelled" and no longer
  // counts as "awaiting" (which otherwise kept the composer stuck on Stop).
  cancelled?: boolean
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

export type UserMessage = {
  role: 'user'
  text: string
  at?: string
  att?: SessionAttachment[] | null
  quotes?: Followup[] | null
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
export type Todo = { t: string; done: boolean }

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

// Context-window usage for the session (engine path). `used` = input + cacheRead
// + cacheWrite + output (history sits in cacheRead, so `input` alone looks small —
// see memory usage-cache-tokens). `max` is the model's context window when known.
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
}

// A message the user queued while a turn was streaming (§2). Auto-drained FIFO as
// a fresh turn once the current turn returns to idle/done.
export type QueuedMessage = { text: string; att?: SessionAttachment[] }

// Reasoning effort (Claude Code vocabulary) — forwarded as `settings.level`.
export type ThinkingLevel = 'low' | 'medium' | 'high' | 'extra-high' | 'max'

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
  // ── Engine-bridge fields (IPC path only; unset in mock mode) ──────────────
  // Sidecar session id (string). The numeric `id` stays the stable client key
  // for Vue lists; `engineId` is what the RPCs use. Set when hydrated from
  // sessions.list / created via the engine.
  engineId?: string
  // Task this session was opened to discuss (ADR 0055). Set when created via the
  // "Discuss in session" action on a Task; drives the SessionDetail banner + the
  // sidecar <linked_task> context injection. Round-trips through sessions.upsert.
  aboutTaskId?: string
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
}

export type TreeFile = { f: string; st?: 'M' | 'A' }
export type TreeDir = { d: string; ch?: TreeNode[] }
export type TreeNode = TreeFile | TreeDir

const PROVIDER_MODELS: Record<Provider, string[]> = {
  Anthropic: ['Opus 4.8', 'Opus 4.8 (1M)', 'Sonnet 4.6', 'Haiku 4.5'],
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
const PCOL: Record<string, string> = {
  awog: 'var(--accent)',
  vbsec: 'var(--blue)',
  'spacelinks-web': 'var(--violet)',
}
const projColor = (p: string): string => PCOL[p] || 'var(--textDim)'
const PROJECTS = ['awog', 'vbsec', 'spacelinks-web']

const GROUPBY: [string, string][] = [
  ['project', 'Project'],
  ['provider', 'Connection'],
  ['model', 'Model'],
  ['unread', 'Unread'],
  ['none', 'None (phẳng)'],
]
const MODES: [string, string][] = [
  ['Ask', 'Hỏi — agent trả lời'],
  ['Plan', 'Lập kế hoạch trước, duyệt rồi chạy'],
  ['Execute', 'Thực thi ngay'],
]

// Workspace views — [name, icon sprite id, shortcut]
const WPVIEWS: [string, string, string][] = [
  ['Preview', 'sessions', '⇧⌘P'],
  ['Diff', 'git', '⇧⌘D'],
  ['Terminal', 'commands', '^`'],
  ['Files', 'folder', '⇧⌘F'],
  ['Tasks', 'tasks', ''],
  ['Plan', 'rules', ''],
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

const FILE_SRC: Record<string, string> = {
  'SessionComposer.vue':
    '<script setup lang="ts">\nconst draft = ref("")\nasync function send() {\n  const enhanced = await enhancePrompt(draft.value)\n  emit("send", enhanced)\n  draft.value = ""\n}\n</' +
    'script>',
  'sessions.ts':
    'export const useSessionsStore = defineStore("sessions", () => {\n  const sessions = ref<Session[]>([])\n  function add(s: Session) { sessions.value.unshift(s) }\n  return { sessions, add }\n})',
  'sessions.enhance-prompt.ts':
    'export async function enhancePrompt(text: string) {\n  // bọc text của user kèm bối cảnh project\n  return `Bối cảnh: AWOG\\nYêu cầu: ${text}`\n}',
}

const DEMO_DIFF: DiffLine[] = [
  { t: '@', s: '@@ -210,4 +210,5 @@ const send = () => {' },
  { t: ' ', n: 210, s: '  const text = draft.value.trim()' },
  { t: ' ', n: 211, s: '  if (!text) return' },
  { t: '-', n: 212, s: '  emit("send", text)' },
  { t: '+', n: 212, s: '  const enhanced = await enhancePrompt(text)' },
  { t: '+', n: 213, s: '  emit("send", enhanced)' },
  { t: ' ', n: 214, s: '}' },
]

const FILES = [
  'apps/desktop/ui/components/session/SessionComposer.vue',
  'apps/desktop/ui/stores/sessions.ts',
  'apps/desktop/sidecar/src/sessions/runner.ts',
  'apps/desktop/sidecar/src/mcp/pool.ts',
  'apps/desktop/sidecar/src/methods/sessions.enhance-prompt.ts',
  'docs/architecture/system-overview.md',
  'CLAUDE.md',
]

// Status → dot color + Vietnamese label (SD / SLBL in the prototype).
const STATUS_COLOR: Record<SessionStatus, string> = {
  idle: 'var(--textFaint)',
  streaming: 'var(--accent)',
  awaiting: 'var(--amber)',
  done: 'var(--textFaint)',
  error: 'var(--danger)',
}
const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: 'nháp',
  streaming: 'đang chạy',
  awaiting: 'đang chờ',
  done: 'xong',
  error: 'lỗi',
}

const SESSIONS: Session[] = [
  {
    id: 1,
    title: 'Migrate session store → MCP pool',
    project: 'awog',
    model: 'Opus 4.8',
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
            answer: null,
          },
        ],
      },
    ],
  },
  {
    id: 2,
    title: 'Byte-minimal JSONL persist',
    project: 'awog',
    model: 'Opus 4.8',
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
            prompt: 'Áp cho session cũ luôn hay chỉ session mới?',
            multi: true,
            options: [
              { label: 'Migrate session cũ (1 lần)' },
              { label: 'Nén backup .jsonl.gz' },
              { label: 'Chỉ áp session mới' },
            ],
            sel: ['Migrate session cũ (1 lần)', 'Nén backup .jsonl.gz'],
            answer: null,
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
    model: 'Sonnet 4.6',
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
    model: 'Opus 4.8',
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
    model: 'Opus 4.8',
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

export function useSessionsMock() {
  return {
    PROVIDER_MODELS,
    CIRCLED,
    ACCOUNTS,
    PROJECTS,
    GROUPBY,
    MODES,
    WPVIEWS,
    FTREE,
    FILE_SRC,
    DEMO_DIFF,
    FILES,
    SESSIONS,
    STATUS_COLOR,
    STATUS_LABEL,
    providerOf,
    modelsFor,
    projColor,
    wpIcon,
  }
}
