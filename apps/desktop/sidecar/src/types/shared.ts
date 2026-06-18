// Shared types across sidecar modules. Names mirror RPC payload shape.

export type ProviderName = 'anthropic' | 'openai' | 'google'

export type AuthMode = 'oauth' | 'apikey'

// Wire protocol a custom endpoint speaks (ADR 0029 Phase C3). Maps to a Pi
// `Model.api`: 'anthropic-messages' = the Anthropic Messages API (Phase B
// default), 'openai-completions' = the OpenAI Chat Completions API (Ollama,
// vLLM, LM Studio, OpenRouter, …). Undefined ⇒ inferred from the provider:
// anthropic → anthropic-messages, openai/google → their native api.
export type EndpointApi = 'anthropic-messages' | 'openai-completions'

export type AccountStatus = 'connected' | 'expired' | 'disconnected'

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope?: string
  tokenUuid?: string
}

// Raw OAuth credential blob owned + refreshed by the Pi SDK (pi
// `OAuthCredentials`: { refresh, access, expires, ...providerExtras }). Stored
// VERBATIM because pi carries provider-specific extra fields (e.g. the codex
// chatgpt_account_id) it needs at request time — AWOG must not reshape it.
// Used for pi-managed OAuth providers (openai-codex now; copilot/vertex later)
// whose token shape does NOT match AWOG's anthropic-shaped OAuthTokens. SECRET
// — never leaves the sidecar (stripped in toSafe). See ADR 0029.
export type PiOAuthCredentials = Record<string, unknown>

export interface AccountOrg {
  uuid: string
  name: string
}

export interface AccountIdentity {
  uuid: string
  email: string
}

export interface AccountRecord {
  id: string
  label: string
  authMode: AuthMode
  oauth?: OAuthTokens
  // Raw pi OAuth credentials for a pi-managed OAuth provider (ADR 0029 — OpenAI
  // Codex / ChatGPT subscription). When set, authMode is 'oauth' and the runtime
  // resolves the bearer token via pi's getOAuthApiKey instead of AWOG's anthropic
  // token-manager. SECRET — stripped by toSafe. `oauth` (anthropic-shaped) and
  // `piOAuth` are mutually exclusive per account.
  piOAuth?: PiOAuthCredentials
  apiKey?: string
  // Custom endpoint base URL (ADR 0026 Phase B / ADR 0029 Phase C3). When set,
  // the runtime points the Pi Model at this base URL instead of the provider
  // default. Only meaningful for apikey accounts. Non-secret.
  baseURL?: string
  // Wire protocol the custom endpoint speaks (ADR 0029 Phase C3). Undefined ⇒
  // inferred from provider (anthropic → anthropic-messages, else openai-
  // completions). Only meaningful when baseURL is set.
  api?: EndpointApi
  // Model ids exposed by a custom endpoint (user-supplied). Drives the agent
  // model picker; bypasses the built-in model allowlist at runtime.
  models?: string[]
  organization?: AccountOrg
  account?: AccountIdentity
  version: number
  createdAt: string
}

export interface AccountSafe {
  id: string
  label: string
  authMode: AuthMode
  fingerprint: string
  status: AccountStatus
  expiresAt?: number
  // Surfaced for custom endpoints (non-secret) so the UI can show / pick them.
  baseURL?: string
  api?: EndpointApi
  models?: string[]
  organization?: AccountOrg
  account?: AccountIdentity
  version: number
  createdAt: string
}

export interface ProviderBucket {
  accounts: AccountRecord[]
  activeAccountId: string | null
}

export interface CredentialsFile {
  version: 1
  providers: Record<ProviderName, ProviderBucket>
}

export interface OAuthState {
  verifier: string
  createdAt: number
}

// ─── Workspace filesystem (read-only) ────────────────────────────────────────
// Used by the Session workspace panel's Files tab. `path` is workspace-relative
// (POSIX-style); all I/O is gated by assertInsideWorkspace.

export interface FsEntry {
  name: string
  path: string
  kind: 'file' | 'dir'
  size?: number
}

export interface FsFileContent {
  path: string
  content: string
  language?: string
  truncated: boolean
  isBinary: boolean
}

// Raw file bytes as base64 for in-app preview of rich/binary formats (PDF,
// images) that FsFileContent can't carry. `base64` is '' when the file exceeds
// the cap (truncated=true) — the caller should fall back to opening externally.
export interface FsFileBase64 {
  path: string
  base64: string
  mimeType: string
  size: number
  truncated: boolean
}

export interface FsSearchMatch {
  // Workspace-relative file path.
  path: string
  // 1-based line number.
  line: number
  // 1-based column of the first match on the line (best-effort).
  column: number
  // The matched line content (trimmed/capped for the IPC payload).
  preview: string
}

// ─── Session (chat) ────────────────────────────────────────────────────────
// Mirror of UI shape (apps/desktop/ui/types/index.ts). Sidecar M4 keeps these
// in-memory only via per-request snapshots from the UI.
// TODO M6: persist sessions to JSONL; M4 keeps in-memory only.

export type ThinkingLevel = 'low' | 'medium' | 'high' | 'extra-high' | 'max'

export type AgentMode = 'ask' | 'accept-edits' | 'plan' | 'execute'

export interface SessionSettings {
  provider: ProviderName
  modelId: string
  level: ThinkingLevel
  mode: AgentMode
  accountId?: string
  // Response style (ADR 0046). Built-in style id (style/styles.ts) the session
  // replies in; undefined = default. `responseStyleNoMarkdown` strips markdown
  // from output (stacks on a style or applies alone). Sessions only.
  responseStyle?: string
  responseStyleNoMarkdown?: boolean
}

// One ordered slice of an assistant turn (ADR 0032). Either a run of reply text
// or a single step (tool/plan/note/thinking). The array order IS the timeline —
// no character offsets. Subagent steps nest under their parent step's `children`.
export type SessionMessagePart = { kind: 'text'; text: string } | SessionStep

// User-attached file/image on a message. Images carry an inline `url` (a
// base64 `data:` URL) so the preview survives a JSONL reload and so the runtime
// can rebuild an image content block for the model. Mirrors the UI
// SessionAttachment (apps/desktop/ui/types/index.ts) — kept structurally in sync.
export interface SessionAttachment {
  id: string
  name: string
  type: 'file' | 'image'
  size?: string
  mime?: string
  url?: string
  // UTF-8 text content of a text-based file (or a large pasted-text block). The
  // runtime delivers this to the model as a delimited text block (buildContext);
  // the UI also uses it for the in-app text preview. Absent for images (which use
  // `url`) and for binary files (display-only).
  preview?: string
  width?: number
  height?: number
}

export interface SessionMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  agentId?: string
  text: string
  at: string
  modeAtSend?: AgentMode
  // User attachments on a `user` message. Persisted so a JSONL reload keeps the
  // image preview, and so resume rebuilds the image content block for the model
  // (ADR 0029 resume = rebuild Context from history each turn).
  attachments?: SessionAttachment[]
  // Metadata persisted so UI re-hydrate from JSONL keeps assistant features
  // (markdown rendering, latency badge, model name, token counters).
  startedAt?: number
  completedAt?: number
  // Total ms this turn was PARKED on human input (AskUserQuestion / permission
  // prompt). The UI subtracts it from the displayed elapsed so the figure
  // reflects working time, not how long the user took. Persisted so a reload
  // keeps the corrected number. See docs/features/session-steer-queue.md.
  waitingMs?: number
  modelUsed?: string
  // cacheReadTokens/cacheWriteTokens are the Anthropic prompt-cache buckets.
  // Optional for back-compat: messages persisted before this field shipped reload
  // without them (treated as 0 by the context-window display).
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  // True when the assistant turn was cut short (user Stop / error / crash) and
  // only a partial reply was persisted. Mirrors the UI SessionMessage.canceled.
  canceled?: boolean
  // Set when the turn failed (provider `error` stop or a thrown runtime/network
  // error). `message` is the human-readable cause shown in the UI error alert.
  // Persisted so a reload still surfaces the failure (+ retry) instead of an
  // empty reply. Mutually exclusive with a successful completion.
  error?: { message: string }
  // Tool/plan/thinking/todo steps of an assistant turn. Persisted so a re-hydrate
  // from JSONL restores the plan card, the "ran N commands…" cluster, etc. — they
  // were live-only before and vanished on app restart. Stored flat as emitted
  // (subagent children carry `parentId`); the UI re-nests them on load.
  steps?: SessionStep[]
  // Ordered timeline of the assistant turn (ADR 0032): reply-text runs interleaved
  // with steps, in arrival order, subagent steps nested. Authoritative when present
  // — UI renders this directly; when absent (legacy message / live stream before
  // finalize) the UI derives the order from `text` + `steps`. Built + persisted by
  // sessions.send-message; never carries `textOffset`.
  parts?: SessionMessagePart[]
}

// Context-compaction checkpoint (ADR 0047). Mirrors Pi's CompactionResult shape.
// When set, the runtime feeds the model `summary` + every message from
// `firstKeptMessageId` onward (older turns are summarised, not replayed). The UI
// keeps the full transcript visible and renders a summary marker at the cut.
// Only the LATEST checkpoint is kept (a later compaction subsumes the prior one).
export interface SessionCompaction {
  summary: string
  firstKeptMessageId: string
  // Estimated context tokens before this compaction (for the marker hint).
  tokensBefore: number
  at: string
}

export interface Session {
  id: string
  title: string
  projectId: string | null
  createdAt: string
  updatedAt: string
  pinned?: boolean
  invitedAgentIds: string[]
  messages: SessionMessage[]
  pendingAgentIds: string[]
  settings: SessionSettings
  disabledTools?: string[]
  mcpServerIds?: string[]
  // Latest context-compaction checkpoint (ADR 0047), or absent if never compacted.
  compaction?: SessionCompaction
}

// ─── Session steps (tool use / thinking) ───────────────────────────────────
// Mirrors apps/desktop/ui/types/index.ts SessionStep. Sidecar emits these via
// session.step notifications when the SDK reports tool_use / tool_result.

export type SessionStepTool =
  | 'read'
  | 'write'
  | 'edit'
  | 'save'
  | 'search'
  | 'find-files'
  | 'terminal'
  | 'task'

export type SessionStepStatus = 'running' | 'done' | 'error'

// Plan step lifecycle (ExitPlanMode). pending → user approves/rejects in the UI.
export type PlanStatus = 'pending' | 'approved' | 'rejected'

// A single entry in the model's TodoWrite checklist (the agent's live task list).
export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export interface TodoItem {
  content: string
  status: TodoStatus
}

// AskUserQuestion (kind === 'question'): the model pauses the turn to ask the
// user 1–4 multiple-choice questions. See docs/features/ask-user-question.md.
export interface SessionQuestionOption {
  label: string
  description?: string
}
export interface SessionQuestion {
  // Short chip label shown on the tab (≤ ~12 chars).
  header: string
  question: string
  options: SessionQuestionOption[]
  multiSelect: boolean
}
// One answered question: the option label(s) the user picked (or their custom
// "Other" text). Keyed back to its question by `header`.
export interface SessionQuestionAnswer {
  header: string
  selected: string[]
}

export type SessionStepDetail =
  // Edit/MultiEdit: `diff` is a unified diff (git-style) the UI renders in
  // split/unified mode; `content` (optional) is the full file after the edit,
  // shown in a File view toggle.
  | { kind: 'diff'; path: string; diff: string; content?: string; language?: string }
  | { kind: 'file'; path: string; content: string; language?: string }
  | { kind: 'list'; items: { label: string; path?: string; snippet?: string }[] }
  | { kind: 'terminal'; command: string; output?: string; exitCode?: number }
  | { kind: 'text'; content: string }

export interface SessionStep {
  id: string
  kind: 'tool' | 'group' | 'thinking' | 'note' | 'plan' | 'question' | 'steer'
  tool?: SessionStepTool
  label: string
  target?: string
  description?: string
  additions?: number
  deletions?: number
  pathHint?: string
  status?: SessionStepStatus
  detail?: SessionStepDetail
  // Plan step (kind === 'plan', emitted from an ExitPlanMode tool call): the
  // proposed steps + optional rationale + approval status the UI renders as a
  // plan card with Approve/Reject. Mirrors the UI SessionStep plan fields.
  // planMarkdown holds the RAW plan markdown so the UI can render it as a
  // document (headers/lists/bold preserved); planItems/planRationale are the
  // legacy flattened form kept as a fallback for older persisted steps.
  planMarkdown?: string
  planItems?: string[]
  planStatus?: PlanStatus
  planRationale?: string
  // Todo step (kind === 'note', emitted from a TodoWrite tool call): the live
  // checklist the UI renders inline. Mirrors the UI SessionStep.todos field.
  todos?: TodoItem[]
  // Question step (kind === 'question', emitted from an AskUserQuestion tool
  // call): the questions the model asked (from the call INPUT) and — once the
  // user answers — their chosen answers (filled on tool_execution_end). The UI
  // renders the interactive card while `answers` is unset + status 'running',
  // then a read-only record. See docs/features/ask-user-question.md.
  questions?: SessionQuestion[]
  answers?: SessionQuestionAnswer[]
  // Steer step (kind === 'steer'): the user's mid-turn instruction injected via
  // getSteeringMessages. Holds the steered text so the UI renders it inline as a
  // user-note in the agent timeline at the point it landed. See
  // docs/features/session-steer-queue.md.
  steerText?: string
  // Subagent grouping: when set, this step ran inside the Task step with this
  // tool_use_id. UI nests the step under that parent instead of rendering
  // top-level. Source: SDK's `parent_tool_use_id` on stream_event/assistant/user.
  parentId?: string
  // Character offset into the assistant `text` at which this tool fired (= length
  // of the reply streamed so far). Stamped on first sighting and PERSISTED so a
  // JSONL reload can re-interleave step rows with the reply text in chronological
  // order — without it, reloaded steps default to end-of-text and the whole reply
  // collapses above the tool cluster (the post-tool answer loses its place). The
  // UI store mirrors the same value for live turns. Unset for nested subagent steps.
  textOffset?: number
}

// ─── Project ───────────────────────────────────────────────────────────────
// Mirror of UI shape (apps/desktop/ui/types/index.ts). Stored as plain JSON
// at ~/.awog/projects/<id>.json — see ADR 0012.

// Per-project LLM defaults (mirror of UI ProjectLlmDefaults). New sessions in
// this project inherit these instead of the global app defaults.
export interface ProjectLlmDefaults {
  provider: ProviderName
  modelId: string
  level: ThinkingLevel
  accountId?: string
  // MCP server whitelist new sessions inherit (mirror of Session.mcpServerIds).
  // undefined = all currently enabled servers.
  mcpServerIds?: string[]
  // Response style (ADR 0046) new sessions inherit (mirror of SessionSettings).
  // undefined = "Normal" (no style). `responseStyleNoMarkdown` strips markdown.
  responseStyle?: string
  responseStyleNoMarkdown?: boolean
}

export interface Project {
  id: string
  name: string
  path: string
  description: string
  gitRemote: string
  gitBranch: string
  language: string
  createdAt: string
  color?: string
  llmDefaults?: ProjectLlmDefaults
}

// ─── Skill ─────────────────────────────────────────────────────────────────
// Stored as a folder containing SKILL.md (YAML frontmatter + markdown body).
// Single editable home `.awog`, two tiers (ADR 0035):
//
//   global  → ~/.awog/skills/<id>/SKILL.md             (applies everywhere)
//   project → {project.path}/.awog/skills/<id>/SKILL.md (that project only)
//
// `.claude`/`.agents` skill folders are NO LONGER scanned as live tiers — they
// are one-time import sources (see migration/ + config-import-assistant).

export type SkillSource = 'global' | 'project'

export interface Skill {
  id: string
  source: SkillSource
  projectId?: string
  name: string
  description: string
  body: string
  globs?: string[]
  alwaysAllow?: string[]
  icon?: string
  requiredSources?: string[]
}

// ─── MCP Server ────────────────────────────────────────────────────────────
// Mirror of UI shape. Persistence is config-only; runtime fields (status,
// tools, resources, lastError) live in mcp/manager.ts in-memory state.
// See ADR 0014.

export type McpTransport = 'stdio' | 'http' | 'sse'
export type McpTrust = 'allow' | 'prompt' | 'deny'
export type McpStatus = 'running' | 'starting' | 'idle' | 'error' | 'disabled'

export interface McpTool {
  name: string
  description: string
}

export interface McpResource {
  uri: string
  mime: string
}

export interface McpServerConfig {
  id: string
  name: string
  description: string
  transport: McpTransport
  command?: string | undefined
  args?: string[] | undefined
  env?: Record<string, string> | undefined
  cwd?: string | undefined
  url?: string | undefined
  headers?: Record<string, string> | undefined
  enabled: boolean
  autoStart: boolean
  timeoutMs: number
  trust: McpTrust
  deniedTools?: string[] | undefined
}

export interface McpServerSnapshot extends McpServerConfig {
  status: McpStatus
  tools: McpTool[]
  resources: McpResource[]
  lastError?: string | undefined
  lastStartedAt?: string | undefined
}

// ─── Agent ─────────────────────────────────────────────────────────────────
// Stored as a single `.md` file (or `<id>/AGENT.md` folder) with YAML
// frontmatter + markdown body, format-compatible with Claude Code SDK subagent
// convention. Single editable home `.awog`, two tiers (ADR 0035):
//
//   global  → ~/.awog/agents/<id>.md            (applies everywhere)
//   project → {project.path}/.awog/agents/<id>.md (that project only)
//
// Frontmatter is interchangeable with Claude Code subagents. AWOG extends with
// `role` for the workspace agent picker; a no-op for vanilla Claude Code but
// harmless. systemPrompt = body. See ADR 0015. `.claude`/`.agents` agents are
// import sources only (migration/ + config-import-assistant), not live tiers.

export type AgentSource = 'global' | 'project'

export interface Agent {
  id: string
  source: AgentSource
  projectId?: string
  name: string
  description: string
  // LLM provider this agent runs on (ADR 0026). Default 'anthropic'. The model
  // below must belong to this provider.
  provider: ProviderName
  // Optional per-agent account (id in credentials.json). Undefined = the
  // provider's active account. Falls back to active if the id no longer exists.
  accountId?: string
  model: string
  systemPrompt: string
  role: string
  // Claude Code subagent `tools` field — restrict the SDK toolset for this
  // agent. Empty/undefined means "inherit session's full toolset" (no
  // restriction). When set, sidecar passes to `runStream({ allowedTools })`.
  tools?: string[]
  // Per-agent MCP server whitelist (replacement for deprecated Context
  // Providers feature — see ADR 0016). Empty/undefined means "inherit the
  // session's MCP set" (no per-agent filtering). When set, sidecar intersects
  // with the session-level mcpServerIds before forwarding to the SDK.
  mcpServerIds?: string[]
}

// ─── Workflow ────────────────────────────────────────────────────────────────
// DAG template persisted as plain JSON at ~/.awog/workflows/<id>.json (ADR 0024
// D-3). Mirror of UI shape (apps/desktop/ui/types/index.ts). A node carries the
// full agent identity tuple (id + source + projectId) so the engine can resolve
// it via loadAgent at execution time (D-11).

export interface WorkflowNode {
  id: string
  agentId: string
  // Agent identity tuple — agentSource/agentProjectId are optional so legacy
  // workflows (pre-D-11) still parse; node-runner falls back to a best-effort
  // lookup-by-id when source is absent.
  agentSource?: AgentSource
  agentProjectId?: string
  skillId: string
  x: number
  y: number
  outputs: string[]
  approval: boolean
}

export interface WorkflowEdge {
  from: string
  to: string
}

// Where a workflow lives (ADR 0024 follow-up). 'global' = ~/.awog/workflows
// (shared across projects); 'project' = {project.path}/.awog/workflows (travels
// with the repo, git-trackable). Like Skills, source/projectId are derived from
// the on-disk location, NOT persisted inside the JSON.
export type WorkflowSource = 'global' | 'project'

export interface Workflow {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  // Location tags — set when listing/loading; stripped before writing.
  source?: WorkflowSource
  projectId?: string
}

// ─── Task (workflow instance) ────────────────────────────────────────────────
// A Task is an instance of a Workflow bound to a Project. Persisted event-sourced
// as JSONL at ~/.awog/tasks/<id>/events.log with a derived task.json snapshot
// (ADR 0024 D-2). Mirror of UI shape (apps/desktop/ui/types/index.ts).

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_connection'
  | 'paused'
  | 'completed'
  | 'failed'

export type PhaseStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'waiting_connection'
  | 'completed'
  | 'failed'

export type RunStatus = 'running' | 'waiting_approval' | 'completed' | 'superseded' | 'failed'

// `connectionId` = the mcpServerId of the connection the task uses to reach its
// source. Optional; the engine unions that MCP server into every node. Token
// never lives here — only the id (ADR 0025, simplified: no service tag/tier).
export type TaskSource =
  | { type: 'github'; repo: string; issueNumber: number; url: string; connectionId?: string }
  | { type: 'jira'; key: string; connectionId?: string }
  | { type: 'manual' }

export interface TraceNode {
  id: string
  type: 'agent' | 'subagent' | 'tool' | 'thinking' | 'todo'
  name?: string
  model?: string
  purpose?: string
  tool?: string
  input?: string
  result?: string
  text?: string
  agentName?: string
  agentId?: string
  // Todo node (type === 'todo', from a TodoWrite tool call): the live checklist.
  todos?: TodoItem[]
  duration: string | null
  startedAt?: string
  status?: 'running'
  children?: TraceNode[]
}

export interface TaskMessage {
  role: 'user' | 'agent'
  text: string
  at: string
}

export interface TaskRun {
  version: number
  status: RunStatus
  output: string
  trace: TraceNode[]
  messages: TaskMessage[]
  duration: string | null
  approvedBy?: 'human' | 'auto'
  approvedAt?: string
  triggeredBy?: 'rerun' | 'resume-connection'
}

export interface TaskPhase {
  nodeId: string
  status: PhaseStatus
  skillName: string
  runs: TaskRun[]
}

export interface Task {
  id: string
  title: string
  projectId: string
  source: TaskSource
  description: string
  workflowId: string
  status: TaskStatus
  // Singular currentNodeId kept for back-compat; with the parallel scheduler the
  // authoritative "what is running" is derived from per-phase status.
  currentNodeId: string | null
  waitingApproval: string | null
  // Deferred (ADR 0010) — always null in v1; kept so the producer is additive.
  waitingConnection: unknown | null
  createdAt: string
  // Snapshot of the workflow DAG at creation time so editing the workflow later
  // never mutates a running task (ADR 0024 risk #4). Optional for legacy reads.
  workflowSnapshot?: Workflow
  // Snapshot of the `commitCoAuthor` Git setting (UI) at creation time. When
  // true the per-phase auto-commit appends `Co-Authored-By: AWOG …`. Optional
  // for legacy tasks — undefined is treated as enabled.
  commitCoAuthor?: boolean
  phases: Record<string, TaskPhase>
}

// ─── Hooks ─────────────────────────────────────────────────────────────────
// User-defined shell commands run when a lifecycle event fires (ADR 0032).
// Persisted per-file JSON, two tiers (D-3): global ~/.awog/hooks/<id>.json +
// project {project.path}/.awog/hooks/<id>.json. source/projectId are location-
// derived (NOT stored in the file), mirroring Workflows. Mirror of UI shape
// (apps/desktop/ui/types/index.ts).

export type HookEvent =
  | 'task.before-start'
  | 'task.after-complete'
  | 'phase.before-run'
  | 'phase.after-run'
  | 'phase.before-approve'
  | 'phase.after-approve'
  | 'artifact.before-write'
  | 'artifact.after-write'
  | 'agent.before-prompt'
  | 'agent.after-response'
  | 'tool.before-call'
  | 'tool.after-call'
  | 'mcp.server-error'
  | 'session.reset'

export type HookRunMode = 'blocking' | 'background'

// Single editable home `.awog`, two tiers (ADR 0035). Project tiers run before
// global ("ưu tiên project").
//   global  → ~/.awog/hooks/*.json            (editable)
//   project → {project}/.awog/hooks/*.json     (editable)
// Claude Code settings.json hooks are an import source only (migration/), not a
// live tier.
export type HookSource = 'global' | 'project'

export interface HookRunRecord {
  at: string
  durationMs: number
  exitCode: number
  stderr?: string
}

export interface Hook {
  id: string
  name: string
  description: string
  event: HookEvent
  // Map jsonPath → glob/value filter (AND across keys). Empty = match all.
  matcher: Record<string, string>
  command: string
  // Default '${workspace}' — expanded to the project root by the dispatcher.
  cwd: string
  timeoutMs: number
  runMode: HookRunMode
  enabled: boolean
  // Extra env vars; values may be `secret:KEY` refs resolved via OS keychain.
  env?: Record<string, string>
  // Location tags — set when listing/loading; stripped before writing.
  source?: HookSource
  projectId?: string
  // Whether the hook is allowed to spawn. Global = always true; project-tier =
  // false until the user grants trust (D-8). Runtime-only — never written.
  trusted?: boolean
  // Imported Claude Code hook (claude-*): not editable in AWOG. Dispatched with
  // a Claude-Code-shaped stdin payload so CC hook scripts work.
  readOnly?: boolean
  recentRuns?: HookRunRecord[]
}

// Per-tier scan report (mirrors SkillScanReport) — surfaces which dirs were
// scanned + how many hooks each held, so a misconfigured HOME is diagnosable.
export interface HookScanReport {
  dir: string
  source: HookSource
  found: number
  projectId?: string
}

// Payload contract passed to a hook on stdin + used for matcher/template (D-7).
export interface HookPayload {
  event: HookEvent
  ts: string
  taskId?: string
  nodeId?: string
  sessionId?: string
  // Per-event detail bag (path, toolName, status, …). Matcher keys + `{{...}}`
  // templates resolve against `event.payload.<key>` (and top-level fields).
  payload: Record<string, unknown>
}

// ─── Rules ─────────────────────────────────────────────────────────────────
// User-authored instruction files auto-injected into the agent system prompt
// for sessions + tasks (the AWOG-native analog of CLAUDE.md / .claude/rules).
// Per-file Markdown (YAML frontmatter + body), two tiers like Skills/Hooks:
//   global  → ~/.awog/rules/<id>.md            (applies to every session/task)
//   project → {project.path}/.awog/rules/<id>.md (applies to that project only)
// source/projectId are location-derived (not in the file). The body is appended
// to systemPromptAppend (augments, never replaces, the agent's own prompt).

// Single editable home `.awog`, two tiers (ADR 0035). CLAUDE.md / .claude/rules
// are import sources only (migration/) — NO live injection anymore (supersedes
// ADR 0033 D-4).
//   global  → ~/.awog/rules/*.md            (editable)
//   project → {project}/.awog/rules/*.md     (editable)
export type RuleSource = 'global' | 'project'

export interface Rule {
  id: string
  name: string
  description: string
  // The instruction text injected into the system prompt.
  body: string
  enabled: boolean
  // Location tags — set when listing/loading; stripped before writing.
  source?: RuleSource
  projectId?: string
  // Imported Claude Code file (claude-*): always enabled, not editable in AWOG.
  readOnly?: boolean
}

export interface RuleScanReport {
  dir: string
  source: RuleSource
  found: number
  projectId?: string
}

// ─── Slash Commands ──────────────────────────────────────────────────────────
// User-authored prompt templates invoked from the session composer with `/name`
// (the AWOG-native analog of Claude Code's `.claude/commands/*.md`). Per-file
// Markdown (YAML frontmatter + body); the body is the prompt expanded on send,
// with `$ARGUMENTS` / `$1`…`$9` substituted from what the user types after the
// name. Single editable home `.awog`, two tiers (ADR 0035):
//   global  → ~/.awog/commands/*.md          (editable)
//   project → {project}/.awog/commands/*.md   (editable)
// source/projectId are location-derived (not written into the file).
// `.claude/commands` are an import source only (migration/), not a live tier.
export type CommandSource = 'global' | 'project'

export interface Command {
  // Slug = the name typed after `/`. Subdirectory namespacing uses ':' (a
  // Claude Code `frontend/component.md` → id `frontend:component`).
  id: string
  name: string
  description: string
  // The prompt template. `$ARGUMENTS` / `$1`…`$9` are substituted on send.
  body: string
  // Optional Claude-Code frontmatter passthrough (shown in UI; stored verbatim).
  argumentHint?: string
  allowedTools?: string
  model?: string
  enabled: boolean
  // Location tags — set when listing/loading; stripped before writing.
  source?: CommandSource
  projectId?: string
  // Imported Claude Code command (claude-*): editable in-app (writes back to the
  // source file), flagged so the UI shows a Lock badge + import grouping.
  readOnly?: boolean
}

export interface CommandScanReport {
  dir: string
  source: CommandSource
  found: number
  projectId?: string
}

// ─── Config import (migration) — ADR 0035 / config-import-assistant ──────────
// The 5 config-entity kinds that live under `.awog/` and can be imported from
// `.claude`/`.agents` or bundled into a Project Template.
export type ConfigKind = 'agent' | 'skill' | 'hook' | 'rule' | 'command'

// One importable item discovered in a `.claude`/`.agents` source (NOT yet in
// `.awog`). `targetScope` is where importing would write it.
export interface ImportCandidate {
  kind: ConfigKind
  id: string
  name: string
  // Human label of the source location, e.g. '.claude/agents', 'CLAUDE.md'.
  fromLabel: string
  targetScope: 'global' | 'project'
  projectId?: string
  // True when an entity of this kind+id already exists in the target `.awog`
  // tier — the UI deselects these by default and import skips them.
  alreadyExists: boolean
}

export interface ImportResult {
  imported: { kind: ConfigKind; id: string }[]
  skipped: { kind: ConfigKind; id: string; reason: string }[]
}

// ─── Project Templates — ADR 0036 ────────────────────────────────────────────
// A self-contained bundle of config copied to `~/.awog/templates/<id>/` and
// installed into a project's `.awog/` tiers.
export interface TemplateEntityRef {
  kind: ConfigKind
  id: string
  // Path relative to the bundle root, e.g. 'agents/foo.md', 'skills/bar/SKILL.md'.
  file: string
}

export interface ProjectTemplate {
  id: string
  name: string
  description: string
  createdAt: string
  // Project the template was exported from (informational only).
  sourceProjectId?: string
  entities: TemplateEntityRef[]
}

export interface TemplateInstallResult {
  installed: { kind: ConfigKind; id: string }[]
  skipped: { kind: ConfigKind; id: string; reason: string }[]
}

// Result of fetching one or more template bundles from a remote GitHub folder
// (ADR 0037). `imported` are the bundles written to ~/.awog/templates/;
// `skipped` records bundles left untouched (already exist, duplicate id, etc.).
export interface TemplateFetchResult {
  imported: ProjectTemplate[]
  skipped: { id: string; reason: string }[]
}
