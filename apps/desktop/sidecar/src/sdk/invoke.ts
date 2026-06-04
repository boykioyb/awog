// One-shot SDK driver for the Task Execution Engine (ADR 0024 D-6).
//
// This is the task-side counterpart to sessions/runner.ts's runStream. A node
// execution is a single agentic turn with a one-shot prompt (no chat transcript,
// no resume, no interactive permission prompt) that produces an artifact + a
// trace tree. We reuse the shared low-level modules (resolveAccount, token
// refresh, model map) but keep a purpose-built event loop and option builder:
// chat and task execution mean different things (interactive resumable session
// vs unattended bypass-permission run), so a tailored driver is clearer and
// keeps chat behaviour untouched.

import { resolveAccount } from '../sessions/runner.js'
import { ensureFreshAccessToken } from '../credentials/token-manager.js'
import {
  isAnthropicModel,
  normalizeModelId,
  resolveModelRequest,
  SUPPORTS_THINKING,
  type AnthropicModelId,
} from '../providers/anthropic/models-map.js'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import type { SessionSettings, ThinkingLevel } from '../types/shared.js'
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'

const THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  low: 0,
  medium: 4_000,
  high: 8_000,
  'extra-high': 16_000,
  max: 32_000,
}

export interface InvokeArgs {
  // Already-rendered single prompt (no transcript wrapping).
  prompt: string
  settings: SessionSettings
  systemPrompt?: string
  systemPromptAppend?: string
  allowedTools?: string[]
  disabledTools?: string[]
  mcpServers?: Options['mcpServers']
  // Project workspace root → Options.cwd so the SDK's Read/Write/Bash tools act
  // against the user's repo.
  cwd?: string
  abortController?: AbortController
}

export interface InvokeToolUse {
  id: string
  name: string
  input: Record<string, unknown>
  parentId?: string | null
}

export interface InvokeToolResult {
  id: string
  name: string
  input: Record<string, unknown>
  content: unknown
  isError: boolean
  parentId?: string | null
}

export interface InvokeCallbacks {
  // Main-agent assistant text deltas (the artifact body streams here).
  onText?: (delta: string) => void
  onToolUse?: (use: InvokeToolUse) => void
  onToolResult?: (result: InvokeToolResult) => void
  onThinking?: (id: string, delta: string, parentId: string | null) => void
  onAssistantMeta?: (
    model: string,
    usage: { input_tokens: number; output_tokens: number },
    parentId: string | null,
  ) => void
}

export interface InvokeResult {
  text: string
  modelUsed: string
  usage: { input_tokens: number; output_tokens: number }
  stopReason: string | null
}

interface AssistantTextBlock {
  type: 'text'
  text: string
}

function isTextBlock(block: unknown): block is AssistantTextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'text' &&
    typeof (block as { text?: unknown }).text === 'string'
  )
}

// Task errors map to the same RPC codes chat uses so the UI can treat CANCELED /
// AUTH_EXPIRED / rate-limit uniformly.
export function mapSdkErrorToRpc(err: unknown): RpcError {
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

function buildTaskOptions(settings: SessionSettings, accessToken: string, args: InvokeArgs): Options {
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CODE_OAUTH_TOKEN: accessToken,
    CLAUDE_CODE_ENTRYPOINT: 'awog-sidecar-task',
  }
  delete env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN

  const { model, betas } = resolveModelRequest(settings.modelId)

  const opts: Options = {
    model,
    env,
    // Tasks are one-shot — no resume needed, so we don't persist SDK sessions.
    persistSession: false,
    includePartialMessages: true,
    // Tasks run unattended in the background (ADR 0024 D-7): bypass interactive
    // permission prompts. Tool gating is the workflow author's responsibility via
    // the agent's allowedTools.
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
  }

  if (betas && betas.length) opts.betas = betas as NonNullable<Options['betas']>
  if (args.abortController) opts.abortController = args.abortController
  if (args.cwd) opts.cwd = args.cwd
  if (args.disabledTools && args.disabledTools.length) opts.disallowedTools = args.disabledTools
  if (args.mcpServers && Object.keys(args.mcpServers).length > 0) opts.mcpServers = args.mcpServers
  if (args.allowedTools && args.allowedTools.length > 0) opts.allowedTools = args.allowedTools

  if (args.systemPrompt) {
    opts.systemPrompt = args.systemPromptAppend
      ? `${args.systemPrompt}\n\n${args.systemPromptAppend}`
      : args.systemPrompt
  } else if (args.systemPromptAppend) {
    opts.systemPrompt = { type: 'preset', preset: 'claude_code', append: args.systemPromptAppend }
  }

  if (
    settings.level !== 'low' &&
    isAnthropicModel(settings.modelId) &&
    SUPPORTS_THINKING[settings.modelId as AnthropicModelId]
  ) {
    const budget = THINKING_BUDGETS[settings.level]
    if (budget > 0) opts.thinking = { type: 'enabled', budgetTokens: budget }
  }

  return opts
}

// Drive a single agentic turn. Streams text + tool + thinking events via cb,
// returns the aggregate. Throws RpcError on SDK failure / cancellation.
export async function invokeSdk(args: InvokeArgs, cb: InvokeCallbacks): Promise<InvokeResult> {
  const account = await resolveAccount(args.settings.provider, args.settings.accountId)
  // Agents (Claude Code AGENT.md) may set model to a short alias (haiku/sonnet/
  // opus/inherit); map it to a concrete AWOG model id before validating.
  const modelId = normalizeModelId(args.settings.modelId)
  if (!isAnthropicModel(modelId)) {
    throw new RpcError(-32015, `unknown anthropic model: ${args.settings.modelId}`)
  }
  const settings: SessionSettings = { ...args.settings, modelId }
  const tokens = await ensureFreshAccessToken(args.settings.provider, account.id)
  const options = buildTaskOptions(settings, tokens.accessToken, args)

  let fullText = ''
  let modelUsed = ''
  let inputTokens = 0
  let outputTokens = 0
  let stopReason: string | null = null

  const announcedUses = new Map<string, { name: string; input: Record<string, unknown> }>()
  const reportedResults = new Set<string>()

  try {
    const q = query({ prompt: args.prompt, options })
    for await (const evt of q as AsyncIterable<SDKMessage>) {
      if (evt.type === 'stream_event') {
        const inner = evt.event as {
          type?: string
          delta?: { type?: string; text?: string; thinking?: string }
          content_block?: { type?: string; id?: string; name?: string }
        }
        const parentId = (evt as { parent_tool_use_id?: string | null }).parent_tool_use_id ?? null

        if (
          inner.type === 'content_block_delta' &&
          inner.delta?.type === 'text_delta' &&
          typeof inner.delta.text === 'string' &&
          inner.delta.text.length > 0
        ) {
          // Only the main agent's text becomes the node's artifact body.
          if (!parentId) {
            fullText += inner.delta.text
            cb.onText?.(inner.delta.text)
          }
          continue
        }

        if (
          inner.type === 'content_block_delta' &&
          inner.delta?.type === 'thinking_delta' &&
          typeof inner.delta.thinking === 'string' &&
          inner.delta.thinking.length > 0 &&
          typeof inner.content_block?.id === 'string'
        ) {
          cb.onThinking?.(inner.content_block.id, inner.delta.thinking, parentId)
          continue
        }

        if (
          inner.type === 'content_block_start' &&
          inner.content_block?.type === 'tool_use' &&
          typeof inner.content_block.id === 'string' &&
          typeof inner.content_block.name === 'string'
        ) {
          const id = inner.content_block.id
          if (!announcedUses.has(id)) {
            announcedUses.set(id, { name: inner.content_block.name, input: {} })
            cb.onToolUse?.({ id, name: inner.content_block.name, input: {}, parentId })
          }
          continue
        }
        continue
      }

      if (evt.type === 'assistant') {
        const msg = evt.message as {
          model?: string
          usage?: { input_tokens?: number; output_tokens?: number }
          content?: unknown[]
        }
        const parentId = (evt as { parent_tool_use_id?: string | null }).parent_tool_use_id ?? null
        if (!parentId) {
          if (msg.model) modelUsed = msg.model
          if (msg.usage?.input_tokens) inputTokens = msg.usage.input_tokens
          if (msg.usage?.output_tokens) outputTokens = msg.usage.output_tokens
          if (!fullText && Array.isArray(msg.content)) {
            const text = msg.content
              .filter(isTextBlock)
              .map((b) => b.text)
              .join('')
            if (text) fullText = text
          }
        }
        cb.onAssistantMeta?.(
          msg.model ?? '',
          {
            input_tokens: msg.usage?.input_tokens ?? 0,
            output_tokens: msg.usage?.output_tokens ?? 0,
          },
          parentId,
        )
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (typeof block !== 'object' || block === null) continue
            const b = block as Record<string, unknown>
            if (b.type !== 'tool_use') continue
            if (typeof b.id !== 'string' || typeof b.name !== 'string') continue
            const input =
              typeof b.input === 'object' && b.input !== null
                ? (b.input as Record<string, unknown>)
                : {}
            announcedUses.set(b.id, { name: b.name, input })
            cb.onToolUse?.({ id: b.id, name: b.name, input, parentId })
          }
        }
        continue
      }

      if (evt.type === 'user') {
        const msg = evt.message as { content?: unknown }
        const parentId = (evt as { parent_tool_use_id?: string | null }).parent_tool_use_id ?? null
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (typeof block !== 'object' || block === null) continue
            const b = block as Record<string, unknown>
            if (b.type !== 'tool_result') continue
            if (typeof b.tool_use_id !== 'string') continue
            if (reportedResults.has(b.tool_use_id)) continue
            reportedResults.add(b.tool_use_id)
            const meta = announcedUses.get(b.tool_use_id) ?? { name: 'Unknown', input: {} }
            cb.onToolResult?.({
              id: b.tool_use_id,
              name: meta.name,
              input: meta.input,
              content: b.content,
              isError: b.is_error === true,
              parentId,
            })
          }
        }
        continue
      }

      if (evt.type === 'result') {
        if (evt.subtype === 'success') {
          stopReason = evt.stop_reason ?? 'end_turn'
          inputTokens = evt.usage?.input_tokens ?? inputTokens
          outputTokens = evt.usage?.output_tokens ?? outputTokens
          if (typeof evt.result === 'string' && evt.result.length > 0 && !fullText) {
            fullText = evt.result
          }
        } else {
          const errMessages = Array.isArray(evt.errors) ? evt.errors.join('; ') : ''
          throw mapSdkErrorToRpc(new Error(`SDK ${evt.subtype}: ${errMessages || 'unknown'}`))
        }
        continue
      }
    }
  } catch (err) {
    if (err instanceof RpcError) throw err
    throw mapSdkErrorToRpc(err)
  }

  log.info('task sdk turn done', { model: modelUsed, inputTokens, outputTokens, stopReason })
  return {
    text: fullText,
    modelUsed: modelUsed || settings.modelId,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    stopReason,
  }
}
