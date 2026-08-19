// Streaming chat runner. The LLM runtime is Pi (`@earendil-works/pi-ai` +
// pi-agent-core) — see ADR 0029. This module keeps the runtime-agnostic
// machinery (per-session lock + in-flight aborter registry) and delegates the
// actual turn to runtime/run-stream.ts's runStreamPi. The `runStream` /
// `RunNonStreamArgs` / `StreamCallbacks` / `RunStreamResult` surface is
// preserved so sessions.send-message.ts + sessions.compact.ts are unaffected.

import type {
  ContextChars,
  ContextItemSize,
  SessionAttachment,
  SessionCompaction,
  SessionMessage,
  SessionSettings,
  SessionStep,
} from '../types/shared.js'
import type {
  ApiSourcesConfig,
  AskUserQuestionFn,
  CanUseTool,
  CompiledApiEndpoint,
  McpServersConfig,
} from '../runtime/permission-types.js'
import { RpcError } from '../transport/rpc.js'
import { resolveAccount } from '../credentials/credential-resolver.js'
import { forceRefresh } from '../credentials/token-manager.js'
import { log } from '../util/logger.js'

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

// Liveness probe: is this session's turn still in flight? The aborter is registered
// at turn start and removed in send-message's `finally` (after persist + the done
// event + RPC return), so a missing entry means the turn has fully ended. Used by
// the UI stall watchdog to recover a bubble stranded "streaming" when both finalize
// signals (the sendMessage RPC resolve AND the session.message.done event) were lost
// in transit. A present, non-aborted aborter = genuinely still running (incl. a long
// silent tool call or a turn parked on a gate).
export function isTurnActive(sessionId: string, messageId: string): boolean {
  const turn = ACTIVE_ABORTERS.get(messageId)
  return !!turn && turn.sessionId === sessionId
}

// Distinct sessionIds (engine ids) with a turn currently in flight. The tray
// popover is a separate renderer with no live engine events, and a session's
// `streaming` state is live-only in the main window (never persisted — a hydrated
// snapshot never reads back as streaming). This registry is the single source of
// truth for "running right now", so the tray polls it (sessions.activeTurns) to
// list active sessions on open.
export function activeSessionIds(): string[] {
  const ids = new Set<string>()
  for (const turn of ACTIVE_ABORTERS.values()) ids.add(turn.sessionId)
  return [...ids]
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
  // Linked SSH host id (ADR 0064 P2). When set, the Pi runtime pushes the scoped
  // SSH tools (ssh_exec / ssh_read_file / ssh_list_dir / ssh_write_file) targeting
  // this host; the mutating ones are gated via settings.sshApprovalMode.
  aboutSshHostId?: string
  // SSH terminal co-pilot (ADR 0064): the connId of the interactive shell the user
  // is watching. When set (docked session in /ssh), the runtime swaps ssh_exec for
  // ssh_terminal_run (drives THIS visible PTY via sshManager.runInShell).
  sshTerminalConnId?: string
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
  // Enabled `api` sources (ADR 0060 P3), already whitelist-filtered upstream.
  // Bridged to one in-process `mcp__<id>__api_<slug>` Pi tool each (Pi runtime
  // only; the Claude SDK path does not surface api tools in P3).
  apiSources?: ApiSourcesConfig
  // Per-source Explore scoping (ADR 0060 P4), resolved from each active source's
  // permissions.json + trust. Keyed by source id. All optional + no-op when unset:
  //   promptSourceIds   → trust:'prompt' sources' tools route through the ask-gate.
  //   sourceToolPatterns→ auto-scoped allowedMcpPatterns; restricts a source to its
  //                       own matching tools (Pi exposure filter + gate backstop).
  //   sourceApiEndpoints→ compiled allowedApiEndpoints; gates a source's non-GET
  //                       api calls (Pi path).
  promptSourceIds?: string[]
  sourceToolPatterns?: Record<string, RegExp[]>
  sourceApiEndpoints?: Record<string, CompiledApiEndpoint[]>
  // Extra system prompt appended to (not replacing) the agent/base prompt. Used
  // to nudge the model toward MCP tools when the user attached MCP servers, and
  // (Claude-Code-style bulk load) the project memory files / available agents /
  // available skills blocks built in sessions.send-message.
  systemPromptAppend?: string
  // The session's current checklist as a <session_checklist> block (ADR 0069),
  // rebuilt by send-message every turn. Kept OUT of systemPromptAppend because
  // the two runtimes must deliver it differently: Pi rebuilds its system prompt
  // per turn (append is fine), while the Claude SDK freezes the preset append at
  // session creation and ignores it on `resume` — there it has to ride on the
  // turn prompt, like the response style and the plan-mode directive.
  sessionChecklist?: string
  // Char sizes + lists of the bulk-loaded context sections (memory files /
  // custom agents / skills) that send-message already folded into
  // systemPromptAppend. The runtime forwards these into contextChars so the UI
  // usage panel can itemise them; it can't re-derive them from the joined append
  // string alone. Absent when nothing was bulk-loaded.
  contextItems?: {
    memoryFilesChars: number
    customAgentsChars: number
    skillsChars: number
    memoryFilesList: ContextItemSize[]
    customAgentsList: ContextItemSize[]
    skillsList: ContextItemSize[]
  }
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
  // Auto-approve (Settings → Sessions). When true, the permission gate is bypassed
  // entirely — gated tool calls run without a UI prompt. Honours the existing park
  // machinery by simply not invoking it (canUseTool is skipped in makeBeforeToolCall).
  autoApprove?: boolean
  // Re-feed image attachments (Settings → Sessions). When false, prior-turn image
  // attachments are NOT rebuilt into the model context — only the current turn's
  // images are sent. Default (omitted/true) re-feeds every prior image each turn.
  refeedImages?: boolean
  // Mid-turn steering (Session steering). When provided, the runtime wires it to
  // Pi's getSteeringMessages: polled at each turn boundary, it returns the user
  // instructions queued via the sessions.steer RPC so the loop injects them into
  // the running conversation. Each drained item is also surfaced as a
  // `kind:'steer'` step in the timeline. Tasks/subagents leave it undefined.
  getSteeringMessages?: () => Promise<{ id: string; text: string }[]>
  // Per-turn hard caps (Pha 3). Enforced in the runtime beforeToolCall: once a turn
  // makes more than `maxToolCalls` tool calls, or runs longer than `maxWallclockMs`,
  // every further tool call is blocked (runaway-loop guard). Absent = uncapped.
  budget?: {
    maxToolCalls?: number
    maxWallclockMs?: number
  }
  // Current Claude Agent SDK session id for this AWOG session (ADR 0058, Anthropic
  // path only). When set, runStreamClaude resumes the SDK session so the model
  // gets prior history + native compaction from the SDK's own store; absent → a
  // fresh SDK session is started. Ignored by the Pi path.
  sdkSessionId?: string
  // Git `commitCoAuthor` setting (Settings → Git). Controls the AWOG co-author
  // trailer on model-made commits: the Claude SDK path sets the SDK's native
  // `attribution` (overriding the claude_code preset's Claude trailer); the Pi
  // path appends CO_AUTHOR_INSTRUCTION to the system prompt. Omitted → on (default).
  commitCoAuthor?: boolean
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
  // Per-segment char sizes of the turn's assembled prompt, itemised the way
  // Claude Code's `/context` reports it (system prompt / instructions / system
  // tools / MCP tools / custom agents / skills / memory files / history). Lets
  // the usage panel break the window down instead of one opaque "Other". char/4
  // ≈ tokens (UI heuristic). Absent on /compact-only runs.
  contextChars?: ContextChars
  // Human-readable provider error cause, present only when stopReason === 'error'
  // (Pi reports a mid-stream failure as a graceful `error` stop rather than
  // throwing). Lets the UI render a real error alert + retry for the turn.
  errorMessage?: string
  // New compaction checkpoint produced by a `/compact` run (ADR 0047). Absent on
  // normal turns and when there was nothing to summarise; the caller persists it.
  compaction?: SessionCompaction
  // Estimated context-window `history` chars AFTER this compaction ([summary +
  // kept turns]). Present only on a successful `/compact`. Lets the caller refresh
  // the context gauge IMMEDIATELY (before the next turn) so the reduction is
  // visible the instant the checkpoint lands — same estimate the next turn reports.
  compactedHistoryChars?: number
  // New/rotated Claude Agent SDK session id (ADR 0058, Anthropic path only). The
  // caller persists it onto the session so the next turn resumes the SDK session.
  // Absent on the Pi path (which resumes by rebuilding Context from JSONL).
  sdkSessionId?: string
}

// RpcError code mapClaudeErrorToRpc / mapErrorToRpc assign to an auth failure.
const AUTH_EXPIRED_CODE = -32020

// Retry a turn ONCE against a force-refreshed token.
//
// Why this exists: the Claude SDK path hands the OAuth token to its subprocess
// through the env (runtime/claude-sdk/shared.ts buildSdkEnv) and cannot swap it
// afterwards, so a token the provider rejects kills the turn outright. The Pi
// path needs none of this — its getApiKey closure re-resolves per request.
// FROZEN_TOKEN_MIN_LIFETIME_MS already makes plain expiry unlikely; this covers
// what a lifetime floor cannot: a token rejected for some other reason (rotated
// elsewhere, clock skew, a stale process-cached token).
//
// The retry is gated on the turn still being SILENT. Every tool call emits its
// step before it runs and every reply token emits a chunk, so "nothing emitted"
// is a proof that no side effect and no visible output happened yet — a re-run
// therefore cannot duplicate work or replay text. Once anything has reached the
// UI we rethrow and let the user press Retry, which is the honest affordance.
//
// A failed first attempt may leave an orphan SDK session behind; it is never
// referenced (sdkSessionId is persisted only on success) and the next
// delete/truncate of this session sweeps the store anyway.
async function runWithAuthRetry(
  args: RunNonStreamArgs,
  cb: StreamCallbacks,
  run: (a: RunNonStreamArgs, c: StreamCallbacks) => Promise<RunStreamResult>,
): Promise<RunStreamResult> {
  let emitted = false
  const watched: StreamCallbacks = {
    onChunk: (delta) => {
      emitted = true
      cb.onChunk(delta)
    },
    ...(cb.onStep
      ? {
          onStep: (step: SessionStep) => {
            emitted = true
            cb.onStep?.(step)
          },
        }
      : {}),
  }

  try {
    return await run(args, watched)
  } catch (err) {
    if (emitted || !(err instanceof RpcError) || err.code !== AUTH_EXPIRED_CODE) throw err
    try {
      const account = await resolveAccount('anthropic', args.settings.accountId)
      // An api-key account has no token to refresh — the key really is rejected.
      if (account.authMode !== 'oauth') throw err
      await forceRefresh('anthropic', account.id)
    } catch (refreshErr) {
      // The refresh token itself is dead: the original AUTH_EXPIRED is the
      // truthful message, so surface that rather than the refresh failure.
      log.warn('auth retry: forced token refresh failed', {
        sessionId: args.sessionId,
        err: refreshErr instanceof Error ? refreshErr.message : String(refreshErr),
      })
      throw err
    }
    log.info('auth retry: token refreshed, replaying silent turn', { sessionId: args.sessionId })
    // Not wrapped in another try — exactly one retry.
    return run(args, watched)
  }
}


export async function runStream(
  args: RunNonStreamArgs,
  cb: StreamCallbacks,
): Promise<RunStreamResult> {
  // `/compact` is a provider-agnostic summarization (ADR 0047), NOT a chat turn:
  // ALWAYS run it through Pi's runCompact, which re-summarises the transcript prefix
  // and returns a { summary, firstKeptMessageId } checkpoint. This makes /compact
  // work deterministically on EVERY runtime (unlike the SDK's adaptive native
  // compaction which no-ops until near-full). On the Claude SDK path the persisted
  // checkpoint supersedes the SDK session (session.compacted clears sdkSessionId)
  // and the next turn re-seeds a fresh SDK session from [summary + kept turns].
  if (args.slashCommand === 'compact') {
    const { runStreamPi } = await import('../runtime/run-stream.js')
    return withSessionLock(args.sessionId, () => runStreamPi(args, cb))
  }

  // Dual runtime (ADR 0058): the Anthropic provider runs on the Claude Agent SDK
  // (native tools + first-party prompt/loop + SDK session store); every other
  // provider stays on Pi (ADR 0029). Runtime modules are dynamically imported so
  // only the one in use loads its deps. Serialised per session by withSessionLock.
  if (args.settings.provider === 'anthropic') {
    const { runStreamClaude } = await import('../runtime/claude-sdk/run-stream.js')
    return withSessionLock(args.sessionId, () => runWithAuthRetry(args, cb, runStreamClaude))
  }
  const { runStreamPi } = await import('../runtime/run-stream.js')
  return withSessionLock(args.sessionId, () => runStreamPi(args, cb))
}
