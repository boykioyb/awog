// LLM-driven MCP server creator. Mirrors skills.author conversation pattern:
// chat-style, LLM picks the preset / writes the config.json on disk via the
// SDK's Write tool. UI refreshes via mcp.list on modal close.
//
// Events fired (sidecar.event):
//   mcp.author.chunk { messageId, delta }    — text delta
//   mcp.author.step  { messageId, step }     — tool_use / tool_result
//   mcp.author.done  { messageId, text, ... }— terminal

import { z } from 'zod'
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { register, RpcError } from '../transport/rpc.js'
import { resolveAccount } from '../sessions/runner.js'
import { ensureFreshAccessToken } from '../credentials/token-manager.js'
import { stepFromToolResult, stepFromToolUse } from '../sessions/step-mapper.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { awogHome } from '../util/path.js'
import { buildPreset, PRESET_META } from '../mcp/presets.js'

const ModelSchema = z.enum(ANTHROPIC_MODELS)

const ChatMessage = z.object({
  role: z.enum(['user', 'agent']),
  text: z.string(),
})

const Params = z.object({
  messageId: z.string().min(1),
  history: z.array(ChatMessage).default([]),
  userText: z.string().min(1).max(8_000),
  accountId: z.string().min(1).max(120).optional(),
  modelId: ModelSchema.optional(),
})

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

function renderTranscript(
  history: { role: 'user' | 'agent'; text: string }[],
  userText: string,
): string {
  const turns: string[] = []
  for (const m of history) {
    const text = m.text.trim()
    if (!text) continue
    turns.push(`${m.role === 'agent' ? 'Assistant' : 'User'}: ${text}`)
  }
  turns.push(`User: ${userText}`)
  return turns.join('\n\n')
}

function buildSystemPrompt(): string {
  // Show id in the example shape so the LLM doesn't omit it (the schema rejects
  // missing id — store.ts has a filename fallback, but cleaner to include it).
  const fs = JSON.stringify({ id: 'filesystem', ...buildPreset('filesystem') }, null, 2)
  const gh = JSON.stringify({ id: 'github', ...buildPreset('github') }, null, 2)
  const dir = `${awogHome()}/mcp-servers`
  return `You are an MCP server installer working inside AWOG (Pha 1 stdio-only).

Your job: figure out what MCP server the user wants, then create a config file at:

  ${dir}/<slug>.json

The file MUST contain an "id" field that matches the <slug> in the filename.

Two built-in presets — use them when the user matches:

# filesystem
${fs}
Notes: ${PRESET_META.filesystem.envHints.concat(PRESET_META.filesystem.argHints).join(' | ') || 'no extra notes'}

# github
${gh}
Notes: ${PRESET_META.github.envHints.concat(PRESET_META.github.argHints).join(' | ') || 'no extra notes'}

For arbitrary stdio servers (e.g. "@modelcontextprotocol/server-postgres"), build a similar JSON
with: id, name, description, transport: "stdio", command: "npx" (or full path),
args: [...], env: {...}, enabled, autoStart, timeoutMs: 30000, trust: "prompt".

Hard rules:
- id MUST match ^[a-z0-9][a-z0-9-]{0,62}$ (lowercase, slug). Pick a short readable one.
- Never set http or sse transport — Pha 1 only supports stdio.
- The "args" array MUST NOT include a literal "~" path — expand it explicitly
  (e.g. use a real absolute path like /Users/you/notes, or leave a TODO with
  a comment for the user; never bake "~" because shells don't expand inside
  spawn argv).
- Write the file ONLY to ${dir}/<slug>.json. Never to any other path.
- Use the Write tool (not Bash). Write the file as pretty-printed JSON.
- If the user is vague, ask ONE concise clarifying question (which server? what path?). Don't interrogate.
- After Write succeeds, end with one sentence: "Created /<slug>.json — toggle Enabled to start." Nothing else.
- Never call Read on existing config files unless the user asks to inspect them.`
}

register('mcp.author', async (raw) => {
  const params = Params.parse(raw)
  const account = await resolveAccount('anthropic', params.accountId)
  const tokens = await ensureFreshAccessToken('anthropic', account.id)

  const modelId = params.modelId ?? 'claude-sonnet-4-6'

  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CODE_OAUTH_TOKEN: tokens.accessToken,
    CLAUDE_CODE_ENTRYPOINT: 'awog-sidecar',
  }
  delete env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN

  const options: Options = {
    model: modelId,
    env,
    persistSession: false,
    permissionMode: 'bypassPermissions',
    includePartialMessages: true,
    systemPrompt: buildSystemPrompt(),
  }

  log.info('mcp.author start', {
    messageId: params.messageId,
    model: modelId,
    historyLen: params.history.length,
  })

  const transcript = renderTranscript(params.history, params.userText)
  let fullText = ''
  let modelUsed = ''
  let inputTokens = 0
  let outputTokens = 0
  let stopReason: string | null = null
  const announcedUses = new Map<string, { name: string; input: Record<string, unknown> }>()
  const reportedResults = new Set<string>()

  try {
    const q = query({ prompt: transcript, options })
    for await (const evt of q as AsyncIterable<SDKMessage>) {
      if (evt.type === 'stream_event') {
        const inner = evt.event as {
          type?: string
          delta?: { type?: string; text?: string }
          content_block?: { type?: string; id?: string; name?: string; input?: unknown }
        }
        if (
          inner.type === 'content_block_delta' &&
          inner.delta?.type === 'text_delta' &&
          typeof inner.delta.text === 'string' &&
          inner.delta.text.length > 0
        ) {
          fullText += inner.delta.text
          emit('mcp.author.chunk', { messageId: params.messageId, delta: inner.delta.text })
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
            const name = inner.content_block.name
            announcedUses.set(id, { name, input: {} })
            emit('mcp.author.step', {
              messageId: params.messageId,
              step: stepFromToolUse({ id, name, input: {} }),
            })
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
            emit('mcp.author.step', {
              messageId: params.messageId,
              step: stepFromToolUse({ id: b.id, name: b.name, input }),
            })
          }
        }
        continue
      }
      if (evt.type === 'user') {
        const msg = evt.message as { content?: unknown }
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (typeof block !== 'object' || block === null) continue
            const b = block as Record<string, unknown>
            if (b.type !== 'tool_result') continue
            if (typeof b.tool_use_id !== 'string') continue
            if (reportedResults.has(b.tool_use_id)) continue
            reportedResults.add(b.tool_use_id)
            const meta = announcedUses.get(b.tool_use_id) ?? { name: 'Unknown', input: {} }
            emit('mcp.author.step', {
              messageId: params.messageId,
              step: stepFromToolResult({
                toolUseId: b.tool_use_id,
                toolName: meta.name,
                toolInput: meta.input,
                content: b.content,
                isError: b.is_error === true,
              }),
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
          throw new RpcError(-32021, `mcp authoring failed: ${errMessages || evt.subtype}`)
        }
        continue
      }
    }
  } catch (err) {
    if (err instanceof RpcError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    log.warn('mcp.author sdk error', { err: msg })
    throw new RpcError(-32021, `mcp authoring failed: ${msg}`)
  }

  const result = {
    messageId: params.messageId,
    text: fullText,
    modelUsed: modelUsed || modelId,
    usage: { inputTokens, outputTokens },
    stopReason,
  }
  emit('mcp.author.done', result)
  log.info('mcp.author done', {
    messageId: params.messageId,
    model: result.modelUsed,
    inputTokens,
    outputTokens,
  })
  return result
})
