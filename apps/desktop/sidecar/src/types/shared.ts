// Shared types across sidecar modules. Names mirror RPC payload shape.

export type ProviderName = 'anthropic' | 'openai' | 'google'

export type AuthMode = 'oauth' | 'apikey'

export type AccountStatus = 'connected' | 'expired' | 'disconnected'

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope?: string
  tokenUuid?: string
}

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
  apiKey?: string
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
}

export interface SessionMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  agentId?: string
  text: string
  at: string
  modeAtSend?: AgentMode
  // Metadata persisted so UI re-hydrate from JSONL keeps assistant features
  // (markdown rendering, latency badge, model name, token counters).
  startedAt?: number
  completedAt?: number
  modelUsed?: string
  usage?: { inputTokens: number; outputTokens: number }
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
  // Claude Agent SDK session id captured on the first turn, used to `resume`
  // subsequent turns instead of re-sending the whole transcript (ADR 0023).
  // Resumable cache only — AWOG JSONL stays the source of truth; cleared/re-seeded
  // when resume fails. Opaque UUID.
  sdkSessionId?: string
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

export type SessionStepDetail =
  | { kind: 'file'; path: string; content: string; language?: string }
  | { kind: 'list'; items: { label: string; path?: string; snippet?: string }[] }
  | { kind: 'terminal'; command: string; output?: string; exitCode?: number }
  | { kind: 'text'; content: string }

export interface SessionStep {
  id: string
  kind: 'tool' | 'group' | 'thinking' | 'note' | 'plan'
  tool?: SessionStepTool
  label: string
  target?: string
  description?: string
  additions?: number
  deletions?: number
  pathHint?: string
  status?: SessionStepStatus
  detail?: SessionStepDetail
  // Subagent grouping: when set, this step ran inside the Task step with this
  // tool_use_id. UI nests the step under that parent instead of rendering
  // top-level. Source: SDK's `parent_tool_use_id` on stream_event/assistant/user.
  parentId?: string
}

// ─── Project ───────────────────────────────────────────────────────────────
// Mirror of UI shape (apps/desktop/ui/types/index.ts). Stored as plain JSON
// at ~/.awog/projects/<id>.json — see ADR 0012.

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

// ─── Skill ─────────────────────────────────────────────────────────────────
// Stored as a folder containing SKILL.md (YAML frontmatter + markdown body).
// Five tiers, all using the same SKILL.md shape so files are interchangeable
// with Claude Code SDK and craft-agents-oss:
//
//   global         → ~/.awog/skills/<id>/SKILL.md           (AWOG-native)
//   user-claude    → ~/.claude/skills/<id>/SKILL.md         (Claude Code SDK)
//   user-agents    → ~/.agents/skills/<id>/SKILL.md         (Craft Agents)
//   project-claude → {project.path}/.claude/skills/<id>/SKILL.md
//   project-agents → {project.path}/.agents/skills/<id>/SKILL.md
//
// The three user-level tiers are always scanned (no projectId required); the
// two project-level tiers require a projectId.

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
// Stored as a single `.md` file with YAML frontmatter + markdown body, format-
// compatible with Claude Code SDK subagent convention. Five tiers (mirroring
// Skills — see SkillSource):
//
//   global         → ~/.awog/agents/<id>.md           (AWOG-native)
//   user-claude    → ~/.claude/agents/<id>.md         (Claude Code SDK)
//   user-agents    → ~/.agents/agents/<id>.md         (Craft Agents)
//   project-claude → {project.path}/.claude/agents/<id>.md
//   project-agents → {project.path}/.agents/agents/<id>.md
//
// Frontmatter is interchangeable with Claude Code subagents. AWOG extends with
// `role` for the workspace agent picker; a no-op for vanilla Claude Code but
// harmless. systemPrompt = body. See ADR 0015.

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
  type: 'agent' | 'subagent' | 'tool' | 'thinking'
  name?: string
  model?: string
  purpose?: string
  tool?: string
  input?: string
  result?: string
  text?: string
  agentName?: string
  agentId?: string
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
  phases: Record<string, TaskPhase>
}
