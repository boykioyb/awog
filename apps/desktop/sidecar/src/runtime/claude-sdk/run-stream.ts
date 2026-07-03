// Claude Agent SDK streaming chat runner (ADR 0058 — dual runtime, "full craft").
// sessions/runner.ts's runStream routes here for the ANTHROPIC provider; every
// other provider stays on the Pi path (runtime/run-stream.ts).
//
// Unlike the Pi path this uses the SDK's NATIVE tools + agent loop + system
// prompt — there are NO custom AWOG tools on this path (ADR 0058: the SDK's
// first-party tool discipline is exactly what we want; injecting custom tools
// would dilute it). AWOG only:
//   - resolves the Anthropic credential and hands it to the SDK subprocess via
//     `options.env` (OAuth → CLAUDE_CODE_OAUTH_TOKEN, key → ANTHROPIC_API_KEY);
//     the token is never logged and never emitted to the UI (invariant #1),
//   - layers the agent's AGENT.md + rules + style onto the claude_code preset
//     via `systemPrompt.append`,
//   - lets the SDK own conversation history + compaction via its session store
//     (`resume: sdkSessionId`); the new/rotated session id is returned so the
//     caller persists it (JSONL still records messages for the UI),
//   - adapts the SDKMessage stream back to the same StreamCallbacks/steps the UI
//     already renders (claude-sdk/event-adapter.ts).

import {
  query,
  type Options,
  type HookInput,
  type HookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk'
import { resolveCredential } from '../../credentials/credential-resolver.js'
import { RpcError } from '../../transport/rpc.js'
import { log } from '../../util/logger.js'
import type { RunNonStreamArgs, RunStreamResult, StreamCallbacks } from '../../sessions/runner.js'
import type { ContextChars, SessionCompaction, SessionMessage } from '../../types/shared.js'
import { makeBeforeToolCall, withTurnBudget, type BeforeToolCall } from '../permission.js'
import { buildRulesPrompt, extractTurnPaths } from '../../rules/inject.js'
import { buildStylePrompt } from '../../style/styles.js'
import { createClaudeEventAdapter } from './event-adapter.js'
import { resolveClaudeBinary } from './binary.js'
import {
  buildSdkEnv,
  effortFromLevel,
  mapClaudeErrorToRpc,
  thinkingFromLevel,
  toSdkMcpServers,
  toSdkModel,
} from './shared.js'

// Plan-mode nudge (mirrors the Pi path). The gate blocks all writes/exec in plan
// mode, so tell the model to investigate read-only then present its plan via the
// SDK's native ExitPlanMode tool instead of attempting edits.
const PLAN_MODE_PROMPT = `<plan-mode>
You are in PLAN MODE. Use ONLY read-only tools (Read, Grep, Glob) to investigate — every write or shell command is blocked. When you have a concrete approach, call the \`ExitPlanMode\` tool with your plan as markdown (a short rationale + numbered steps) and stop for the user's approval. Do not attempt edits.
</plan-mode>`

// Permission gate on the Claude SDK path. The SDK's own `canUseTool` callback is
// unreliable (S0: it does not fire for many tools in default mode), so — exactly
// like craft — we run in `bypassPermissions` and enforce AWOG's 4-mode gate via a
// PreToolUse hook, reusing the SAME makeBeforeToolCall + canUseTool park as the Pi
// path so gating behaviour and the UI prompt are identical across runtimes. The
// hook fires for EVERY tool call, so 'ask'/'accept-edits' reliably prompt.
function makePreToolUseHook(
  gate: BeforeToolCall,
): (input: HookInput, toolUseID: string | undefined, options: { signal: AbortSignal }) => Promise<HookJSONOutput> {
  return async (input, _toolUseID, { signal }) => {
    if (input.hook_event_name !== 'PreToolUse') return { continue: true }
    // Rebuild the context makeBeforeToolCall reads (name/id/args). It may mutate
    // `toolInput` in place to apply an approved input override → we forward that.
    const toolInput =
      input.tool_input && typeof input.tool_input === 'object'
        ? { ...(input.tool_input as Record<string, unknown>) }
        : {}
    const ctx = {
      toolCall: { name: input.tool_name, id: input.tool_use_id },
      args: toolInput,
    } as unknown as Parameters<BeforeToolCall>[0]
    const res = await gate(ctx, signal)
    if (res?.block) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: res.reason || 'Denied.',
        },
      }
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: toolInput,
      },
    }
  }
}

// Render prior AWOG history as a one-shot context block for the FIRST Claude turn
// on a session that has no SDK session yet (SDK resume can't see AWOG's JSONL).
// Subsequent turns rely on `resume`. When a compaction checkpoint is active (right
// after /compact), seed from [summary + kept turns] (turns from firstKeptMessageId
// onward) instead of the full transcript, so the fresh SDK session starts with
// reduced context (ADR 0047/0058). Kept compact + text-only.
function renderHistoryPrefix(history: SessionMessage[], compaction?: SessionCompaction): string {
  let msgs = history
  let summaryBlock = ''
  if (compaction) {
    const idx = history.findIndex((m) => m.id === compaction.firstKeptMessageId)
    if (idx >= 0) {
      msgs = history.slice(idx)
      summaryBlock = `<summary_of_earlier_conversation>\n${compaction.summary}\n</summary_of_earlier_conversation>\n\n`
    }
  }
  const lines: string[] = []
  for (const m of msgs) {
    if (m.role === 'system') continue
    const text = (m.text ?? '').trim()
    if (!text) continue
    lines.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${text}`)
  }
  const convo =
    lines.length > 0 ? `<conversation_so_far>\n${lines.join('\n\n')}\n</conversation_so_far>` : ''
  return `${summaryBlock}${convo}`.trim()
}

export async function runStreamClaude(
  args: RunNonStreamArgs,
  cb: StreamCallbacks,
): Promise<RunStreamResult> {
  const { account, cred } = await resolveCredential(args.settings.provider, args.settings.accountId)

  // systemPrompt: layer the agent's own prompt (AGENT.md) + bulk-loaded context
  // (memory/agents/skills, already folded into systemPromptAppend upstream) +
  // workspace rules + response style ONTO the first-party claude_code preset.
  const rulesPrompt = await buildRulesPrompt(args.projectId, extractTurnPaths(args.pendingText))
  const stylePrompt = buildStylePrompt(
    args.settings.responseStyle,
    args.settings.responseStyleNoMarkdown,
  )
  const inPlanMode = args.settings.mode === 'plan'
  const appendParts = [
    args.systemPrompt,
    args.systemPromptAppend,
    rulesPrompt,
    stylePrompt,
    inPlanMode ? PLAN_MODE_PROMPT : undefined,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
  const append = appendParts.length > 0 ? appendParts.join('\n\n') : undefined

  // 4-mode permission gate (ADR 0058 P4): reuse the Pi-path makeBeforeToolCall +
  // per-turn budget, driven from the PreToolUse hook below. The gate parks on
  // args.canUseTool for the tools it decides to prompt for (ask/accept-edits).
  const gate = withTurnBudget(
    makeBeforeToolCall(args.canUseTool, args.settings.mode, args.sessionId, args.autoApprove ?? false),
    args.budget,
    Date.now(),
  )

  const sdkModel = toSdkModel(args.settings.modelId)

  // NOTE: `/compact` never reaches here — runner.ts routes it to Pi's runCompact
  // (provider-agnostic summarization, ADR 0047). Its checkpoint clears sdkSessionId
  // (session.compacted fold), so the next turn lands in the re-seed branch below
  // with args.compaction set → the fresh SDK session starts from [summary + kept].

  // Prompt: on a fresh SDK session (no resume) with prior AWOG history, prepend a
  // one-shot context block so the first turn isn't blind. With an active compaction
  // checkpoint (right after /compact) the block is [summary + kept turns] so the
  // fresh SDK session starts with REDUCED context (ADR 0047/0058).
  let promptText = args.pendingText
  if (!args.sdkSessionId && args.history.length > 0) {
    const prefix = renderHistoryPrefix(args.history, args.compaction)
    promptText = prefix ? `${prefix}\n\n${args.pendingText}` : args.pendingText
  }

  // External MCP servers of the user (SDK-native mechanism, not a custom tool).
  const mcpServers = await toSdkMcpServers(args.mcpServers)
  const claudeBinary = resolveClaudeBinary()

  const options: Options = {
    systemPrompt: { type: 'preset', preset: 'claude_code', ...(append ? { append } : {}) },
    includePartialMessages: true,
    // Thinking: enable adaptive extended thinking (except 'low' = off) + map the
    // level to Claude Code effort depth (shared.ts). effort alone won't emit
    // thinking blocks — `thinking` must be enabled for reasoning to stream.
    thinking: thinkingFromLevel(args.settings.level),
    effort: effortFromLevel(args.settings.level),
    // Gate every tool through our PreToolUse hook; bypassPermissions so the SDK's
    // own (unreliable) permission path doesn't shadow it (ADR 0058 P4).
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    hooks: { PreToolUse: [{ hooks: [makePreToolUseHook(gate)] }] },
    // Honour the agent's tool whitelist (Claude Code subagent `tools:` field).
    ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
    ...(args.disabledTools ? { disallowedTools: args.disabledTools } : {}),
    ...(sdkModel ? { model: sdkModel } : {}),
    ...(args.cwd ? { cwd: args.cwd } : {}),
    ...(args.sdkSessionId ? { resume: args.sdkSessionId } : {}),
    ...(mcpServers ? { mcpServers } : {}),
    ...(args.abortController ? { abortController: args.abortController } : {}),
    env: buildSdkEnv(cred),
    // Packaged builds: point at the bundled native binary (ADR 0058 P3); dev leaves
    // it undefined so the SDK auto-discovers from the pnpm store.
    ...(claudeBinary ? { pathToClaudeCodeExecutable: claudeBinary } : {}),
  }

  log.info('chat stream request (claude-sdk)', {
    runtime: 'claude-sdk',
    sessionId: args.sessionId,
    model: args.settings.modelId,
    account: account.id,
    accountLabel: account.label,
    resume: !!args.sdkSessionId,
    nativeBinary: !!claudeBinary,
    historyTurns: args.history.length,
  })

  const adapter = createClaudeEventAdapter(cb)
  try {
    for await (const msg of query({ prompt: promptText, options })) {
      adapter.handle(msg)
    }
  } catch (err) {
    throw mapClaudeErrorToRpc(err)
  }

  // A mid-stream abort surfaces as CANCELED so send-message routes it through the
  // cancel path (persist the partial reply flagged canceled) — same as the Pi path.
  if (args.abortController?.signal.aborted) {
    throw new RpcError(-32023, 'CANCELED')
  }

  const acc = adapter.result()
  const doneMeta = {
    runtime: 'claude-sdk',
    sessionId: args.sessionId,
    model: acc.modelUsed,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    stopReason: acc.stopReason,
    ...(acc.errorMessage !== undefined ? { errorMessage: acc.errorMessage } : {}),
  }
  if (acc.stopReason === 'error') log.warn('chat stream done (claude-sdk)', doneMeta)
  else log.info('chat stream done (claude-sdk)', doneMeta)

  // Context-window breakdown for the UI usage panel. AWOG can't read inside the
  // SDK's resume store, but the SDK context MIRRORS the AWOG transcript (or, after
  // /compact, [summary + kept turns]) — so estimate `history` from the transcript.
  // Without this the gauge omits history entirely → it never grows with the
  // conversation NOR drops after /compact. (systemTools/mcpTools are SDK-internal
  // → omitted; that's a fixed offset, the growing/shrinking `history` is what
  // matters for the gauge.)
  const items = args.contextItems
  const memoryFilesLen = items?.memoryFilesChars ?? 0
  const customAgentsLen = items?.customAgentsChars ?? 0
  const skillsLen = items?.skillsChars ?? 0
  const systemPromptLen = (args.systemPrompt ?? '').length
  const instructionsLen = Math.max(
    0,
    (append?.length ?? 0) - systemPromptLen - memoryFilesLen - customAgentsLen - skillsLen,
  )
  // Transcript the SDK context holds: kept turns from the compaction cut onward
  // (or the whole transcript when uncompacted) + the summary. Mirrors the Pi path's
  // `JSON.stringify(context.messages)` estimate so /compact visibly shrinks the gauge.
  let keptMsgs = args.history
  let summaryLen = 0
  if (args.compaction) {
    const cutIdx = args.history.findIndex((m) => m.id === args.compaction!.firstKeptMessageId)
    if (cutIdx >= 0) {
      keptMsgs = args.history.slice(cutIdx)
      summaryLen = args.compaction.summary.length
    }
  }
  const historyLen = JSON.stringify(keptMsgs).length + summaryLen + args.pendingText.length
  const contextChars: ContextChars = {
    systemPrompt: systemPromptLen,
    instructions: instructionsLen,
    customAgents: customAgentsLen,
    skills: skillsLen,
    memoryFiles: memoryFilesLen,
    history: historyLen,
    ...(items?.memoryFilesList.length ? { memoryFilesList: items.memoryFilesList } : {}),
    ...(items?.customAgentsList.length ? { customAgentsList: items.customAgentsList } : {}),
    ...(items?.skillsList.length ? { skillsList: items.skillsList } : {}),
  }

  return {
    text: acc.text,
    modelUsed: acc.modelUsed || args.settings.modelId,
    usage: {
      input_tokens: acc.inputTokens,
      output_tokens: acc.outputTokens,
      cache_read_tokens: acc.cacheReadTokens,
      cache_creation_tokens: acc.cacheWriteTokens,
    },
    stopReason: acc.stopReason,
    contextChars,
    // Persisted by the caller so the next turn resumes this SDK session.
    ...(acc.sdkSessionId ? { sdkSessionId: acc.sdkSessionId } : {}),
    ...(acc.errorMessage !== undefined ? { errorMessage: acc.errorMessage } : {}),
  }
}
