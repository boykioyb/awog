// Pi-SDK one-shot task driver (ADR 0029, Phase C2). The `pi` branch of
// sdk/invoke.ts's dispatcher delegates here. This is the task-side counterpart
// to runtime/run-stream.ts: a single agentic turn for the Task Execution Engine
// (ADR 0024) — one-shot prompt (no chat history), bypass permissions (tasks run
// unattended), full tool set.
//
// Mirrors run-stream.ts's runAgentLoop wiring (model, getApiKey, convertToLlm,
// emit, signal) but targets InvokeCallbacks instead of the chat StreamCallbacks,
// and the permission gate is "always allow" (tasks bypass interactive prompts —
// same as the sdk branch's permissionMode: 'bypassPermissions').

import { runAgentLoop, type AgentEvent, type AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
// pi 0.84: runAgentLoop takes the stream function explicitly (see run-stream.ts).
import { streamSimple } from '@earendil-works/pi-ai/compat'
import { resolveCredential } from '../credentials/credential-resolver.js'
import { normalizeModelId } from '../providers/anthropic/models-map.js'
import { recordCodexUsageFromHeaders } from '../providers/openai/usage.js'
import { confirmOverageOrStop } from './overage-guard.js'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import type { SessionSettings } from '../types/shared.js'
import { listAgents } from '../agents/store.js'
import { resolveModel } from './model-resolver.js'
import { buildContext } from './context-builder.js'
import { createRuntimeToolDefinitions, isToolAllowed } from './tools/index.js'
import { detailsSignalError } from './tools/tool-error.js'
import { buildMcpUnavailableNote } from './tools/mcp-tools.js'
import { createTaskTool } from './tools/task-tool.js'
import {
  COMMUNICATION_PROMPT,
  ENGINEERING_PROMPT,
  EVIDENCE_PROMPT,
  OUTPUT_SURFACE_PROMPT,
  TODO_USAGE_PROMPT,
  TOOL_DISCIPLINE_PROMPT,
  VERIFY_PROMPT,
} from './prompts.js'
import { buildOneShotContextBlock } from '../context/environment.js'
import { CO_AUTHOR_INSTRUCTION } from '../git/co-author.js'
import { toReasoning } from './thinking.js'
import { buildRulesPrompt, extractTurnPaths } from '../rules/inject.js'
import { buildWikiIndex, hasWikiContext } from '../wiki/inject.js'
import { buildMemoryIndex, hasMemoryBodies } from '../memory/inject.js'
import type { InvokeArgs, InvokeCallbacks, InvokeResult } from '../sdk/invoke.js'

// Map a thrown error to RPC codes so the UI treats CANCELED / AUTH_EXPIRED /
// rate-limit uniformly. Token never logged.
function mapErrorToRpc(err: unknown): RpcError {
  if (err instanceof RpcError) return err
  const name = err instanceof Error ? err.name : ''
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  if (name === 'AbortError' || lower.includes('aborted') || lower.includes('cancelled')) {
    return new RpcError(-32023, 'CANCELED')
  }
  // `401` must match as a WHOLE token — a bare substring test also fires on an
  // unrelated 4010/1401 in a request id, byte count or exit line, mislabelling
  // a random failure as an expired login.
  if (lower.includes('unauthor') || /\b401\b/.test(lower) || lower.includes('authentication')) {
    return new RpcError(-32020, 'AUTH_EXPIRED: re-authenticate via Settings')
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return new RpcError(-32022, 'Rate limited by Anthropic. Subscription quota exhausted.')
  }
  return new RpcError(-32021, `task run failed: ${message}`)
}

function isAssistant(m: AgentMessage): m is AssistantMessage {
  return (m as { role?: unknown }).role === 'assistant'
}

function assistantText(m: AssistantMessage): string {
  return m.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('')
}

// Coerce a Pi tool argument bag (any) to the Record<string, unknown> shape the
// InvokeCallbacks consume. Non-object args → empty record.
function toInputRecord(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
}

// Translate Pi AgentEvents → InvokeCallbacks while accumulating the final
// InvokeResult. `parentId` is null for the main agent; for a SUBAGENT run (Task
// tool, ADR 0030) it is the Task call's id so every nested trace node nests
// under the Task step, and the subagent's text is captured (not streamed as the
// node's artifact body).
function createInvokeAdapter(
  cb: InvokeCallbacks,
  parentId: string | null = null,
): {
  handle: (event: AgentEvent) => void
  result: () => InvokeResult
} {
  let text = ''
  let modelUsed = ''
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let stopReason: string | null = null

  // Remember each tool's name + parsed args from its start event so the end
  // event can report the actual arguments (the trace shows real args).
  const toolInputs = new Map<string, { name: string; input: Record<string, unknown> }>()

  const handle = (event: AgentEvent): void => {
    switch (event.type) {
      case 'message_update': {
        const inner = event.assistantMessageEvent
        if (inner.type === 'text_delta' && inner.delta.length > 0) {
          text += inner.delta
          // Subagent text is the Task tool's result, not the node's artifact —
          // accumulate but don't stream it as the node output.
          if (!parentId) cb.onText?.(inner.delta)
        } else if (inner.type === 'thinking_delta' && inner.delta.length > 0) {
          // Pi thinking events carry a contentIndex, not a string id — derive a
          // stable id per thinking block so the trace upserts deltas in place.
          cb.onThinking?.(`thinking-${inner.contentIndex}`, inner.delta, parentId)
        }
        break
      }
      case 'message_start':
      case 'message_end': {
        // Surface per-assistant model + usage so node-runner can capture the
        // resolved model. The authoritative usage comes from agent_end below.
        if (isAssistant(event.message)) {
          const m = event.message
          if (m.model) modelUsed = m.model
          cb.onAssistantMeta?.(
            m.model ?? '',
            { input_tokens: m.usage.input, output_tokens: m.usage.output },
            parentId,
          )
        }
        break
      }
      case 'tool_execution_start': {
        const input = toInputRecord(event.args)
        toolInputs.set(event.toolCallId, { name: event.toolName, input })
        cb.onToolUse?.({ id: event.toolCallId, name: event.toolName, input, parentId })
        break
      }
      case 'tool_execution_end': {
        const meta = toolInputs.get(event.toolCallId) ?? { name: event.toolName, input: {} }
        // event.result is the AgentToolResult { content, details, terminate };
        // surface the content array (node-runner's trace-mapper understands it).
        const asResult =
          event.result && typeof event.result === 'object'
            ? (event.result as { content?: unknown; details?: unknown })
            : undefined
        const content = asResult ? asResult.content : event.result
        cb.onToolResult?.({
          id: event.toolCallId,
          name: meta.name,
          input: meta.input,
          content,
          // Same two failure modes as the chat adapter (event-adapter.ts): the tool
          // threw, or it returned a failure flagged in `details` (tool-error.ts).
          // Tasks were only ever checking the first, so a dead subagent or a
          // rejected MCP call rendered as a healthy trace node.
          isError: event.isError === true || detailsSignalError(asResult?.details),
          parentId,
        })
        break
      }
      case 'agent_end': {
        const last = [...event.messages].reverse().find(isAssistant)
        if (last) {
          const finalText = assistantText(last)
          if (finalText) text = finalText // authoritative final artifact body
          if (last.model) modelUsed = last.model
          inputTokens = last.usage.input
          outputTokens = last.usage.output
          cacheReadTokens = last.usage.cacheRead
          cacheWriteTokens = last.usage.cacheWrite
          stopReason = last.stopReason
        }
        break
      }
      default:
        break
    }
  }

  return {
    handle,
    result: () => ({
      text,
      modelUsed,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_creation_tokens: cacheWriteTokens,
      },
      stopReason,
    }),
  }
}

export async function invokeSdkPi(args: InvokeArgs, cb: InvokeCallbacks): Promise<InvokeResult> {
  // Normalize agent aliases (haiku/sonnet/opus/inherit → concrete id) — a no-op
  // for openai/google ids. resolveModel does the per-provider validation.
  const modelId = normalizeModelId(args.settings.modelId)
  const { account } = await resolveCredential(args.settings.provider, args.settings.accountId)

  const settings: SessionSettings = { ...args.settings, modelId }
  const { model, getApiKey } = resolveModel(settings, account)

  // Initial token for AgentLoopConfig.apiKey; getApiKey is the per-turn refresh.
  // Never logged.
  const initialKey = await getApiKey(settings.provider)

  // Built-in tools + bridged MCP tools (mcp__<serverId>__<tool>) from the
  // already-resolved args.mcpServers (agent.mcpServerIds ∩ enabled + secrets
  // expanded in tasks/agent-context.ts). Filters apply to both kinds. A failing
  // MCP server is skipped (warn) so it never blocks the task node.
  const { tools, failures: mcpFailures, mcpCatalog } = await createRuntimeToolDefinitions(
    args.cwd ?? process.cwd(),
    args.mcpServers,
    // Enabled api sources → one mcp__<id>__api_<slug> tool each (ADR 0060 P3).
    args.apiSources,
    {
      ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
      ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
      // Per-source Explore scoping (ADR 0060 P4): restrict a source to its own
      // allowedMcpPatterns tools + gate its non-GET api calls. No-op when unset.
      ...(args.sourceToolPatterns ? { sourceToolPatterns: args.sourceToolPatterns } : {}),
      ...(args.sourceApiEndpoints ? { sourceApiEndpoints: args.sourceApiEndpoints } : {}),
      // Wiki lookup (ADR 0073). Tasks get it too: a workflow node reasoning about
      // architecture needs the same documentation a chat turn does. Like the rules
      // prompt below, the task's project is projectIds[0].
      ...((await hasWikiContext(args.projectIds?.[0]))
        ? {
            includeWikiTools: {
              ...(args.projectIds?.[0] ? { projectId: args.projectIds[0] } : {}),
            },
          }
        : {}),
      // Read-only memory access for tasks: `autoWrite: false` is not a setting here,
      // it is the contract (see memoryIndex above).
      ...((await hasMemoryBodies(args.projectIds?.[0]))
        ? {
            includeMemoryTools: {
              ...(args.projectIds?.[0] ? { projectId: args.projectIds[0] } : {}),
              autoWrite: false,
              hasBodies: true,
            },
          }
        : {}),
    },
    args.abortController?.signal,
    // Tasks run unattended — no interactive AskUserQuestion handler.
    undefined,
    // Hook anchor (ADR 0032): fire tool.* / artifact.* around each task tool call.
    {
      surface: 'task',
      workspace: args.cwd ?? process.cwd(),
      ...(args.projectIds?.[0] ? { projectId: args.projectIds[0] } : {}),
    },
  )

  // Task subagent tool (ADR 0030), top-level only (depth = 1). Honours the
  // node agent's allowedTools/disabledTools. Tasks bypass permissions, so the
  // subagent gate is always-allow (ADR 0024 D-7). Pushed BEFORE buildContext so
  // it lands in context.tools.
  if (
    isToolAllowed('Task', {
      ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
      ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
    })
  ) {
    let agents: Awaited<ReturnType<typeof listAgents>>['agents'] = []
    try {
      agents = (await listAgents(args.projectIds ?? [])).agents
    } catch (err) {
      log.warn('failed to list agents for Task tool', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
    tools.push(
      createTaskTool({
        agents,
        cwd: args.cwd ?? process.cwd(),
        parentSettings: settings,
        ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
        ...(args.connectionId ? { connectionId: args.connectionId } : {}),
        // Subagent inherits the node's resolved MCP servers (agent whitelist +
        // task connection + secrets already applied) so it never has less reach.
        ...(args.mcpServers ? { parentMcpServers: args.mcpServers } : {}),
        // Same for the node's api sources (ADR 0060 P3).
        ...(args.apiSources ? { parentApiSources: args.apiSources } : {}),
        // Tasks run unattended: subagent tool calls bypass permissions too.
        beforeToolCall: async () => undefined,
        // Inherit the task's co-author setting for subagent-made commits.
        ...(args.commitCoAuthor === false ? { commitCoAuthor: false } : {}),
        makeChildSink: (parentToolCallId) => {
          const child = createInvokeAdapter(cb, parentToolCallId)
          return { emit: child.handle, text: () => child.result().text }
        },
      }),
    )
  }

  // Append the TodoWrite usage nudge when the tool is available so a node's
  // multi-step work surfaces a live checklist (same as chat). buildContext joins
  // it onto the system prompt.
  const todoAllowed = isToolAllowed('TodoWrite', {
    ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
    ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
  })
  // Workspace rules (ADR 0033): enabled global + task-project rules, appended to
  // (not replacing) the node agent's own prompt.
  const rulesPrompt = await buildRulesPrompt(args.projectIds?.[0], extractTurnPaths(args.prompt))
  // Wiki table of contents (ADR 0073): page paths + one-line descriptions, never
  // page content — the node reads a page with wiki_read when it needs one.
  const wikiIndex = (await buildWikiIndex(args.projectIds?.[0])).block
  // Memory index (ADR 0073 part B). A task READS memory but never writes it: an
  // unattended node accumulating facts about the user is precisely what the
  // opt-in write switch exists to prevent, and there is no one watching to correct
  // a bad one. memory_read is still offered when a fact has extra detail.
  const memoryIndex = (await buildMemoryIndex(args.projectIds?.[0])).block
  // Tell the node agent — in-band — about any attached MCP server that failed to
  // load, so it doesn't call its absent tools or fabricate their results.
  const mcpUnavailable = buildMcpUnavailableNote(mcpFailures)
  // Orientation (ADR 0071): OS / shell / cwd / repo + date / branch / dirty tree /
  // recent commits. A task node is a single one-shot request with no cached prefix
  // to protect, so both halves go in the system prompt together (the chat path has
  // to split them — see context/environment.ts).
  const contextBlock = await buildOneShotContextBlock(args.cwd)
  const appendParts = [
    contextBlock,
    args.systemPromptAppend,
    rulesPrompt,
    wikiIndex,
    memoryIndex,
    // Senior-engineer scaffolding (ADR 0071): investigate before changing, match
    // the codebase, cite file:line, verify before reporting done. Under OAuth Pi
    // prepends only the one-sentence identity, so a node agent gets no
    // engineering discipline unless we supply it.
    ENGINEERING_PROMPT,
    EVIDENCE_PROMPT,
    COMMUNICATION_PROMPT,
    // Display surface (ADR 0077): a node's output is read as markdown in the GUI
    // and its paste-ready blocks (PR body, release note) get copied out verbatim,
    // so paragraphs must stay on one line.
    OUTPUT_SURFACE_PROMPT,
    // Act through tools, don't narrate (see prompts.ts). Tasks are tool-driven.
    TOOL_DISCIPLINE_PROMPT,
    // Always-on: verify, never fabricate (see prompts.ts). Unconditional.
    VERIFY_PROMPT,
    // Co-author trailer convention (task's `commitCoAuthor` snapshot). Pi has no
    // built-in commit attribution, so append the AWOG instruction unless disabled.
    args.commitCoAuthor === false ? undefined : CO_AUTHOR_INSTRUCTION,
    mcpUnavailable,
    // MCP catalog (ADR 0051): present only when the MCP toolset is in proxy mode.
    mcpCatalog,
    todoAllowed ? TODO_USAGE_PROMPT : undefined,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
  const systemPromptAppend = appendParts.length > 0 ? appendParts.join('\n\n') : undefined

  // Tasks are one-shot: no chat history, just systemPrompt + the single prompt.
  const { context, prompt } = buildContext([], args.prompt, args.systemPrompt, systemPromptAppend, tools)

  const reasoning = toReasoning(settings.level, model)
  const adapter = createInvokeAdapter(cb)

  log.info('task turn request (pi)', {
    runtime: 'pi',
    model: settings.modelId,
    account: account.id,
    tools: tools.length,
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
        ...(initialKey ? { apiKey: initialKey } : {}),
        getApiKey,
        // Our AgentMessages are already pi Messages — pass through unchanged.
        convertToLlm: (messages) => messages as Message[],
        ...(reasoning ? { reasoning } : {}),
        // Tasks run unattended (ADR 0024 D-7): always allow tool calls. Tool
        // gating is the workflow author's job via the agent's allowedTools (the
        // tool set is already filtered in createRuntimeToolDefinitions above).
        beforeToolCall: async () => undefined,
        // Capture Codex plan-usage from response headers (no-op for non-Codex),
        // then fail closed on Anthropic extra-usage: a headless task cannot prompt,
        // so if a response consumed PAID overage we STOP rather than silently bill.
        onResponse: async (resp) => {
          recordCodexUsageFromHeaders(account.id, resp.headers)
          if (args.settings.provider === 'anthropic') {
            await confirmOverageOrStop(resp.headers, 'task', undefined, args.abortController?.signal, () =>
              args.abortController?.abort(),
            )
          }
        },
        // Parallel at the batch level so several `Task` subagents in one turn run
        // concurrently (ADR 0030). Every non-Task tool is marked sequential
        // (createRuntimeToolDefinitions), so any batch with a regular tool still
        // runs one-by-one — trace step ordering stays deterministic. Only a
        // pure-Task batch fans out.
        toolExecution: 'parallel',
      },
      emit,
      args.abortController?.signal,
      streamSimple,
    )
  } catch (err) {
    throw mapErrorToRpc(err)
  }

  const result = adapter.result()
  log.info('task turn done (pi)', {
    runtime: 'pi',
    model: result.modelUsed,
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
    stopReason: result.stopReason,
  })
  return { ...result, modelUsed: result.modelUsed || settings.modelId }
}
