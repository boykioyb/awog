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

import type { ApiSource, SessionQuestion, SessionQuestionAnswer } from '../types/shared.js'

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
) => Promise<SessionQuestionAnswer[]>
