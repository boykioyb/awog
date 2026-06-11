// Entity types ported from prototype / docs/architecture/data-model.md

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
}

// Skill = a SKILL.md folder. The id IS the slug (folder name on disk).
// Five possible source tiers:
//   global         → ~/.awog/skills/<id>/SKILL.md           (AWOG-native)
//   user-claude    → ~/.claude/skills/<id>/SKILL.md         (Claude Code SDK)
//   user-agents    → ~/.agents/skills/<id>/SKILL.md         (Craft Agents)
//   project-claude → {project.path}/.claude/skills/<id>/SKILL.md
//   project-agents → {project.path}/.agents/skills/<id>/SKILL.md
// User-level tiers are always scanned; project tiers require a projectId.
// Same shape as Claude Code SDK / craft-agents-oss skills so they are
// interchangeable on disk.
export type SkillSource =
  | 'global'
  | 'user-claude'
  | 'user-agents'
  | 'project-claude'
  | 'project-agents'

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

// Mirror of sidecar Agent (apps/desktop/sidecar/src/types/shared.ts). Five
// tiers like Skills. systemPrompt = body of the AGENT.md file; description +
// model + role live in YAML frontmatter. See ADR 0015.

export type AgentSource =
  | 'global'
  | 'user-claude'
  | 'user-agents'
  | 'project-claude'
  | 'project-agents'

export interface Agent {
  id: string
  source: AgentSource
  projectId?: string
  name: string
  description: string
  // LLM provider this agent runs on (ADR 0026). Default 'anthropic'. The
  // `model` must belong to this provider.
  provider: ProviderName
  // Optional per-agent account (id in credentials.json). Undefined = use the
  // provider's active account. Falls back to active if the id no longer exists.
  accountId?: string
  model: string
  systemPrompt: string
  role: string
  // Claude Code subagent `tools` field — SDK toolset whitelist. When set,
  // session sidecar forwards as Options.allowedTools so the agent only sees
  // these tools (Read/Write/Edit/Bash/Grep/…). Empty/undefined = full toolset.
  tools?: string[]
  // Per-agent MCP server whitelist (ADR 0016 — replaces Context Providers).
  // Empty/undefined = inherit session's MCP set. When set, session sidecar
  // intersects with the global enabled set + session-level whitelist before
  // forwarding to the SDK.
  mcpServerIds?: string[]
}

export interface WorkflowNode {
  id: string
  agentId: string
  // Agent identity tuple (ADR 0024 D-11). Optional so legacy/mock workflows
  // still parse; the inspector fills these when an agent is picked, and the
  // engine's node-runner uses them for loadAgent(id, source, projectId).
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

// Where a workflow is stored (ADR 0024 follow-up). 'global' = shared across
// projects (~/.awog/workflows); 'project' = lives in the repo
// ({project.path}/.awog/workflows, git-trackable). Like Skills, these are tags
// derived from the on-disk location — not persisted in the JSON itself.
export type WorkflowSource = 'global' | 'project'

export interface Workflow {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  source?: WorkflowSource
  projectId?: string
}

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

export type ConnectionUnavailableKind = 'quota' | 'rate_limit' | 'invalid_key'

export type ProviderName = 'anthropic' | 'openai' | 'google'

export type AuthMode = 'oauth' | 'apikey'
export type AccountStatus = 'connected' | 'expired' | 'disconnected'

// Wire protocol a custom endpoint speaks (ADR 0029 Phase C3). 'anthropic-
// messages' = Anthropic Messages API (Phase B default); 'openai-completions' =
// OpenAI Chat Completions (Ollama/vLLM/LM Studio/OpenRouter).
export type EndpointApi = 'anthropic-messages' | 'openai-completions'

export interface ProviderAccount {
  id: string
  label: string
  authMode: AuthMode
  fingerprint: string
  status: AccountStatus
  expiresAt?: number
  // Custom endpoint (ADR 0026 Phase B / ADR 0029 Phase C3). Present only for
  // apikey accounts pointing at a user-supplied base URL (Ollama, vLLM,
  // OpenRouter…). Non-secret; drives the custom-endpoint UI + agent model list.
  baseURL?: string
  // Wire protocol the custom endpoint speaks (ADR 0029 Phase C3). Undefined ⇒
  // inferred from provider (anthropic → anthropic-messages, else openai-
  // completions). Only present when baseURL is set.
  api?: EndpointApi
  models?: string[]
  organization?: { uuid: string; name: string }
  account?: { uuid: string; email: string }
  version: number
  createdAt: string
}

export interface WaitingConnectionInfo {
  provider: ProviderName
  phaseNodeId: string
  failedRunVersion: number
  at: string
  keyFingerprintAtPause: string
  kind: ConnectionUnavailableKind
}

// `connectionId` = mcpServerId of the connection used to reach the source.
// Optional; engine unions that MCP server into every node (ADR 0025 simplified).
export type TaskSource =
  | { type: 'github'; repo: string; issueNumber: number; url: string; connectionId?: string }
  | { type: 'jira'; key: string; connectionId?: string }
  | { type: 'manual' }

export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export interface TodoItem {
  content: string
  status: TodoStatus
}

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

export interface Message {
  role: 'user' | 'agent'
  text: string
  at: string
}

export interface Run {
  version: number
  status: RunStatus
  output: string
  trace: TraceNode[]
  messages: Message[]
  duration: string | null
  approvedBy?: 'human' | 'auto'
  approvedAt?: string
  triggeredBy?: 'rerun' | 'resume-connection'
}

export interface Phase {
  nodeId: string
  status: PhaseStatus
  skillName: string
  runs: Run[]
}

export interface Task {
  id: string
  title: string
  projectId: string
  source: TaskSource
  description: string
  workflowId: string
  status: TaskStatus
  currentNodeId: string | null
  waitingApproval: string | null
  waitingConnection: WaitingConnectionInfo | null
  createdAt: string
  // Snapshot of the workflow DAG at creation time (sidecar fills this). Used so
  // editing the workflow later never mutates a running task (ADR 0024).
  workflowSnapshot?: Workflow
  phases: Record<string, Phase>
}

// ─── Task execution events (sidecar → UI, ADR 0024 D-5) ──────────────────────
// Streamed over the `sidecar-event` channel during task execution. Every event
// carries taskId so the long-lived listener routes to the right task; phase
// events add nodeId; run events add version. One event ↔ one persisted TaskEvent.

export interface TaskStatusEvent {
  taskId: string
  status: TaskStatus
  waitingApproval: string | null
}

export interface TaskPhaseStatusEvent {
  taskId: string
  nodeId: string
  status: PhaseStatus
}

export interface TaskRunStartedEvent {
  taskId: string
  nodeId: string
  version: number
  agentId?: string
  triggeredBy?: Run['triggeredBy']
}

export interface TaskRunTraceEvent {
  taskId: string
  nodeId: string
  version: number
  node: TraceNode
  parentId?: string | null
}

export interface TaskRunOutputEvent {
  taskId: string
  nodeId: string
  version: number
  delta?: string
  output?: string
}

export interface TaskRunDoneEvent {
  taskId: string
  nodeId: string
  version: number
  status: RunStatus
  duration: string | null
  approvedBy?: 'human' | 'auto'
  approvedAt?: string
}

export interface TaskArtifactWrittenEvent {
  taskId: string
  nodeId: string
  version: number
  path: string
  name: string
  commitSha?: string
}

export interface TaskMessageEvent {
  taskId: string
  nodeId: string
  version: number
  message: Message
}

export interface SessionArtifactRef {
  name: string
  preview?: string
}

export type SessionTokenKind = 'agent' | 'skill' | 'file' | 'command' | 'usercommand'

export interface SessionMention {
  kind: SessionTokenKind
  targetId: string
  raw: string
  start: number
  end: number
}

export interface SessionAttachment {
  id: string
  name: string
  type: 'file' | 'image'
  size?: string
  preview?: string
  mime?: string
  url?: string
  width?: number
  height?: number
}

// One entry in the Session Info panel's "context files" list. Either a user
// attachment (in-memory data — opens in the lightbox, can't be revealed in the
// OS) or an `@file` mention (a real workspace-relative path that can be
// revealed / opened with the OS handler). `key` dedupes + keys the v-for.
export type SessionContextFile =
  | {
      kind: 'attachment'
      key: string
      name: string
      size?: string
      fileType: 'file' | 'image'
      attachment: SessionAttachment
    }
  | { kind: 'mention'; key: string; name: string; path: string }

// Composer-level annotation: user quotes an excerpt from a prior agent message
// and attaches a short instruction. Inlined into the next outgoing message as
// a quote block — see formatFollowUp in utils/follow-up.ts.
export interface SessionFollowUp {
  id: string
  // Anchor: which message the quote came from (for highlight/scroll-back).
  messageId: string
  selectedText: string
  note: string
}

export type StepTool =
  | 'read'
  | 'write'
  | 'edit'
  | 'save'
  | 'search'
  | 'find-files'
  | 'terminal'
  | 'task'

export type StepStatus = 'running' | 'done' | 'error'

export type StepDetail =
  | { kind: 'diff'; path: string; content: string }
  | { kind: 'file'; path: string; content: string; language?: string }
  | { kind: 'list'; items: { label: string; path?: string; snippet?: string }[] }
  | { kind: 'terminal'; command: string; output?: string; exitCode?: number }
  | { kind: 'text'; content: string }

export type PlanStatus = 'pending' | 'approved' | 'rejected'

// AskUserQuestion (kind === 'question'): the model pauses the turn to ask the
// user 1–4 multiple-choice questions. Mirrors the sidecar shapes.
// See docs/features/ask-user-question.md.
export interface SessionQuestionOption {
  label: string
  description?: string
}
export interface SessionQuestion {
  header: string
  question: string
  options: SessionQuestionOption[]
  multiSelect: boolean
}
export interface SessionQuestionAnswer {
  header: string
  selected: string[]
}

export interface SessionStep {
  id: string
  kind: 'tool' | 'group' | 'thinking' | 'note' | 'plan' | 'question'
  tool?: StepTool
  label: string
  target?: string
  description?: string
  additions?: number
  deletions?: number
  pathHint?: string
  status?: StepStatus
  children?: SessionStep[]
  detail?: StepDetail
  // Raw plan markdown (rendered as a document); planItems/planRationale are the
  // legacy flattened fallback for older persisted steps.
  planMarkdown?: string
  planItems?: string[]
  planStatus?: PlanStatus
  planRationale?: string
  // Todo step (kind === 'note', from a TodoWrite call): the live checklist the
  // UI renders inline. Mirrors the sidecar SessionStep.todos field.
  todos?: TodoItem[]
  // Question step (kind === 'question', from an AskUserQuestion call): the asked
  // questions and — once answered — the user's chosen answers. SessionQuestionCard
  // renders the interactive form while `answers` is unset, then a read-only record.
  questions?: SessionQuestion[]
  answers?: SessionQuestionAnswer[]
  // tool_use_id of the parent Task step when this step ran inside a subagent.
  // Sidecar fills this from the SDK's parent_tool_use_id; UI store uses it to
  // attach the step under the parent's `children` array instead of top-level.
  parentId?: string
  // Character offset into the assistant `text` at which this tool fired (= length
  // of the text streamed so far) so SessionMessageItem can interleave step rows
  // with the reply text in chronological order. Stamped + PERSISTED by the sidecar
  // (sessions.send-message) so it survives a JSONL reload; the store only stamps
  // as a fallback for the rare step that arrives without it. Unset for nested
  // subagent steps.
  textOffset?: number
}

// One ordered slice of an assistant turn (ADR 0032): a run of reply text or a
// single step. The array order IS the timeline — no character offsets. Subagent
// steps nest under their parent step's `children` (re-nested on hydrate).
export type SessionMessagePart = { kind: 'text'; text: string } | SessionStep

export interface SessionMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  agentId?: string
  text: string
  at: string
  artifacts?: SessionArtifactRef[]
  mentions?: SessionMention[]
  suggestedSkillIds?: string[]
  steps?: SessionStep[]
  // Ordered timeline (ADR 0032): reply-text runs interleaved with steps, subagent
  // steps nested. Authoritative when present — SessionMessageItem renders it
  // directly; absent (legacy / live stream before finalize) → it derives the order
  // from `text` + `steps`. Built + persisted by the sidecar.
  parts?: SessionMessagePart[]
  attachments?: SessionAttachment[]
  followUps?: SessionFollowUp[]
  modeAtSend?: AgentMode
  startedAt?: number
  completedAt?: number
  modelUsed?: string
  usage?: { inputTokens: number; outputTokens: number }
  canceled?: boolean
}

export type ThinkingLevel = 'low' | 'medium' | 'high' | 'extra-high' | 'max'

export type AgentMode = 'ask' | 'accept-edits' | 'plan' | 'execute'

export interface SessionSettings {
  provider: ProviderName
  modelId: string
  level: ThinkingLevel
  mode: AgentMode
  accountId?: string
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
  // SDK tool names the user has disabled for this session. Empty / undefined
  // means default Claude Code preset (all built-in tools available). Passed to
  // sidecar as Options.disallowedTools per turn.
  disabledTools?: string[]
  // MCP server ids the user has explicitly opted into for this session.
  // `undefined` = use all currently enabled servers (legacy/new session default).
  // `[]` = explicitly no MCP servers attached. `[id1, id2]` = only these.
  mcpServerIds?: string[]
  // Claude Agent SDK session id captured by the sidecar on the first turn, used
  // to resume subsequent turns (ADR 0023). Owned/persisted by the sidecar; the
  // UI never sends it — it only hydrates it from the session JSONL.
  sdkSessionId?: string
}

// ─── Session Workspace Panel ─────────────────────────────────────────────────
// Right-docked panel in the Session detail view exposing workspace tools that
// run alongside the chat. Mirrors Claude Code's workspace switcher.

export type WorkspaceTab = 'diff' | 'files' | 'plan' | 'terminal' | 'tasks' | 'preview'

// Where the workspace drawer docks (overlay on top of the chat).
export type WorkspacePanelPosition = 'right' | 'left' | 'bottom'

// One entry from `fs.listDir`. `path` is workspace-relative (POSIX-style).
export interface FsEntry {
  name: string
  path: string
  kind: 'file' | 'dir'
  size?: number
}

// Result of `fs.readFile`. `content` is empty when `isBinary` or fully capped.
export interface FsFileContent {
  path: string
  content: string
  language?: string
  truncated: boolean
  isBinary: boolean
}

// One hit from `fs.search` (find-in-files). `line`/`column` are 1-based.
export interface FsSearchMatch {
  path: string
  line: number
  column: number
  preview: string
}

// Handle to a live PTY owned by the sidecar terminal manager.
export interface TerminalSessionRef {
  terminalId: string
  sessionId: string
  createdAt: number
}

// View-model derived from in-flight session steps (not persisted) — the
// Background tasks tab aggregates running bash / subagent steps of a turn.
export interface WorkspaceBackgroundTask {
  id: string
  kind: 'bash' | 'subagent'
  label: string
  status: StepStatus
}

// ─── MCP Server ────────────────────────────────────────────────────────────

export type MCPTransport = 'stdio' | 'http' | 'sse'
export type MCPTrust = 'allow' | 'prompt' | 'deny'
export type MCPStatus = 'running' | 'starting' | 'idle' | 'error' | 'disabled'

export interface MCPTool {
  name: string
  description: string
}

export interface MCPResource {
  uri: string
  mime: string
}

export interface MCPServer {
  id: string
  name: string
  description: string
  transport: MCPTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  autoStart: boolean
  timeoutMs: number
  trust: MCPTrust
  deniedTools?: string[]
  status: MCPStatus
  tools: MCPTool[]
  resources: MCPResource[]
  lastError?: string
}

// ─── Hooks ─────────────────────────────────────────────────────────────────

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

// AWOG-native tiers (global/project) are editable; claude-* are IMPORTED
// read-only from Claude Code settings.json hooks (PreToolUse/PostToolUse),
// prioritised so project runs before global.
export type HookSource = 'global' | 'project' | 'claude-project' | 'claude-local' | 'claude-user'

export interface HookRunRecord {
  at: string
  durationMs: number
  exitCode: number
  stderr?: string
}

// Per-tier scan report (mirrors SkillScanReport) — which dirs were scanned + how
// many hooks each held, surfaced in the refresh toast.
export interface HookScanReport {
  dir: string
  source: HookSource
  found: number
  projectId?: string
}

export interface Hook {
  id: string
  name: string
  description: string
  event: HookEvent
  matcher: Record<string, string>
  command: string
  cwd: string
  timeoutMs: number
  runMode: HookRunMode
  enabled: boolean
  env?: Record<string, string>
  // Location tags — set by the sidecar on list/load; default to global tier.
  source?: HookSource
  projectId?: string
  // Trust gate (ADR 0032 D-8): global = always true; project-tier = false until
  // the user grants trust. Untrusted hooks never spawn.
  trusted?: boolean
  // Imported Claude Code hook (claude-*): not editable in AWOG.
  readOnly?: boolean
  recentRuns: HookRunRecord[]
}

// ─── Rules ─────────────────────────────────────────────────────────────────
// Markdown instruction files auto-injected into the agent system prompt for
// sessions + tasks (ADR 0033). Two tiers (global / project) like Skills/Hooks.

// AWOG-native tiers (global/project) are editable; claude-* are IMPORTED
// read-only from Claude Code config (CLAUDE.md / .claude/rules), prioritised on
// injection (ADR 0033 D-4 amended).
export type RuleSource = 'global' | 'project' | 'claude-project' | 'claude-rules' | 'claude-user'

export interface Rule {
  id: string
  name: string
  description: string
  // The instruction text injected into the system prompt.
  body: string
  enabled: boolean
  // Location tags — set by the sidecar on list/load; default to global tier.
  source?: RuleSource
  projectId?: string
  // Imported Claude Code file: not editable in AWOG, always injected.
  readOnly?: boolean
}

export interface RuleScanReport {
  dir: string
  source: RuleSource
  found: number
  projectId?: string
}

// ─── Slash Commands ────────────────────────────────────────────────────────
// User-authored prompt templates invoked from the composer with `/name` (the
// AWOG-native analog of Claude Code's `.claude/commands/*.md`). Per-file
// Markdown; the body is expanded into the prompt on send (`$ARGUMENTS` / `$1`…).
// AWOG-native tiers (global/project) are fully editable; claude-* tiers are
// imported from Claude Code config (editable in-app, writes back to source).
export type CommandSource = 'global' | 'project' | 'claude-project' | 'claude-user'

export interface Command {
  // Slug = the name typed after `/` (subdir namespacing uses ':').
  id: string
  name: string
  description: string
  // Prompt template; `$ARGUMENTS` / `$1`…`$9` substituted on send.
  body: string
  // Optional Claude-Code frontmatter passthrough.
  argumentHint?: string
  allowedTools?: string
  model?: string
  enabled: boolean
  // Location tags — set by the sidecar on list/load; default to global tier.
  source?: CommandSource
  projectId?: string
  // Imported Claude Code command: editable in-app, flagged for the Lock badge.
  readOnly?: boolean
}

export interface CommandScanReport {
  dir: string
  source: CommandSource
  found: number
  projectId?: string
}

// ─── Git Manager ───────────────────────────────────────────────────────────

export type GitFileStatusCode =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'

export type GitFileStatus = {
  projectId: string
  path: string
  oldPath?: string
  index: GitFileStatusCode | 'clean'
  workTree: GitFileStatusCode | 'clean'
  isBinary: boolean
  isStaged: boolean
  hasConflict: boolean
}

// Decoration ref attached to a commit — mirrors sidecar `GitRef` so the UI can
// render each ref as a styled chip (branch / remote / tag / HEAD / stash).
export type GitRefKind = 'branch' | 'remote-branch' | 'tag' | 'HEAD' | 'stash'

export type GitRefDecoration = {
  kind: GitRefKind
  name: string
}

export type GitCommit = {
  projectId: string
  hash: string
  shortHash: string
  authorName: string
  authorEmail: string
  date: string
  subject: string
  body?: string
  parents: string[]
  refs: GitRefDecoration[]
  phaseId?: string
  agentId?: string
}

export type GitBranch = {
  projectId: string
  name: string
  isCurrent: boolean
  isRemote: boolean
  upstream?: string
  ahead: number
  behind: number
  lastCommit: string
}

export type GitStashEntry = {
  projectId: string
  index: number
  ref: string
  message: string
  date: string
  branch: string
}

export type GitRemote = {
  projectId: string
  name: string
  fetchUrl: string
  pushUrl: string
}

// A git repo discovered inside a project folder. A project may be a container
// holding several repos in subfolders — surfaced via `git.discoverRepos` so the
// Git header can show a repo picker. Mirror of sidecar GitRepoEntry.
export type GitRepoEntry = {
  path: string
  name: string
  relativePath: string
  isRoot: boolean
}

export type GitDiffLineKind = 'context' | 'add' | 'del'

export type GitDiffLine = { kind: GitDiffLineKind; text: string }

export type GitDiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: GitDiffLine[]
}

export type GitFileDiff = {
  path: string
  oldPath?: string
  isBinary: boolean
  hunks: GitDiffHunk[]
}

export type GitConflictResolutionChoice = 'ours' | 'theirs' | 'manual' | 'unresolved'

// Mirrors sidecar shape from `git.readConflictFile` so the resolver UI works
// against live filesystem data without an adapter layer.
export type GitMergeConflictBlock = {
  index: number
  startLine: number
  separatorLine: number
  endLine: number
  ours: string[]
  theirs: string[]
  oursLabel: string
  theirsLabel: string
}

// Loaded sidecar response for the currently focused conflicted file. Binary
// files have no blocks (file-level pick only).
export type GitConflictFile = {
  path: string
  isBinary: boolean
  blocks: GitMergeConflictBlock[]
}

export type GitRepoState = 'clean' | 'dirty' | 'merging' | 'rebasing' | 'detached' | 'no-repo'

// Editor (pages/edit/[taskId].vue) -------------------------------------------------

export type EditorFileKind = 'md' | 'diff' | 'yaml'

export type EditorViewMode = 'code' | 'split' | 'preview'

export type EditorTaskFile = {
  fileName: string
  content: string
  phase: string
  version: number
  kind: EditorFileKind
}

export type EditorDiffStats = {
  files: number
  additions: number
  deletions: number
}

export type SansFontFamily = 'system' | 'inter' | 'geist'
export type MonoFontFamily = 'system' | 'jetbrains-mono' | 'fira-code'
export type FontWeight = 300 | 400 | 500 | 600 | 700
export type AccentPreset =
  | 'mono'
  | 'blue'
  | 'violet'
  | 'cyan'
  | 'emerald'
  | 'rose'
  | 'amber'
  | 'monokai'
  | 'dracula'
  | 'nord'
  | 'tokyo'
  | 'gruvbox'
  | 'catppuccin'
/**
 * Full dark background bases (not accents). Selected via the Theme color picker;
 * they replace the surface palette outright instead of tinting it. Dark-theme only.
 */
export type BackgroundPreset = 'github-dark' | 'subtle-purple'
export type ThemeColor = AccentPreset | BackgroundPreset | 'custom'
export type SurfaceDepth = 'flat' | 'standard' | 'deep'

export type AppLocale = 'en' | 'vi'

export interface AppearanceSettings {
  sansFamily: SansFontFamily
  monoFamily: MonoFontFamily
  fontSize: number
  fontWeight: FontWeight
  accent: AccentPreset | 'custom'
  accentCustom: string
  themeColor: ThemeColor
  themeColorCustom: string
  // How strongly the hue-tint Theme color blends into surfaces, as a percent
  // (0–50). Only applies to hue tints — no effect for `mono` or background bases.
  themeColorStrength: number
  surfaceDepth: SurfaceDepth
  // Liquid Glass UI mode — translucent frosted surfaces + ambient backdrop across
  // the app. Toggle in Settings → Appearance; off falls back to solid surfaces.
  liquidGlass: boolean
  locale: AppLocale
}
