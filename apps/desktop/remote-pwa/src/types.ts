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
  error?: { message: string }
}

export interface SessionSettings {
  provider: string
  modelId: string
  level: string
  mode: string
  accountId?: string
}

export interface FullSession {
  id: string
  title: string
  projectId: string | null
  updatedAt: string
  settings?: SessionSettings
  messages: EngineMessage[]
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

export interface GatewayEvent {
  type: string
  payload: unknown
}
