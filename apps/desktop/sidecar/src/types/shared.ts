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
// `role`, `skillIds`, `context` for the workspace agent picker; these are
// no-ops for vanilla Claude Code but harmless. systemPrompt = body.
// See ADR 0015.

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
  skillIds: string[]
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
