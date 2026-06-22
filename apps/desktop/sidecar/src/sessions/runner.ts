// Streaming chat runner. The LLM runtime is Pi (`@earendil-works/pi-ai` +
// pi-agent-core) — see ADR 0029. This module keeps the runtime-agnostic
// machinery (per-session lock + in-flight aborter registry) and delegates the
// actual turn to runtime/run-stream.ts's runStreamPi. The `runStream` /
// `RunNonStreamArgs` / `StreamCallbacks` / `RunStreamResult` surface is
// preserved so sessions.send-message.ts + sessions.compact.ts are unaffected.

import type {
  SessionAttachment,
  SessionCompaction,
  SessionMessage,
  SessionSettings,
  SessionStep,
} from '../types/shared.js'
import type {
  AskUserQuestionFn,
  CanUseTool,
  McpServersConfig,
} from '../runtime/permission-types.js'

const PER_SESSION_LOCKS = new Map<string, Promise<unknown>>()

// Registry of in-flight chat aborters keyed by messageId, each tagged with its
// sessionId. sessions.cancel looks up here; send-message owns the lifecycle
// (register → defer cleanup). The sessionId lets us abort EVERY in-flight turn
// on a session (abortSession), not just one messageId.
interface ActiveTurn {
  sessionId: string
  controller: AbortController
}
const ACTIVE_ABORTERS = new Map<string, ActiveTurn>()

export function registerAborter(
  sessionId: string,
  messageId: string,
  controller: AbortController,
): void {
  ACTIVE_ABORTERS.set(messageId, { sessionId, controller })
}

export function unregisterAborter(messageId: string): void {
  ACTIVE_ABORTERS.delete(messageId)
}

export function abortMessage(messageId: string): boolean {
  const turn = ACTIVE_ABORTERS.get(messageId)
  if (!turn) return false
  turn.controller.abort()
  return true
}

// Abort EVERY in-flight turn on a session; returns how many were aborted.
// Why session-wide and not just one messageId: a turn can hang (e.g. a stalled
// provider stream that never yields another chunk) and hold the per-session
// lock indefinitely. A later turn then queues behind that lock — its runtime
// loop never starts, so aborting only its messageId is a no-op — while the UI's
// "active" messageId points at the queued turn, orphaning the stuck one. The
// Stop button can then never reach the turn that is actually running. Aborting
// session-wide tears down whatever is in flight so Stop always unblocks the
// session (the hung turn's signal-aware LLM request/tools unwind, releasing the
// lock; the queued turn's already-aborted signal short-circuits its first call).
export function abortSession(sessionId: string): number {
  let aborted = 0
  for (const turn of ACTIVE_ABORTERS.values()) {
    if (turn.sessionId === sessionId) {
      turn.controller.abort()
      aborted += 1
    }
  }
  return aborted
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
  // Attachments on the pending user turn. buildContext bridges images to Pi
  // image content blocks and text-based files (content in `preview`) to text
  // blocks; binary files without content are persisted for UI display only.
  pendingAttachments?: SessionAttachment[]
  history: SessionMessage[]
  settings: SessionSettings
  systemPrompt?: string
  abortController?: AbortController
  // Project workspace root, when the session is linked to a project. Passed
  // straight to the runtime tools' fs root so Read/Write/Bash operate against
  // the user's repo instead of `process.cwd()`.
  cwd?: string
  // Linked project id (when any). Scopes the Task tool's subagent menu to the
  // user tiers + this project's agent tiers (ADR 0030).
  projectId?: string
  // Permission gate. The runtime's beforeToolCall hook bridges this to the UI
  // permission RPC — callers (sessions.send-message) must always supply it for
  // gated modes.
  canUseTool?: CanUseTool
  // Interactive AskUserQuestion handler. Only the chat runtime (sessions) wires
  // this; the tool parks on it and resolves via the sessions.answerQuestion RPC.
  // Tasks/subagents leave it undefined → the tool no-ops gracefully.
  askUserQuestion?: AskUserQuestionFn
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
  // Recent-context budget kept verbatim by `/compact` (ADR 0047). Manual compact
  // passes 0 (keep only the last turn — most aggressive); auto-compact omits it
  // to use Pi's DEFAULT_COMPACTION_SETTINGS.keepRecentTokens (20k).
  keepRecentTokens?: number
  // Active compaction checkpoint (ADR 0047). When present, the runtime feeds the
  // model `summary` + every message from `firstKeptMessageId` onward instead of
  // the full history. On a `/compact` run it is the PRIOR checkpoint (so the cut
  // only advances); on a normal turn it cuts the context the model sees.
  compaction?: SessionCompaction
  // Mid-turn steering (Session steering). When provided, the runtime wires it to
  // Pi's getSteeringMessages: polled at each turn boundary, it returns the user
  // instructions queued via the sessions.steer RPC so the loop injects them into
  // the running conversation. Each drained item is also surfaced as a
  // `kind:'steer'` step in the timeline. Tasks/subagents leave it undefined.
  getSteeringMessages?: () => Promise<{ id: string; text: string }[]>
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
  // cache_* are the Anthropic prompt-cache buckets (history served from cache).
  // The context-window display sums all four — input alone undercounts a cached
  // turn by the entire history.
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_creation_tokens: number
  }
  stopReason: string | null
  // Per-segment char sizes of the turn's assembled prompt (system prompt / tool
  // definitions / replayed history incl. tool I/O + thinking). Lets the usage
  // panel itemise the context window instead of one opaque "Other". char/4 ≈
  // tokens (UI heuristic). Absent on /compact-only runs.
  contextChars?: { system: number; tools: number; history: number }
  // Human-readable provider error cause, present only when stopReason === 'error'
  // (Pi reports a mid-stream failure as a graceful `error` stop rather than
  // throwing). Lets the UI render a real error alert + retry for the turn.
  errorMessage?: string
  // New compaction checkpoint produced by a `/compact` run (ADR 0047). Absent on
  // normal turns and when there was nothing to summarise; the caller persists it.
  compaction?: SessionCompaction
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
