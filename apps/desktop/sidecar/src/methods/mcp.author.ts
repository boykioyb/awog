// LLM-driven MCP server creator. Mirrors skills.author conversation pattern:
// chat-style, LLM picks the preset / writes the config.json on disk via the
// Write tool (Pi runtime). UI refreshes via mcp.list on modal close.
//
// Events fired (sidecar.event):
//   mcp.author.chunk { messageId, delta }    — text delta
//   mcp.author.step  { messageId, step }     — tool_use / tool_result
//   mcp.author.done  { messageId, text, ... }— terminal

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { stepFromToolResult, stepFromToolUse } from '../sessions/step-mapper.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { awogHome } from '../util/path.js'
import { buildPreset, PRESET_META } from '../mcp/presets.js'
import { authorPi } from '../runtime/complete.js'

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

  const modelId = params.modelId ?? 'claude-sonnet-4-6'

  log.info('mcp.author start', {
    messageId: params.messageId,
    model: modelId,
    historyLen: params.history.length,
  })

  const transcript = renderTranscript(params.history, params.userText)

  // Author through the Pi runtime. Writes a <slug>.json config via the Write
  // tool, so authorPi drives an agentic loop with the full tool set (bypass
  // permission) and forwards text/step events to the emitters below.
  const res = await authorPi(
    {
      accountId: params.accountId,
      modelId,
      systemPrompt: buildSystemPrompt(),
      prompt: transcript,
    },
    {
      onText: (delta) => emit('mcp.author.chunk', { messageId: params.messageId, delta }),
      onToolUse: (use) =>
        emit('mcp.author.step', {
          messageId: params.messageId,
          step: stepFromToolUse({ id: use.id, name: use.name, input: use.input }),
        }),
      onToolResult: (r) =>
        emit('mcp.author.step', {
          messageId: params.messageId,
          step: stepFromToolResult({
            toolUseId: r.id,
            toolName: r.name,
            toolInput: r.input,
            content: r.content,
            isError: r.isError,
          }),
        }),
    },
  )

  const result = {
    messageId: params.messageId,
    text: res.text,
    modelUsed: res.modelUsed || modelId,
    usage: { inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens },
    stopReason: res.stopReason,
  }
  emit('mcp.author.done', result)
  log.info('mcp.author done', {
    messageId: params.messageId,
    model: result.modelUsed,
    inputTokens: res.usage.inputTokens,
    outputTokens: res.usage.outputTokens,
  })
  return result
})
