// Claude Agent SDK one-shot task driver (ADR 0058). The Anthropic branch of
// sdk/invoke.ts delegates here — the task-side twin of claude-sdk/run-stream.ts.
// One-shot (no chat history, no resume — each Task node run is fresh), tasks run
// UNATTENDED so permissions are bypassed (ADR 0024 D-7), native SDK tools only
// (no custom AWOG tools — ADR 0058), MCP via options.mcpServers. SDKMessage is
// mapped onto InvokeCallbacks; a non-null parent_tool_use_id nests SDK-native
// subagent (Task) traces under their spawning tool step (same parentId contract
// the Pi invoke adapter uses).

import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { resolveCredential } from '../../credentials/credential-resolver.js'
import { RpcError } from '../../transport/rpc.js'
import { log } from '../../util/logger.js'
import type { InvokeArgs, InvokeCallbacks, InvokeResult } from '../../sdk/invoke.js'
import { buildRulesPrompt, extractTurnPaths } from '../../rules/inject.js'
import { resolveClaudeBinary } from './binary.js'
import {
  buildSdkEnv,
  commitAttribution,
  effortFromLevel,
  mapClaudeErrorToRpc,
  thinkingFromLevel,
  toSdkMcpServers,
  toSdkModel,
} from './shared.js'

interface ContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

function toInputRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

// Translate SDKMessage → InvokeCallbacks + accumulate InvokeResult. parentId is
// derived per message from parent_tool_use_id: null for the main agent, the Task
// call's id for a subagent (so nested trace nodes nest under the Task step).
function createInvokeAdapter(cb: InvokeCallbacks): {
  handle: (msg: SDKMessage) => void
  result: () => InvokeResult
} {
  let text = ''
  let modelUsed = ''
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let stopReason: string | null = null
  const toolInputs = new Map<string, { name: string; input: Record<string, unknown> }>()
  const thinking = new Map<string, string>()
  let assistantSeq = 0

  const handle = (msg: SDKMessage): void => {
    switch (msg.type) {
      case 'system': {
        const m = msg as { subtype?: string; model?: string }
        if (m.subtype === 'init' && typeof m.model === 'string') modelUsed = m.model
        break
      }
      case 'stream_event': {
        const ev = (
          msg as {
            event?: {
              type?: string
              index?: number
              delta?: { type?: string; text?: string; thinking?: string }
            }
          }
        ).event
        if (!ev) break
        if (ev.type === 'message_start') {
          assistantSeq += 1
        } else if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta' && ev.delta.text) {
            text += ev.delta.text
            cb.onText?.(ev.delta.text)
          } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
            const key = `${assistantSeq}-${typeof ev.index === 'number' ? ev.index : 0}`
            thinking.set(key, (thinking.get(key) ?? '') + ev.delta.thinking)
            cb.onThinking?.(`thinking-${key}`, ev.delta.thinking, null)
          }
        }
        break
      }
      case 'assistant': {
        const m = msg as {
          message?: { content?: unknown; usage?: { input_tokens?: number; output_tokens?: number } }
          parent_tool_use_id?: string | null
        }
        const parentId = m.parent_tool_use_id ?? null
        const content = m.message?.content
        if (Array.isArray(content)) {
          for (const raw of content as ContentBlock[]) {
            if (raw.type === 'tool_use' && typeof raw.id === 'string' && typeof raw.name === 'string') {
              const input = toInputRecord(raw.input)
              toolInputs.set(raw.id, { name: raw.name, input })
              cb.onToolUse?.({ id: raw.id, name: raw.name, input, parentId })
            }
          }
        }
        const usage = m.message?.usage
        if (usage) {
          cb.onAssistantMeta?.(
            modelUsed,
            { input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0 },
            parentId,
          )
        }
        break
      }
      case 'user': {
        const m = msg as { message?: { content?: unknown }; parent_tool_use_id?: string | null }
        const parentId = m.parent_tool_use_id ?? null
        const content = m.message?.content
        if (Array.isArray(content)) {
          for (const raw of content as ContentBlock[]) {
            if (raw.type === 'tool_result' && typeof raw.tool_use_id === 'string') {
              const meta = toolInputs.get(raw.tool_use_id) ?? { name: 'tool', input: {} }
              cb.onToolResult?.({
                id: raw.tool_use_id,
                name: meta.name,
                input: meta.input,
                content: raw.content,
                isError: raw.is_error === true,
                parentId,
              })
            }
          }
        }
        break
      }
      case 'result': {
        const m = msg as {
          subtype?: string
          result?: string
          stop_reason?: string | null
          usage?: {
            input_tokens?: number
            output_tokens?: number
            cache_read_input_tokens?: number
            cache_creation_input_tokens?: number
          }
          modelUsage?: Record<string, unknown>
        }
        if (m.usage) {
          inputTokens = m.usage.input_tokens ?? 0
          outputTokens = m.usage.output_tokens ?? 0
          cacheReadTokens = m.usage.cache_read_input_tokens ?? 0
          cacheWriteTokens = m.usage.cache_creation_input_tokens ?? 0
        }
        if (m.subtype === 'success') {
          stopReason = m.stop_reason ?? 'end_turn'
          // Final artifact body: prefer the streamed text; fall back to result.
          if (!text && typeof m.result === 'string') text = m.result
        } else {
          stopReason = 'error'
        }
        if (!modelUsed && m.modelUsage) {
          const first = Object.keys(m.modelUsage)[0]
          if (first) modelUsed = first
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

export async function invokeSdkClaude(args: InvokeArgs, cb: InvokeCallbacks): Promise<InvokeResult> {
  const { account, cred } = await resolveCredential(args.settings.provider, args.settings.accountId)

  // Layer the node agent's AGENT.md + bulk context (already in systemPromptAppend)
  // + workspace rules onto the claude_code preset. No tool-discipline/verify nudge
  // — the SDK's first-party prompt handles that (ADR 0058).
  const rulesPrompt = await buildRulesPrompt(args.projectIds?.[0], extractTurnPaths(args.prompt))
  const appendParts = [args.systemPrompt, args.systemPromptAppend, rulesPrompt].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  )
  const append = appendParts.length > 0 ? appendParts.join('\n\n') : undefined
  const mcpServers = await toSdkMcpServers(args.mcpServers)
  const claudeBinary = resolveClaudeBinary()
  const sdkModel = toSdkModel(args.settings.modelId)

  const options: Options = {
    systemPrompt: { type: 'preset', preset: 'claude_code', ...(append ? { append } : {}) },
    // Honor the task's snapshotted `commitCoAuthor` setting via the SDK flag-settings
    // layer. The claude_code preset otherwise adds Claude's own attribution regardless
    // (see commitAttribution).
    settings: { attribution: commitAttribution(args.commitCoAuthor) },
    includePartialMessages: true,
    thinking: thinkingFromLevel(args.settings.level),
    effort: effortFromLevel(args.settings.level),
    // Tasks run unattended (ADR 0024 D-7): always allow, no permission gate.
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    // Honour the node agent's tool whitelist (Claude Code subagent `tools:` field).
    ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
    ...(args.disabledTools ? { disallowedTools: args.disabledTools } : {}),
    ...(sdkModel ? { model: sdkModel } : {}),
    ...(args.cwd ? { cwd: args.cwd } : {}),
    ...(mcpServers ? { mcpServers } : {}),
    ...(args.abortController ? { abortController: args.abortController } : {}),
    env: buildSdkEnv(cred),
    // Packaged builds: bundled native binary (ADR 0058 P3); dev auto-discovers.
    ...(claudeBinary ? { pathToClaudeCodeExecutable: claudeBinary } : {}),
  }

  log.info('task turn request (claude-sdk)', {
    runtime: 'claude-sdk',
    model: args.settings.modelId,
    account: account.id,
    nativeBinary: !!claudeBinary,
  })

  const adapter = createInvokeAdapter(cb)
  try {
    for await (const msg of query({ prompt: args.prompt, options })) {
      adapter.handle(msg)
    }
  } catch (err) {
    throw mapClaudeErrorToRpc(err)
  }
  if (args.abortController?.signal.aborted) throw new RpcError(-32023, 'CANCELED')

  const result = adapter.result()
  log.info('task turn done (claude-sdk)', {
    runtime: 'claude-sdk',
    model: result.modelUsed,
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
    stopReason: result.stopReason,
  })
  return { ...result, modelUsed: result.modelUsed || args.settings.modelId }
}
