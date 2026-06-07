// Streaming chat runner. The LLM runtime is Pi (`@earendil-works/pi-ai` +
// pi-agent-core) — see ADR 0029. This module keeps the runtime-agnostic
// machinery (per-session lock + in-flight aborter registry) and delegates the
// actual turn to runtime/run-stream.ts's runStreamPi. The `runStream` /
// `RunNonStreamArgs` / `StreamCallbacks` / `RunStreamResult` surface is
// preserved so sessions.send-message.ts + sessions.compact.ts are unaffected.

import type {
  SessionMessage,
  SessionSettings,
  SessionStep,
} from '../types/shared.js'
import type { CanUseTool, McpServersConfig } from '../runtime/permission-types.js'

const PER_SESSION_LOCKS = new Map<string, Promise<unknown>>()

// Registry of in-flight chat aborters keyed by messageId. sessions.cancel
// looks up here; send-message owns the lifecycle (register → defer cleanup).
const ACTIVE_ABORTERS = new Map<string, AbortController>()

export function registerAborter(messageId: string, controller: AbortController): void {
  ACTIVE_ABORTERS.set(messageId, controller)
}

export function unregisterAborter(messageId: string): void {
  ACTIVE_ABORTERS.delete(messageId)
}

export function abortMessage(messageId: string): boolean {
  const controller = ACTIVE_ABORTERS.get(messageId)
  if (!controller) return false
  controller.abort()
  return true
}

async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = PER_SESSION_LOCKS.get(sessionId) ?? Promise.resolve()
  const next = prev.then(fn, fn) as Promise<T>
  PER_SESSION_LOCKS.set(sessionId, next)
  try {
    return await next
  } finally {
    if (PER_SESSION_LOCKS.get(sessionId) === next) PER_SESSION_LOCKS.delete(sessionId)
  }
}

export interface RunNonStreamArgs {
  sessionId: string
  pendingText: string
  history: SessionMessage[]
  settings: SessionSettings
  systemPrompt?: string
  abortController?: AbortController
  // Project workspace root, when the session is linked to a project. Passed
  // straight to the runtime tools' fs root so Read/Write/Bash operate against
  // the user's repo instead of `process.cwd()`.
  cwd?: string
  // Permission gate. The runtime's beforeToolCall hook bridges this to the UI
  // permission RPC — callers (sessions.send-message) must always supply it for
  // gated modes.
  canUseTool?: CanUseTool
  // Per-session tool denylist. Removes these tool names from the runtime tool
  // set so the model never sees them.
  disabledTools?: string[]
  // Enabled MCP servers (already whitelist-intersected + secrets-expanded).
  // Bridged to in-process Pi AgentTools (ADR 0029 §4 / ADR 0014 Q4).
  mcpServers?: McpServersConfig
  // Extra system prompt appended to (not replacing) the agent/base prompt. Used
  // to nudge the model toward MCP tools when the user attached MCP servers.
  systemPromptAppend?: string
  // Claude Code subagent `tools` field from the active agent. When set,
  // restricts the runtime toolset to this whitelist.
  allowedTools?: string[]
  // When set, `pendingText` is a slash command (e.g. '/compact') handled by the
  // runtime instead of a normal turn.
  slashCommand?: 'compact'
}

export interface StreamCallbacks {
  onChunk: (delta: string) => void
  // Fires when a tool_use starts (status: 'running') or a tool_result lands
  // (status: 'done' | 'error'). UI upserts by step.id so the same row updates
  // in place from running → done.
  onStep?: (step: SessionStep) => void
}

export interface RunStreamResult {
  text: string
  modelUsed: string
  usage: { input_tokens: number; output_tokens: number }
  stopReason: string | null
}

export async function runStream(
  args: RunNonStreamArgs,
  cb: StreamCallbacks,
): Promise<RunStreamResult> {
  // Pi is the sole runtime (ADR 0029). Dynamically imported so its deps load
  // only when a turn actually runs. Serialised per session by withSessionLock.
  const { runStreamPi } = await import('../runtime/run-stream.js')
  return withSessionLock(args.sessionId, () => runStreamPi(args, cb))
}
