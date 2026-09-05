// Minimal mirror of the sidecar shapes the PWA consumes (source of truth:
// apps/desktop/sidecar/src/types/shared.ts + git/types.ts). Only the fields this
// thin client renders are declared — extras arriving on the wire are ignored.

export interface RemoteDevice {
  id: string
  label: string
  platform: string
  pairedAt: string
  lastSeenAt?: string
  revoked?: boolean
}

export type SessionRestingStatus = 'idle' | 'done' | 'awaiting' | 'error'

export interface SessionSummary {
  id: string
  title: string
  projectId: string | null
  updatedAt: string
  createdAt?: string
  status?: SessionRestingStatus
  messageCount: number
  lastPreview?: string
}

// ─── Session steps (subset) ─────────────────────────────────────────────────

export type PlanStatus = 'pending' | 'approved' | 'rejected'
export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  content: string
  status: TodoStatus
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface SessionQuestion {
  header: string
  question: string
  options: QuestionOption[]
  multiSelect: boolean
}

export interface SessionQuestionAnswer {
  header: string
  selected: string[]
}

export type SessionStepDetail =
  | { kind: 'diff'; path: string; diff: string; content?: string; language?: string }
  | { kind: 'file'; path: string; content: string; language?: string }
  | { kind: 'list'; items: { label: string; path?: string; snippet?: string }[] }
  | { kind: 'terminal'; command: string; output?: string; exitCode?: number }
  | { kind: 'text'; content: string }

export type SessionStepKind =
  | 'tool'
  | 'group'
  | 'thinking'
  | 'note'
  | 'plan'
  | 'question'
  | 'steer'

export interface SessionStep {
  id: string
  kind: SessionStepKind
  tool?: string
  label: string
  target?: string
  description?: string
  additions?: number
  deletions?: number
  status?: 'running' | 'done' | 'error'
  detail?: SessionStepDetail
  planMarkdown?: string
  planItems?: string[]
  planStatus?: PlanStatus
  planRationale?: string
  todos?: TodoItem[]
  questions?: SessionQuestion[]
  answers?: SessionQuestionAnswer[]
  steerText?: string
  parentId?: string
}

export type SessionMessagePart = { kind: 'text'; text: string } | SessionStep

export interface EngineMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  text: string
  at?: string
  steps?: SessionStep[]
  parts?: SessionMessagePart[]
  attachments?: SessionAttachment[]
  error?: { message: string }
}

// Agent mode for a turn — the same four values as the desktop (ui-next
// stores/settings.ts `AgentMode`). `accept-edits` auto-allows file writes and
// `execute` skips the permission gate entirely, so both run tools WITHOUT asking
// the phone; the gateway forwards whichever is chosen (remote-gateway-policy.ts
// REMOTE_ALLOWED_MODES).
export type AgentMode = 'ask' | 'plan' | 'accept-edits' | 'execute'

export interface SessionSettings {
  provider: string
  modelId: string
  level: string
  mode: string
  accountId?: string
  responseStyle?: string
  responseStyleNoMarkdown?: boolean
}

export interface FullSession {
  id: string
  title: string
  projectId: string | null
  updatedAt: string
  settings?: SessionSettings
  messages: EngineMessage[]
  // Authoritative session checklist (ADR 0069) — the model writes it through
  // TodoWrite, the user through sessions.updateTodos.
  todos?: TodoItem[]
}

// User attachment on an outgoing message. Images carry an inline base64 `data:`
// URL; the gateway strips `path` (a desktop filesystem path) before forwarding.
export interface SessionAttachment {
  id: string
  name: string
  type: 'file' | 'image'
  size?: string
  mime?: string
  url?: string
  preview?: string
  width?: number
  height?: number
}

// ─── Search ─────────────────────────────────────────────────────────────────

export interface SessionSearchResult {
  sessionId: string
  sessionTitle: string
  projectId: string | null
  messageId: string
  role: 'user' | 'agent' | 'system'
  at: string
  snippet: string
}

// ─── Bootstrap (gateway-local `remote.bootstrap`) ───────────────────────────

export interface RemoteProject {
  id: string
  name: string
  color?: string
}

export interface RemoteModel {
  id: string
  name: string
}

// Account IDENTITY only (id/label/status) — the gateway never sends credentials.
export interface RemoteAccount {
  id: string
  label: string
  status?: string
  // Custom endpoints / Codex curate their own list; it wins over the provider catalog.
  models?: string[]
}

export interface RemoteProviderEntry {
  provider: string
  models: RemoteModel[]
  accounts: RemoteAccount[]
  activeAccountId: string | null
}

export interface RemoteBootstrap {
  projects: RemoteProject[]
  providers: RemoteProviderEntry[]
  defaults: { provider: string; modelId: string; level: string }
}

// What the session config sheet edits. '' means INHERIT — the gateway resolves it
// from the project's LLM defaults, then the desktop defaults. `responseStyle`
// 'Default' = no style.
export interface SessionConfig {
  provider: string
  accountId: string
  modelId: string
  level: string
  mode: AgentMode
  responseStyle: string
  responseStyleNoMarkdown: boolean
}

// What the PWA sends when creating a session — intent only. The gateway resolves
// cwd/system prompt server-side and validates the account (see
// remote-gateway-policy.ts).
export interface NewSessionInput {
  title?: string
  projectId?: string | null
  config: SessionConfig
}

// ─── Cost ───────────────────────────────────────────────────────────────────

export interface SessionCostDay {
  date: string
  costUsd: number
  totalTokens: number
  turns: number
}

export interface SessionCostBreakdown {
  sessionId: string
  byDay: SessionCostDay[]
  total: { costUsd: number; totalTokens: number; turns: number }
  firstAt?: string
  lastAt?: string
  hasUnpriced: boolean
}

// ─── Git (subset) ─────────────────────────────────────────────────────────

export interface GitFileStatus {
  path: string
  oldPath?: string
  changeType: string
  stageState: string
  isBinary: boolean
  additions?: number
  deletions?: number
}

export interface GitStatus {
  branch: string | null
  detached: boolean
  ahead: number
  behind: number
  files: GitFileStatus[]
  isMerging: boolean
  isRebasing: boolean
  conflictedCount: number
}

export type GitDiffLineKind = 'context' | 'add' | 'del' | 'noeol'

export interface GitDiffLine {
  kind: GitDiffLineKind
  oldLineNum?: number
  newLineNum?: number
  content: string
}

export interface GitDiffHunk {
  header: string
  lines: GitDiffLine[]
}

export interface GitFileDiff {
  path: string
  oldPath?: string
  isBinary: boolean
  isRename: boolean
  hunks: GitDiffHunk[]
}

export interface GitDiff {
  files: GitFileDiff[]
}

// ─── Event payloads (session.* egress allowlist) ────────────────────────────

export interface SessionChunkPayload {
  sessionId: string
  messageId: string
  delta: string
}

export interface SessionStepPayload {
  sessionId: string
  messageId: string
  step: SessionStep
}

export interface PermissionRequestPayload {
  sessionId: string
  messageId: string
  requestId: string
  toolName: string
  input: Record<string, unknown>
  promptSentence?: string
  displayName?: string
  blockedPath?: string
}

export interface MessageDonePayload {
  sessionId: string
  messageId: string
  text?: string
  stopReason?: string | null
  errorMessage?: string
}

export interface BackgroundStartedPayload {
  sessionId: string
  shellId: string
  command: string
  startedAt?: number
}

export interface BackgroundDonePayload {
  sessionId: string
  shellId: string
  command: string
  status: string
  exitCode?: number | null
  outputTail?: string
}

export interface GatewayEvent {
  type: string
  payload: unknown
}
