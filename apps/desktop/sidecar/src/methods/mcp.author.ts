// LLM-driven MCP server creator. Mirrors skills.author conversation pattern:
// chat-style, LLM picks the preset / writes the config.json on disk via the
// Write tool (Pi runtime). UI refreshes via mcp.list on modal close.
//
// Events fired (sidecar.event):
//   mcp.author.chunk { messageId, delta }    — text delta
//   mcp.author.step  { messageId, step }     — tool_use / tool_result / verify
//   mcp.author.done  { messageId, text, ... }— terminal
//
// After the model Writes a <slug>.json config, we auto-verify it: run an
// ephemeral handshake (mcpManager.test) and stream a synthetic `verify` step
// (running → done) through the same `mcp.author.step` channel. This turns the
// bare "Created …" reply into a live pass/fail with tool count or stderr, so the
// user sees whether the server actually connects without leaving the modal.

import { basename } from 'node:path'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { stepFromToolResult, stepFromToolUse } from '../sessions/step-mapper.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { awogHome } from '../util/path.js'
import { buildPreset, PRESET_META } from '../mcp/presets.js'
import { MCP_ID_RE } from '../mcp/schema.js'
import { loadServer } from '../mcp/store.js'
import { mcpManager } from '../mcp/manager.js'
import { authorPi } from '../runtime/complete.js'

// First-run `npx -y <pkg>` also downloads the package before it can speak MCP,
// so the verify handshake gets a generous budget (never below the config's own).
const VERIFY_MIN_TIMEOUT_MS = 60_000

// Derive the config slug from a successful Write's file_path. Only accepts writes
// under the mcp-servers dir with a schema-valid slug — anything else is ignored
// (the model asked a clarifying question, or wrote an unrelated file).
function slugFromWritePath(filePath: unknown): string | null {
  if (typeof filePath !== 'string' || !filePath.includes('mcp-servers')) return null
  const base = basename(filePath)
  if (!base.endsWith('.json')) return null
  const slug = base.slice(0, -'.json'.length)
  return MCP_ID_RE.test(slug) ? slug : null
}

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

// Run an ephemeral handshake against the just-written config and stream a
// `verify` step (kind: 'verify') the UI renders as a pass/fail banner. Never
// throws — a broken config surfaces as ok:false, not an author-RPC failure.
async function verifyWritten(messageId: string, slug: string): Promise<void> {
  const emitStep = (step: Record<string, unknown>): void =>
    emit('mcp.author.step', { messageId, step: { id: 'mcp-verify', kind: 'verify', ...step } })

  emitStep({ state: 'running', serverId: slug })
  try {
    const config = await loadServer(slug)
    if (!config) {
      emitStep({ state: 'done', ok: false, serverId: slug, error: `Config ${slug}.json not found` })
      return
    }
    const outcome = await mcpManager.test(config, {
      timeoutMs: Math.max(config.timeoutMs, VERIFY_MIN_TIMEOUT_MS),
    })
    emitStep({
      state: 'done',
      serverId: slug,
      ok: outcome.ok,
      toolCount: outcome.tools?.length ?? 0,
      resourceCount: outcome.resources?.length ?? 0,
      ...(outcome.error ? { error: outcome.error } : {}),
      ...(outcome.stderr?.length ? { stderr: outcome.stderr } : {}),
    })
    log.info('mcp.author verify', { messageId, slug, ok: outcome.ok, tools: outcome.tools?.length })
  } catch (err) {
    emitStep({
      state: 'done',
      ok: false,
      serverId: slug,
      error: err instanceof Error ? err.message : String(err),
    })
  }
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

  // Slug of the last config the model successfully Wrote — drives the post-author
  // verify below. Captured from tool results so a failed Write never triggers it.
  let writtenSlug: string | null = null

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
      onToolResult: (r) => {
        if (r.name === 'Write' && !r.isError) {
          const slug = slugFromWritePath(r.input.file_path)
          if (slug) writtenSlug = slug
        }
        emit('mcp.author.step', {
          messageId: params.messageId,
          step: stepFromToolResult({
            toolUseId: r.id,
            toolName: r.name,
            toolInput: r.input,
            content: r.content,
            isError: r.isError,
          }),
        })
      },
    },
  )

  // Auto-verify the written config so "Created …" carries proof of life. Streamed
  // through the step channel (running → done) BEFORE the done event, so the UI
  // folds the terminal verify result into the completed turn.
  if (writtenSlug) await verifyWritten(params.messageId, writtenSlug)

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
