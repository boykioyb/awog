// The slice of the Codex `app-server` protocol AWOG actually speaks (ADR 0087).
//
// SOURCE OF TRUTH is the generated binding, not this file:
//
//     codex app-server generate-ts --out DIR --experimental
//
// That emits ~95 top-level types plus 617 more under `v2`. We hand-copy only
// what the runtime reads or writes, because vendoring 700 generated files into
// the sidecar would make every `codex` bump a repo-wide diff for types nothing
// references. The trade is that a protocol change lands here as a runtime
// surprise rather than a compile error — so every type below names the generated
// type it was copied from, and the fields are transcribed verbatim (including
// the `| null` vs `?` distinction, which the server does enforce).
//
// `--experimental` is REQUIRED to see `ThreadStartParams.dynamicTools`: without
// the flag ts-rs hides the field and it looks like the capability is absent.

// ── Handshake ───────────────────────────────────────────────────────────────

/** InitializeParams.clientInfo */
export interface CodexClientInfo {
  name: string
  title: string
  version: string
}

/**
 * InitializeParams. `experimentalApi` is the gate on `dynamicTools`: without it
 * the server silently ignores the field on thread/start.
 */
export interface CodexInitializeParams {
  clientInfo: CodexClientInfo
  capabilities: { experimentalApi: boolean; requestAttestation: boolean }
}

/** InitializeResponse — `codexHome` echoes back the CODEX_HOME actually in use. */
export interface CodexInitializeResponse {
  userAgent?: string
  codexHome?: string
}

// ── Threads ─────────────────────────────────────────────────────────────────

/** v2/AskForApproval (the non-granular variants; AWOG does not use `granular`). */
export type CodexAskForApproval = 'untrusted' | 'on-request' | 'never'

/** v2/SandboxMode */
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** v2/ReasoningEffort */
export type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'ultra'

/** v2/DynamicToolFunctionSpec — `inputSchema` is a JSON Schema object. */
export interface CodexDynamicToolSpec {
  type: 'function'
  name: string
  description: string
  inputSchema: Record<string, unknown>
  deferLoading?: boolean
}

/** v2/ThreadStartParams — the subset AWOG sets. */
export interface CodexThreadStartParams {
  model?: string
  modelProvider?: string
  cwd?: string
  approvalPolicy?: CodexAskForApproval
  sandbox?: CodexSandboxMode
  /** APPENDED to the built-in harness instructions (unlike `baseInstructions`,
   *  which replaces them — see run-stream.ts for why we never do that). */
  developerInstructions?: string
  dynamicTools?: CodexDynamicToolSpec[]
  runtimeWorkspaceRoots?: string[]
  config?: Record<string, unknown>
}

/** v2/ThreadStartResponse + v2/ThreadResumeResponse (shared subset). */
export interface CodexThreadResponse {
  thread: { id: string }
  model: string
  modelProvider: string
}

/**
 * v2/ThreadResumeParams — the subset AWOG sets.
 *
 * NOTE there is no `dynamicTools` here: the tool set is bound to the thread at
 * start (server-side table `thread_dynamic_tools`) and cannot be changed on
 * resume. run-stream.ts therefore starts a FRESH thread whenever the computed
 * tool set no longer matches the one the thread was started with.
 */
export interface CodexThreadResumeParams {
  threadId: string
  model?: string
  modelProvider?: string
  cwd?: string
  approvalPolicy?: CodexAskForApproval
  sandbox?: CodexSandboxMode
  developerInstructions?: string
  excludeTurns?: boolean
}

// ── Turns ───────────────────────────────────────────────────────────────────

/** v2/UserInput — AWOG sends text and local images only. */
export type CodexUserInput =
  | { type: 'text'; text: string; text_elements: [] }
  | { type: 'localImage'; path: string }

/** v2/TurnStartParams — the subset AWOG sets. */
export interface CodexTurnStartParams {
  threadId: string
  input: CodexUserInput[]
  model?: string
  effort?: CodexReasoningEffort
  approvalPolicy?: CodexAskForApproval
  cwd?: string
}

/** v2/TurnStatus */
export type CodexTurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress'

/** v2/TurnError */
export interface CodexTurnError {
  message: string
  additionalDetails?: string | null
}

/** v2/Turn (subset). */
export interface CodexTurn {
  id: string
  status: CodexTurnStatus
  error?: CodexTurnError | null
}

/** v2/TurnSteerParams */
export interface CodexTurnSteerParams {
  threadId: string
  input: CodexUserInput[]
  expectedTurnId: string
}

// ── Items ───────────────────────────────────────────────────────────────────

/** v2/DynamicToolCallOutputContentItem.
 *
 *  MEASURED TRAP (ADR 0087 F1): the variant is `inputText`, NOT `text`. Return
 *  the wrong shape and the server does not raise — it hands the model the string
 *  "dynamic tool response was invalid" as the tool's result. */
export type CodexToolContentItem =
  | { type: 'inputText'; text: string }
  | { type: 'inputImage'; imageUrl: string }

/** v2/DynamicToolCallResponse */
export interface CodexDynamicToolCallResponse {
  contentItems: CodexToolContentItem[]
  success: boolean
}

/** v2/DynamicToolCallParams (the `item/tool/call` server request). */
export interface CodexDynamicToolCallParams {
  threadId: string
  turnId: string
  callId: string
  namespace: string | null
  tool: string
  arguments: unknown
}

/**
 * v2/ThreadItem — only the variants the event adapter maps. Anything else
 * arrives as `{ type: string }` and is ignored rather than mis-rendered.
 */
export type CodexThreadItem =
  | { type: 'agentMessage'; id: string; text: string; phase?: string | null }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | { type: 'plan'; id: string; text: string }
  | {
      type: 'commandExecution'
      id: string
      command: string
      cwd?: string | null
      status: 'inProgress' | 'completed' | 'failed' | string
      aggregatedOutput?: string | null
      exitCode?: number | null
      durationMs?: number | null
    }
  | {
      type: 'fileChange'
      id: string
      changes: { path: string; kind?: string }[]
      status: string
    }
  | {
      type: 'dynamicToolCall'
      id: string
      tool: string
      namespace: string | null
      arguments: unknown
      status: 'inProgress' | 'completed' | 'failed'
      contentItems?: CodexToolContentItem[] | null
      success?: boolean | null
      durationMs?: number | null
    }
  | {
      type: 'mcpToolCall'
      id: string
      server: string
      tool: string
      status: string
      durationMs?: number | null
    }
  | { type: 'webSearch'; id: string; query?: string | null }
  | { type: string; id: string }

// ── Approvals + user input (server → client requests) ───────────────────────

/** v2/CommandExecutionRequestApprovalParams (subset). */
export interface CodexCommandApprovalParams {
  threadId: string
  turnId: string
  itemId: string
  command?: string | null
  cwd?: string | null
  reason?: string | null
}

/** v2/CommandExecutionApprovalDecision (the non-amendment variants). */
export type CodexCommandApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel'

/** v2/FileChangeRequestApprovalParams (subset). */
export interface CodexFileChangeApprovalParams {
  threadId: string
  turnId: string
  itemId: string
  reason?: string | null
  grantRoot?: string | null
}

/** v2/FileChangeApprovalDecision */
export type CodexFileChangeApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel'

/** v2/ToolRequestUserInputQuestion */
export interface CodexUserInputQuestion {
  id: string
  header: string
  question: string
  isOther: boolean
  isSecret: boolean
  options: { label?: string; description?: string | null }[] | null
}

/** v2/ToolRequestUserInputParams */
export interface CodexUserInputParams {
  threadId: string
  turnId: string
  itemId: string
  questions: CodexUserInputQuestion[]
  isBlocking: boolean
}

/** v2/ToolRequestUserInputResponse */
export interface CodexUserInputResponse {
  answers: Record<string, { answers: string[] }>
}

// ── Notifications ───────────────────────────────────────────────────────────

/** v2/TokenUsageBreakdown */
export interface CodexTokenUsageBreakdown {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

/** v2/ThreadTokenUsage */
export interface CodexThreadTokenUsage {
  total: CodexTokenUsageBreakdown
  last: CodexTokenUsageBreakdown
  modelContextWindow: number | null
}

/** v2/ErrorNotification */
export interface CodexErrorNotification {
  error: CodexTurnError
  willRetry: boolean
  threadId: string
  turnId: string
}

// Notification method names the event adapter reacts to. Everything else on the
// stream is ignored — the server emits ~80 of these and AWOG renders a handful.
export const CODEX_NOTIFICATIONS = {
  turnStarted: 'turn/started',
  turnCompleted: 'turn/completed',
  itemStarted: 'item/started',
  itemCompleted: 'item/completed',
  agentMessageDelta: 'item/agentMessage/delta',
  reasoningTextDelta: 'item/reasoning/textDelta',
  reasoningSummaryDelta: 'item/reasoning/summaryTextDelta',
  commandOutputDelta: 'item/commandExecution/outputDelta',
  tokenUsage: 'thread/tokenUsage/updated',
  error: 'error',
} as const
