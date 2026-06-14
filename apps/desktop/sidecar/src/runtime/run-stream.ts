// Pi-SDK streaming chat runner (ADR 0029). sessions/runner.ts's runStream
// delegates here for every provider (OAuth + apikey + custom endpoint):
//   - streams assistant text via cb.onChunk
//   - emits tool steps (running → done/error) via cb.onStep
//   - honours the 4 permission modes (ask/accept-edits/plan/execute)
//   - resume = rebuild Context from args.history (no opaque session id)
//   - `/compact` = one-shot summarize over the rebuilt history (a graceful
//     fallback ships here).

import { runAgentLoop, generateSummary, type AgentEvent } from '@earendil-works/pi-agent-core'
import type { Message } from '@earendil-works/pi-ai'
import { resolveCredential } from '../credentials/credential-resolver.js'
import { recordCodexUsageFromHeaders } from '../providers/openai/usage.js'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import type { RunNonStreamArgs, RunStreamResult, StreamCallbacks } from '../sessions/runner.js'
import { listAgents } from '../agents/store.js'
import { resolveModel } from './model-resolver.js'
import { buildContext } from './context-builder.js'
import { createRuntimeToolDefinitions, isToolAllowed } from './tools/index.js'
import { TODO_USAGE_PROMPT } from './prompts.js'
import { createTaskTool } from './tools/task-tool.js'
import { makeBeforeToolCall } from './permission.js'
import { toReasoning } from './thinking.js'
import { createEventAdapter } from './event-adapter.js'
import { buildRulesPrompt } from '../rules/inject.js'

// Plan-mode system-prompt nudge. The model is read-only here (permission.ts
// blocks Write/Edit/Bash); it should investigate, then present a concrete plan
// via the ExitPlanMode tool — never attempt edits.
const PLAN_MODE_PROMPT = `<plan-mode>
You are in PLAN MODE. You may ONLY use read-only tools (Read, Grep, Glob) to investigate the task — every write or shell command is blocked.

When you have understood the task and formed a concrete approach, call the \`ExitPlanMode\` tool with your plan as markdown: a short rationale followed by a numbered or bulleted list of the steps you intend to take. Do not write code or describe a final plan in plain text — present it through \`ExitPlanMode\` so the user can approve it. Once you call \`ExitPlanMode\`, stop and wait for approval.
</plan-mode>`

// Map a thrown error to the same RpcError codes the sdk branch uses so the UI
// surfaces identical messages regardless of runtime. Token never logged.
function mapErrorToRpc(err: unknown): RpcError {
  if (err instanceof RpcError) return err
  const name = err instanceof Error ? err.name : ''
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  if (name === 'AbortError' || lower.includes('aborted') || lower.includes('cancelled')) {
    return new RpcError(-32023, 'CANCELED')
  }
  if (lower.includes('unauthor') || lower.includes('401') || lower.includes('authentication')) {
    return new RpcError(-32020, 'AUTH_EXPIRED: re-authenticate via Settings')
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return new RpcError(
      -32022,
      'Rate limited by the provider. Quota exhausted — try a cheaper model or wait a few minutes.',
    )
  }
  return new RpcError(-32021, `chat failed: ${message}`)
}

export async function runStreamPi(
  args: RunNonStreamArgs,
  cb: StreamCallbacks,
): Promise<RunStreamResult> {
  const { account } = await resolveCredential(args.settings.provider, args.settings.accountId)

  // resolveModel validates the model id per provider (built-in catalog lookup)
  // and trusts user-supplied ids for custom endpoints (account.baseURL).
  const { model, getApiKey } = resolveModel(args.settings, account)

  // `/compact` short-circuit (slashCommand). Reimplement via pi-agent-core's
  // generateSummary over the rebuilt history (ADR 0029 amends ADR 0023). The
  // caller persists the returned text; an empty/failed summary returns a clear
  // notice rather than blocking the turn.
  if (args.slashCommand === 'compact') {
    return runCompact(args, model, getApiKey)
  }

  // Resolve the initial token for AgentLoopConfig.apiKey. getApiKey refreshes it
  // per turn; this is just the first value. Never logged.
  const initialKey = await getApiKey(args.settings.provider)

  // Built-in tools + bridged MCP tools (mcp__<serverId>__<tool>) from the
  // already-resolved args.mcpServers (whitelist intersected + secrets expanded
  // upstream). allowedTools/disabledTools filter both kinds uniformly. A failing
  // MCP server is skipped (warn) so it never blocks the turn.
  const inPlanMode = args.settings.mode === 'plan'
  const tools = await createRuntimeToolDefinitions(
    args.cwd ?? process.cwd(),
    args.mcpServers,
    {
      ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
      ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
      // Plan mode: expose ExitPlanMode so the model can present a plan for
      // approval (permission.ts still blocks all writes/exec meanwhile).
      ...(inPlanMode ? { includePlanTool: true } : {}),
    },
    args.abortController?.signal,
    // Wire the interactive AskUserQuestion handler (chat only). The tool parks
    // on it mid-turn and the answer comes back via the answerQuestion RPC.
    args.askUserQuestion,
    // Hook anchor (ADR 0032): fire tool.* / artifact.* around each tool call.
    {
      surface: 'session',
      workspace: args.cwd ?? process.cwd(),
      ...(args.projectId ? { projectId: args.projectId } : {}),
    },
  )

  // Append system-prompt nudges after the agent's own prompt (+ any existing
  // append like the MCP nudge): the TodoWrite usage nudge when the tool is
  // available, then the plan-mode nudge in plan mode. buildContext joins the
  // result onto the system prompt.
  const todoAllowed = isToolAllowed('TodoWrite', {
    ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
    ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
  })
  // Workspace rules (ADR 0033): enabled global + session-project rules, appended
  // to (not replacing) the agent's own prompt.
  const rulesPrompt = await buildRulesPrompt(args.projectId)
  const appendParts = [
    args.systemPromptAppend,
    rulesPrompt,
    todoAllowed ? TODO_USAGE_PROMPT : undefined,
    inPlanMode ? PLAN_MODE_PROMPT : undefined,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
  const systemPromptAppend = appendParts.length > 0 ? appendParts.join('\n\n') : undefined

  const beforeToolCall = makeBeforeToolCall(args.canUseTool, args.settings.mode, args.sessionId)

  // Task subagent tool (ADR 0030). Added at the TOP LEVEL only — never to a
  // subagent's toolset (so depth = 1). Skipped in plan mode (read-only) and when
  // allowedTools/disabledTools exclude 'Task'. Added otherwise even with zero
  // agents, so a stray Task call gets a graceful result instead of the
  // "Tool Task not found" error. Pushed BEFORE buildContext so it lands in
  // context.tools.
  const taskAllowed =
    !inPlanMode &&
    isToolAllowed('Task', {
      ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
      ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
    })
  if (taskAllowed) {
    const projectIds = args.projectId ? [args.projectId] : []
    let agents: Awaited<ReturnType<typeof listAgents>>['agents'] = []
    try {
      agents = (await listAgents(projectIds)).agents
    } catch (err) {
      log.warn('failed to list agents for Task tool', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
    tools.push(
      createTaskTool({
        agents,
        cwd: args.cwd ?? process.cwd(),
        parentSettings: args.settings,
        ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
        // Subagent inherits this turn's resolved MCP servers (session whitelist +
        // secrets already applied) so it can reach the same servers the session can.
        ...(args.mcpServers ? { parentMcpServers: args.mcpServers } : {}),
        // Chat subagents reuse the parent permission gate: in 'ask' mode their
        // writes/exec still prompt the user (depth-1 subagent, same session).
        beforeToolCall,
        makeChildSink: (parentToolCallId) => {
          const child = createEventAdapter(cb, { parentId: parentToolCallId })
          return { emit: child.handle, text: () => child.result().text }
        },
      }),
    )
  }

  const { context, prompt } = buildContext(
    args.history,
    args.pendingText,
    args.systemPrompt,
    systemPromptAppend,
    tools,
    args.pendingAttachments,
  )

  const reasoning = toReasoning(args.settings.level, model)
  const adapter = createEventAdapter(cb)

  log.info('chat stream request (pi)', {
    sessionId: args.sessionId,
    model: args.settings.modelId,
    account: account.id,
    historyTurns: args.history.length,
  })

  const emit = (event: AgentEvent): void => {
    adapter.handle(event)
  }

  try {
    await runAgentLoop(
      [prompt],
      context,
      {
        model,
        // Initial key; getApiKey is the authoritative per-turn refresh.
        ...(initialKey ? { apiKey: initialKey } : {}),
        getApiKey,
        // convertToLlm: our AgentMessages are already pi Messages (no custom
        // message types), so pass through unchanged. Must not throw.
        convertToLlm: (messages) => messages as Message[],
        ...(reasoning ? { reasoning } : {}),
        beforeToolCall,
        // Capture Codex plan-usage from response headers (no-op for non-Codex).
        onResponse: (resp) => recordCodexUsageFromHeaders(account.id, resp.headers),
        // Sequential tool execution keeps step ordering deterministic for the UI
        // and avoids interleaving permission prompts across concurrent tools.
        toolExecution: 'sequential',
      },
      emit,
      args.abortController?.signal,
    )
  } catch (err) {
    throw mapErrorToRpc(err)
  }

  const acc = adapter.result()
  log.info('chat stream done (pi)', {
    sessionId: args.sessionId,
    model: acc.modelUsed,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    stopReason: acc.stopReason,
  })

  // No opaque session id: resume rebuilds Context from JSONL each turn.
  return {
    text: acc.text,
    modelUsed: acc.modelUsed || args.settings.modelId,
    usage: { input_tokens: acc.inputTokens, output_tokens: acc.outputTokens },
    stopReason: acc.stopReason,
  }
}

// `/compact` via generateSummary. Builds a tools-free context from history and
// asks the model to summarise; returns the summary as the turn text so the
// caller can persist it. Failure → a non-fatal notice (parity goal is not to
// block on compaction).
async function runCompact(
  args: RunNonStreamArgs,
  model: ReturnType<typeof resolveModel>['model'],
  getApiKey: ReturnType<typeof resolveModel>['getApiKey'],
): Promise<RunStreamResult> {
  const { context } = buildContext(args.history, args.pendingText, args.systemPrompt, undefined, [])
  const apiKey = await getApiKey(args.settings.provider)
  if (!apiKey) {
    return {
      text: 'Compaction skipped: no credential available.',
      modelUsed: args.settings.modelId,
      usage: { input_tokens: 0, output_tokens: 0 },
      stopReason: 'end_turn',
    }
  }
  try {
    const reserveTokens = Math.floor(model.contextWindow / 4)
    const res = await generateSummary(
      context.messages,
      model,
      reserveTokens,
      apiKey,
      model.headers,
      args.abortController?.signal,
    )
    const summary = res.ok ? res.value : `Compaction failed: ${String(res.error)}`
    return {
      text: summary,
      modelUsed: args.settings.modelId,
      usage: { input_tokens: 0, output_tokens: 0 },
      stopReason: 'end_turn',
    }
  } catch (err) {
    // TODO (ADR 0029 C1): verify generateSummary parity vs SDK /compact (it
    // produces a summary string but does NOT overwrite JSONL here — the caller
    // owns persistence). Graceful fallback keeps the turn from failing.
    log.warn('runtime /compact failed', {
      sessionId: args.sessionId,
      err: err instanceof Error ? err.message : String(err),
    })
    return {
      text: 'Compaction is not available on this runtime yet.',
      modelUsed: args.settings.modelId,
      usage: { input_tokens: 0, output_tokens: 0 },
      stopReason: 'end_turn',
    }
  }
}
