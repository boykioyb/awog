// AWOG-local permission + MCP-config types (ADR 0029 §3, Phase C4).
//
// These replace the structural types AWOG previously borrowed from the legacy
// Claude Agent SDK (CanUseTool, PermissionResult, PermissionUpdate,
// Options['mcpServers']). The Pi runtime is now the SOLE LLM runtime, so that
// dependency is gone. We re-declare ONLY the fields AWOG actually
// produces/consumes — derived from the real call-sites:
//   - sessions.send-message.ts (builds CanUseTool + reads CanUseToolOptions)
//   - sessions.permission.ts   (builds PermissionResult)
//   - sessions/permissions.ts  (parks PermissionResult + PermissionUpdate[])
//   - runtime/permission.ts    (consumes PermissionResult.behavior/updatedInput)
//   - runtime/tools/*          (consume the resolved MCP server map)
//
// Keeping these local (not in the broad types/shared.ts) keeps the runtime
// permission/tool contract co-located with the code that owns it (SoC).

import type { ApiSource, SessionQuestion, SessionQuestionReply } from '../types/shared.js'

// ─── MCP server map ─────────────────────────────────────────────────────────
// The already-resolved MCP server config the runtime tools consume. Upstream
// (sessions.send-message.ts / tasks/agent-context.ts) has intersected the
// session∩agent whitelist and expanded `secret:KEY` env/headers before building
// this map, so the runtime treats it as-is. Only stdio + http are bridged.
//
// Replaces every `Options['mcpServers']` reference.
// `timeoutMs` (optional) is the user-configured per-server budget for the
// initialize + tools/list handshake — `npx -y` cold starts can exceed the
// default. Absent → the bridge falls back to its own default.
export type McpServerConfig =
  | {
      type: 'stdio'
      command: string
      args?: string[]
      env?: Record<string, string>
      timeoutMs?: number
    }
  | { type: 'http'; url: string; headers?: Record<string, string>; timeoutMs?: number }

export type McpServersConfig = Record<string, McpServerConfig>

// ─── API sources ─────────────────────────────────────────────────────────────
// The enabled `api` sources handed to the runtime (parallel to McpServersConfig).
// The runtime bridges each to ONE in-process Pi AgentTool `mcp__<id>__api_<slug>`
// (sources/api-tools.ts) that reads its credential fresh from the keychain per
// call. Upstream (sessions.send-message.ts / tasks/agent-context.ts) has already
// applied the SAME whitelist rules as mcpServers. Unlike McpServerConfig this is
// the FULL ApiSource — it carries no secret (the credential lives only in the
// keychain), so there is nothing to strip.
export type ApiSourcesConfig = ApiSource[]

// ─── Per-source Explore-mode scoping (ADR 0060 P4) ────────────────────────────
// A compiled entry from a source's permissions.json `allowedApiEndpoints`
// (method + path regex). Gates NON-GET api-tool calls for that source (GET is
// always allowed — mirrors Craft's isApiEndpointAllowed). The RegExp lives
// IN-PROCESS only: this shape is built in the runtime resolver (sources/gate.ts)
// and threaded straight into the tool filter — it never crosses the RPC boundary.
export interface CompiledApiEndpoint {
  // Upper-cased HTTP method the rule applies to.
  method: string
  // Compiled regex tested against the request path.
  path: RegExp
}

// ─── Permission updates ─────────────────────────────────────────────────────
// A permission-rule suggestion captured at prompt time (CanUseToolOptions
// .suggestions) and handed back as PermissionResult.updatedPermissions when the
// user chooses "always allow". AWOG treats this as an opaque carrier: it parks
// whatever the runtime emits and returns it verbatim — it never inspects the
// fields. A minimal structural type keeps it serialisable across the RPC
// boundary without re-declaring the SDK's full rule taxonomy.
export interface PermissionUpdate {
  type: string
  destination?: string
  [key: string]: unknown
}

// ─── AWOG rule suggestion (ADR 0080) ────────────────────────────────────────
// The concrete PermissionUpdate AWOG now emits for the "Always allow" button. It
// stays structurally a PermissionUpdate (extra fields only) so the existing UI
// keeps working, but it carries the EXACT rule text that will be created —
// `Bash(git status)` rather than a bare `Bash` — so the prompt can show the user
// what they are about to grant instead of asking them to trust a tool name.
//
// `sessionId` rides along because sessions.permission resolves the destination
// tier (session / project / user) at answer time, and the parked request itself
// only knows its requestId.
export interface PermissionRuleSuggestion extends PermissionUpdate {
  type: 'addRule'
  toolName: string
  // Legacy field kept for the current UI. The REAL destination is decided by the
  // `scope` param of sessions.permission; this is only the default.
  destination: 'session'
  // Canonical rule text, e.g. `Bash(git status)` / `Write(/repo/a.ts)` / `RunWorkflow`.
  rule: string
  // What the rule is scoped by — lets the UI phrase the confirmation ("this exact
  // command" vs "this file" vs "this tool").
  ruleKind: 'command' | 'path' | 'bare'
  action: 'allow'
}

// ─── AWOG "nhớ cho phiên này" (cổng SSH + cổng hạ tầng) ─────────────────────
// Hai cổng dưới đây KHÔNG sinh được luật: SSH chạy theo `sshApprovalMode` của
// phiên (ADR 0064 P2) và hạ tầng chạy theo ma trận ở Settings (ADR 0088 §6) —
// ghi một luật ALLOW xuống đĩa cho chúng là dựng nguồn sự thật thứ hai cạnh nơi
// người dùng thật sự chỉnh quyền. Nhưng "không ghi được luật" không có nghĩa là
// phải hỏi lại mọi lời gọi: thứ ba cổng chào chung là một allowance SỐNG TRONG
// BỘ NHỚ, chết cùng phiên (sessions/permissions.ts → allowSessionTool).
//
// `rememberKey` là khoá mờ do chính cổng sinh ra và chỉ cổng đó đọc lại —
// `ssh_exec@host` / `infra:aws_cli:read@<account>`. UI không bao giờ soạn nó
// (đúng luật ADR 0080 mục 5: renderer chọn TẦNG, không soạn nội dung quyền).
// `subject` là chuỗi người dùng ĐỌC trước khi bấm, và phải mô tả đúng cái khoá.
export interface PermissionSessionSuggestion extends PermissionUpdate {
  type: 'allowSession'
  toolName: string
  // Allowance này không có tầng nào khác: nó không bao giờ chạm đĩa.
  destination: 'session'
  rememberKey: string
  // Văn bản hiện trên thẻ duyệt, vd `ssh_exec @ prod-box` / `aws_cli · read @ 123…`.
  subject: string
  // Cổng nào sinh ra — UI chọn câu giải thích theo cái này.
  gate: 'ssh' | 'infra'
  action: 'allow'
  sessionId?: string
}

// ─── Permission result ──────────────────────────────────────────────────────
// The discriminated shape AWOG produces in sessions.permission.ts and consumes
// in runtime/permission.ts. Mirrors the exact fields read/written there:
//   allow → optional updatedInput (approved arg override) + optional
//           updatedPermissions (session allowlist on "always allow").
//   deny  → required message + optional interrupt.
export type PermissionResult =
  | {
      behavior: 'allow'
      updatedInput?: Record<string, unknown>
      updatedPermissions?: PermissionUpdate[]
    }
  | {
      behavior: 'deny'
      message: string
      interrupt?: boolean
    }

// ─── canUseTool gate ────────────────────────────────────────────────────────
// The permission options bag. Fields mirror what sessions.send-message.ts reads
// off `opts` to build the session.permission-request payload + what
// runtime/permission.ts sets when invoking the gate. `signal` + `toolUseID` are
// always supplied by both call-sites; the rest are optional metadata.
export interface CanUseToolOptions {
  signal: AbortSignal
  toolUseID: string
  suggestions?: PermissionUpdate[]
  title?: string
  displayName?: string
  description?: string
  decisionReason?: unknown
  blockedPath?: string
}

// The permission callback assembled in sessions.send-message.ts and invoked by
// runtime/permission.ts's beforeToolCall bridge.
export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: CanUseToolOptions,
) => Promise<PermissionResult>

// ─── AskUserQuestion gate ───────────────────────────────────────────────────
// Assembled in sessions.send-message.ts and invoked by the AskUserQuestion tool
// (runtime/tools/ask-user-question-tool.ts). Parks a promise keyed by the
// tool-call id (= the step id), emits the question to the UI via the
// session.step event, and resolves with the user's answers when the
// sessions.answerQuestion RPC lands. Only the chat runtime wires this; tasks /
// subagents leave it undefined so the tool falls back to a headless no-op.
export type AskUserQuestionFn = (
  toolCallId: string,
  questions: SessionQuestion[],
  signal?: AbortSignal,
) => Promise<SessionQuestionReply>
