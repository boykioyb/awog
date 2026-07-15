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
  // Edit mode (ADR 0060): the current config JSON of the source being refined.
  // When present the system prompt tells the model to update that slug in place
  // instead of creating a new one.
  editConfig: z.string().max(20_000).optional(),
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

function buildSystemPrompt(editContext?: string): string {
  const fs = exampleSource('filesystem')
  const gh = exampleSource('github')
  const dir = `${awogHome()}/sources`
  const editBlock = editContext
    ? `\n\nYOU ARE EDITING AN EXISTING SOURCE. Its current config is below — apply the user's requested
changes and re-Write the UPDATED config.json to the SAME path (keep the same slug + id). Do not
create a new slug. Then update guide.md to match if the change affects usage.

Current config:
\`\`\`json
${editContext}
\`\`\``
    : ''
  return `You are a Source installer working inside AWOG (Pha 1: MCP sources over stdio/http only).

Your job: figure out what MCP server the user wants, then create TWO files in the per-source folder:

  ${dir}/<slug>/config.json   — the machine config (SourceConfig JSON)
  ${dir}/<slug>/guide.md      — short human documentation for the source

The config JSON is a SourceConfig with type:"mcp". It MUST contain:
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

CRITICAL — the stdio "command" MUST be a program that ITSELF speaks the MCP protocol over stdio (an
"MCP server"): an npx package, a python/uv script, or a binary that implements MCP. It is NOT a raw
shell, transport, or remote-access tool. NEVER set "command" (on its own) to: ssh, scp, docker, kubectl,
bash, sh, telnet, nc — these open a shell/pipe, not an MCP server, so the very first JSON-RPC handshake
line is executed as a shell command and the connection fails (e.g. "-bash: jsonrpc:2.0: command not found").

Reaching a REMOTE host (SSH/VPS) or a container is NOT by itself an MCP source. If the user asks for that:
- Only write a config if you can name a REAL MCP server to run. Two valid shapes:
  (a) an MCP server that lives ON the remote, piped over ssh —
      command:"ssh", args:[<ssh opts>, "user@host", "<remote MCP-server launch command>"] — ONLY if the
      user confirms such a server exists on the remote;
  (b) a LOCAL MCP server that bridges SSH (an "ssh MCP server" package), with host/port/user/key via env.
- If you do NOT know a concrete MCP server for the task, DO NOT invent one and DO NOT write a bare
  \`ssh user@host\` config. Ask ONE clarifying question instead (e.g. "Which MCP server should run this —
  is one installed on the VPS, or should I use an SSH-MCP-server package? paste its command/name") and
  write NOTHING until the user answers.
- NEVER guess or fabricate an npm package name for a niche/unknown server. When unsure, ask.

SECRETS — never handle a raw token yourself:
- If the server needs an API key / token / password, DO NOT ask the user to paste it in this chat,
  and NEVER write the literal secret into the config. Instead write a keychain REFERENCE as the
  ENTIRE value: "secret:<KEY>" where <KEY> matches ^[A-Za-z][A-Za-z0-9_.-]*$.
  · stdio → an env entry, e.g. "env": { "GITHUB_TOKEN": "secret:GITHUB_TOKEN" }
  · http  → a header whose whole value is the ref, e.g. "headers": { "Authorization": "secret:AUTH_TOKEN" }
    (and set the mcp "authType" to "bearer"). If the server wants a scheme prefix like "Bearer ", tell
    the user in guide.md to include it when they enter the value.
- After you write the config, AWOG shows the user a secure input to enter each secret value (stored in
  the OS keychain). So your job is only to declare WHICH secrets are needed via "secret:<KEY>" refs.

guide.md content (concise markdown, ~10-25 lines): a one-line summary, what the source is for, the main
tools/capabilities it exposes, setup/auth steps (including which "secret:<KEY>" values the user must
provide and how to obtain them), and one short usage example. Plain markdown only — no front-matter.

Hard rules:
- slug MUST match ^[a-z0-9-]+$ (lowercase, hyphens). Pick a short readable one; id = "\${slug}_<8 hex>".
- The stdio "command" MUST be an actual MCP server (see CRITICAL above) — never a bare ssh/scp/docker/shell.
- Only "stdio" or "http" transport (inside the mcp block). Never "sse".
- Do NOT include an "autoStart" field — it no longer exists.
- The "args" array MUST NOT include a literal "~" path — expand it explicitly
  (a real absolute path like /Users/you/notes, or leave a TODO for the user;
  never bake "~" because shells don't expand inside spawn argv).
- Write files ONLY to ${dir}/<slug>/config.json and ${dir}/<slug>/guide.md. Never any other path.
- Use the Write tool (not Bash). Write config.json as pretty-printed JSON; write config.json FIRST, then guide.md.
- If the user is vague, ask ONE concise clarifying question (which server? what path?). Don't interrogate.
- After both files are written, end with one sentence: "Created <slug> — testing the connection." Nothing else.
- Never call Read on existing config files unless the user asks to inspect them.${editBlock}`
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
      systemPrompt: buildSystemPrompt(params.editConfig),
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
    // The slug the model just wrote (null if it only asked a question). The UI
    // uses it to fetch pending secrets + prompt for their values after the turn.
    slug: writtenSlug,
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
