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

export type SkillCategory = 'Analysis' | 'Design' | 'Development' | 'Quality'

export interface Skill {
  id: string
  name: string
  category: SkillCategory
  description: string
  inputs: string[]
  outputs: string[]
  promptTemplate: string
  tags: string[]
}

export interface Agent {
  id: string
  name: string
  role: string
  model: string
  skillIds: string[]
  context: string[]
  systemPrompt: string
}

export interface WorkflowNode {
  id: string
  agentId: string
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

export interface Workflow {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_connection'
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

export interface ProviderAccount {
  id: string
  label: string
  authMode: AuthMode
  fingerprint: string
  status: AccountStatus
  expiresAt?: number
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

export type TaskSource =
  | { type: 'github'; repo: string; issueNumber: number; url: string }
  | { type: 'jira'; key: string }
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
  phases: Record<string, Phase>
}

export interface SessionArtifactRef {
  name: string
  preview?: string
}

export type SessionTokenKind = 'agent' | 'skill' | 'file' | 'command'

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

export interface SessionStep {
  id: string
  kind: 'tool' | 'group' | 'thinking' | 'note' | 'plan'
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
  planItems?: string[]
  planStatus?: PlanStatus
  planRationale?: string
}

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
  attachments?: SessionAttachment[]
  modeAtSend?: AgentMode
  startedAt?: number
  completedAt?: number
  modelUsed?: string
  usage?: { inputTokens: number; outputTokens: number }
}

export type ThinkingLevel = 'standard' | 'high' | 'extra-high'

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
  matcher: Record<string, string>
  command: string
  cwd: string
  timeoutMs: number
  runMode: HookRunMode
  enabled: boolean
  env?: Record<string, string>
  recentRuns: HookRunRecord[]
}

// ─── Slash Commands ────────────────────────────────────────────────────────

export type CommandType = 'prompt' | 'agent-switch' | 'shell' | 'workflow'
export type CommandArgType = 'string' | 'number' | 'file' | 'agent' | 'artifact' | 'boolean'
export type CommandScope = 'global' | `project:${string}` | `agent:${string}`

export interface CommandArg {
  name: string
  type: CommandArgType
  required: boolean
  description: string
  default?: string
}

export interface SlashCommand {
  id: string
  name: string
  aliases: string[]
  description: string
  type: CommandType
  args: CommandArg[]
  body: string
  scope: CommandScope
  timeoutMs?: number
  system?: boolean
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
  refs: string[]
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

export type GitMergeConflictBlock = {
  startLine: number
  endLine: number
  ours: string
  theirs: string
  base?: string
  resolution: GitConflictResolutionChoice
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
export type ThemeColor = AccentPreset
export type SurfaceDepth = 'flat' | 'standard' | 'deep'

export interface AppearanceSettings {
  sansFamily: SansFontFamily
  monoFamily: MonoFontFamily
  fontSize: number
  fontWeight: FontWeight
  accent: AccentPreset
  themeColor: ThemeColor
  surfaceDepth: SurfaceDepth
}
