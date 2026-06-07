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
import { resolveCredential } from '../credentials/credential-resolver.js'
import { normalizeModelId } from '../providers/anthropic/models-map.js'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import type { SessionSettings } from '../types/shared.js'
import { resolveModel } from './model-resolver.js'
import { buildContext } from './context-builder.js'
import { createRuntimeToolDefinitions } from './tools/index.js'
import { toReasoning } from './thinking.js'
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
  if (lower.includes('unauthor') || lower.includes('401') || lower.includes('authentication')) {
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
// InvokeResult. parentId is always null: the pi runtime does not nest subagents
// for tasks yet (no parent_tool_use_id concept), so every event is main-agent.
function createInvokeAdapter(cb: InvokeCallbacks): {
  handle: (event: AgentEvent) => void
  result: () => InvokeResult
} {
  let text = ''
  let modelUsed = ''
  let inputTokens = 0
  let outputTokens = 0
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
          cb.onText?.(inner.delta)
        } else if (inner.type === 'thinking_delta' && inner.delta.length > 0) {
          // Pi thinking events carry a contentIndex, not a string id — derive a
          // stable id per thinking block so the trace upserts deltas in place.
          cb.onThinking?.(`thinking-${inner.contentIndex}`, inner.delta, null)
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
            null,
          )
        }
        break
      }
      case 'tool_execution_start': {
        const input = toInputRecord(event.args)
        toolInputs.set(event.toolCallId, { name: event.toolName, input })
        cb.onToolUse?.({ id: event.toolCallId, name: event.toolName, input, parentId: null })
        break
      }
      case 'tool_execution_end': {
        const meta = toolInputs.get(event.toolCallId) ?? { name: event.toolName, input: {} }
        // event.result is the AgentToolResult { content, details, terminate };
        // surface the content array (node-runner's trace-mapper understands it).
        const content =
          event.result && typeof event.result === 'object'
            ? (event.result as { content?: unknown }).content
            : event.result
        cb.onToolResult?.({
          id: event.toolCallId,
          name: meta.name,
          input: meta.input,
          content,
          isError: event.isError === true,
          parentId: null,
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
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
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
  const tools = await createRuntimeToolDefinitions(
    args.cwd ?? process.cwd(),
    args.mcpServers,
    {
      ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
      ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
    },
    args.abortController?.signal,
  )

  // Tasks are one-shot: no chat history, just systemPrompt + the single prompt.
  const { context, prompt } = buildContext(
    [],
    args.prompt,
    args.systemPrompt,
    args.systemPromptAppend,
    tools,
  )

  const reasoning = toReasoning(settings.level, model)
  const adapter = createInvokeAdapter(cb)

  log.info('task turn request (pi)', {
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
        // Sequential execution keeps trace step ordering deterministic.
        toolExecution: 'sequential',
      },
      emit,
      args.abortController?.signal,
    )
  } catch (err) {
    throw mapErrorToRpc(err)
  }

  const result = adapter.result()
  log.info('task turn done (pi)', {
    model: result.modelUsed,
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
    stopReason: result.stopReason,
  })
  return { ...result, modelUsed: result.modelUsed || settings.modelId }
}
