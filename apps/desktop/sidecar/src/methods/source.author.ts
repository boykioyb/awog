// LLM-driven Source creator (ADR 0060 P1, D-7). Successor to mcp.author. Chat-
// style: the LLM figures out which MCP server the user wants and writes a
// config.json into the per-source folder ~/.awog/sources/<slug>/config.json via
// the Write tool (Pi runtime). UI refreshes via source.list on modal close.
//
// Events fired (sidecar.event):
//   source.author.chunk { messageId, delta }   — text delta
//   source.author.step  { messageId, step }    — tool_use / tool_result / verify
//   source.author.done  { messageId, text, ... }— terminal
//
// After the model writes a config.json, we auto-verify it: run source.test
// against the written slug and stream a synthetic `verify` step (running → done)
// through the same `source.author.step` channel, so "Created …" carries proof of
// life (tool count or the connection error) without leaving the modal.

import { basename, dirname } from 'node:path'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { stepFromToolResult, stepFromToolUse } from '../sessions/step-mapper.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { awogHome } from '../util/path.js'
import { buildSourcePreset, PRESET_META } from '../sources/presets.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'
import { testAndPersistSource } from '../sources/test.js'
import { authorPi } from '../runtime/complete.js'

// First-run `npx -y <pkg>` also downloads the package before it can speak MCP,
// so the verify handshake gets a generous budget (never below the config's own).
const VERIFY_MIN_TIMEOUT_MS = 60_000

// Derive the source slug from a successful Write's file_path. Only accepts writes
// to a `sources/<slug>/config.json` path with a schema-valid slug — anything else
// is ignored (the model asked a clarifying question, or wrote an unrelated file).
function slugFromWritePath(filePath: unknown): string | null {
  if (typeof filePath !== 'string' || !filePath.includes('sources')) return null
  if (basename(filePath) !== 'config.json') return null
  const slug = basename(dirname(filePath))
  return SOURCE_SLUG_RE.test(slug) ? slug : null
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

// A complete example SourceConfig (with id + slug) so the LLM emits the folder
// shape verbatim rather than the legacy flat MCP config.
function exampleSource(slug: string): string {
  const draft = buildSourcePreset(slug === 'github' ? 'github' : 'filesystem')
  return JSON.stringify({ id: `${slug}_00000000`, slug, ...draft }, null, 2)
}

function buildSystemPrompt(): string {
  const fs = exampleSource('filesystem')
  const gh = exampleSource('github')
  const dir = `${awogHome()}/sources`
  return `You are a Source installer working inside AWOG (Pha 1: MCP sources over stdio/http only).

Your job: figure out what MCP server the user wants, then create a config file at:

  ${dir}/<slug>/config.json

The JSON is a SourceConfig with type:"mcp". It MUST contain:
- "id": "\${slug}_<8 hex>" (stable id; keep the slug prefix)
- "slug": matching the <slug> folder name
- "type": "mcp"
- an "mcp" block holding the transport-specific fields (transport/command/args/env for stdio, transport/url/headers for http)

Two built-in presets — use them when the user matches:

# filesystem
${fs}
Notes: ${PRESET_META.filesystem.envHints.concat(PRESET_META.filesystem.argHints).join(' | ') || 'no extra notes'}

# github
${gh}
Notes: ${PRESET_META.github.envHints.concat(PRESET_META.github.argHints).join(' | ') || 'no extra notes'}

For arbitrary stdio servers (e.g. "@modelcontextprotocol/server-postgres"), build a similar SourceConfig
with: id, slug, name, provider, description, type:"mcp", enabled, timeoutMs: 30000, trust:"prompt",
and an "mcp" block: { "transport": "stdio", "command": "npx", "args": [...], "env": {...} }.

Hard rules:
- slug MUST match ^[a-z0-9-]+$ (lowercase, hyphens). Pick a short readable one; id = "\${slug}_<8 hex>".
- Only "stdio" or "http" transport (inside the mcp block). Never "sse".
- Do NOT include an "autoStart" field — it no longer exists.
- The "args" array MUST NOT include a literal "~" path — expand it explicitly
  (a real absolute path like /Users/you/notes, or leave a TODO for the user;
  never bake "~" because shells don't expand inside spawn argv).
- Write the file ONLY to ${dir}/<slug>/config.json. Never to any other path.
- Use the Write tool (not Bash). Write the file as pretty-printed JSON.
- If the user is vague, ask ONE concise clarifying question (which server? what path?). Don't interrogate.
- After Write succeeds, end with one sentence: "Created <slug> — testing the connection." Nothing else.
- Never call Read on existing config files unless the user asks to inspect them.`
}

// Run source.test against the just-written config and stream a `verify` step the
// UI renders as a pass/fail banner. Never throws — a broken config surfaces as
// ok:false, not an author-RPC failure.
async function verifyWritten(messageId: string, slug: string): Promise<void> {
  const emitStep = (step: Record<string, unknown>): void =>
    emit('source.author.step', {
      messageId,
      step: { id: 'source-verify', kind: 'verify', ...step },
    })

  emitStep({ state: 'running', serverId: slug })
  try {
    const { source, outcome } = await testAndPersistSource(slug, {
      timeoutMs: VERIFY_MIN_TIMEOUT_MS,
    })
    if (!source) {
      emitStep({ state: 'done', ok: false, serverId: slug, error: `Source ${slug} not found` })
      return
    }
    emitStep({
      state: 'done',
      serverId: slug,
      ok: outcome.ok,
      toolCount: outcome.tools?.length ?? 0,
      resourceCount: outcome.resources?.length ?? 0,
      ...(outcome.error ? { error: outcome.error } : {}),
      ...(outcome.stderr?.length ? { stderr: outcome.stderr } : {}),
    })
    log.info('source.author verify', {
      messageId,
      slug,
      ok: outcome.ok,
      tools: outcome.tools?.length,
    })
  } catch (err) {
    emitStep({
      state: 'done',
      ok: false,
      serverId: slug,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

register('source.author', async (raw) => {
  const params = Params.parse(raw)

  const modelId = params.modelId ?? 'claude-sonnet-4-6'

  log.info('source.author start', {
    messageId: params.messageId,
    model: modelId,
    historyLen: params.history.length,
  })

  const transcript = renderTranscript(params.history, params.userText)

  // Slug of the last config the model successfully wrote — drives the post-author
  // verify below. Captured from tool results so a failed Write never triggers it.
  let writtenSlug: string | null = null

  const res = await authorPi(
    {
      accountId: params.accountId,
      modelId,
      systemPrompt: buildSystemPrompt(),
      prompt: transcript,
    },
    {
      onText: (delta) => emit('source.author.chunk', { messageId: params.messageId, delta }),
      onToolUse: (use) =>
        emit('source.author.step', {
          messageId: params.messageId,
          step: stepFromToolUse({ id: use.id, name: use.name, input: use.input }),
        }),
      onToolResult: (r) => {
        if (r.name === 'Write' && !r.isError) {
          const slug = slugFromWritePath(r.input.file_path)
          if (slug) writtenSlug = slug
        }
        emit('source.author.step', {
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
  emit('source.author.done', result)
  log.info('source.author done', {
    messageId: params.messageId,
    model: result.modelUsed,
    inputTokens: res.usage.inputTokens,
    outputTokens: res.usage.outputTokens,
  })
  return result
})
