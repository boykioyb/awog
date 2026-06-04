// LLM-driven Agent creator. Mirror of skills.author: chat-style, LLM picks
// slug + tier + writes a single `<id>.md` (YAML frontmatter + markdown body)
// on disk via the SDK's Write tool. Format is Claude Code SDK subagent
// compatible — files written here also work when opened by Claude Code.
// See ADR 0015.
//
// Events fired (sidecar.event):
//   agents.author.chunk { messageId, delta }     — text delta
//   agents.author.step  { messageId, step }      — tool_use / tool_result
//   agents.author.done  { messageId, text, ... } — terminal

import { homedir } from 'node:os'
import { z } from 'zod'
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { register, RpcError } from '../transport/rpc.js'
import { resolveAccount } from '../sessions/runner.js'
import { ensureFreshAccessToken } from '../credentials/token-manager.js'
import { stepFromToolResult, stepFromToolUse } from '../sessions/step-mapper.js'
import { loadProject } from '../projects/store.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { awogHome } from '../util/path.js'

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
  // Registered project paths the model may also write into (.claude/agents,
  // .agents/agents). UI sends ws.projects.map(p => p.id).
  projectIds: z.array(z.string().min(1).max(64)).max(50).optional(),
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

function buildSystemPrompt(projectPaths: string[]): string {
  const userDirs = [
    `${awogHome()}/agents/<slug>.md  (AWOG-native, default for personal agents)`,
    `${homedir()}/.claude/agents/<slug>.md  (Claude Code SDK subagents — shared)`,
    `${homedir()}/.agents/agents/<slug>.md  (Craft Agents shared)`,
  ]
  const projectLines = projectPaths.map(
    (p) =>
      `${p}/.claude/agents/<slug>.md  or  ${p}/.agents/agents/<slug>.md  (project-scoped)`,
  )
  const allPaths = [...userDirs, ...projectLines].map((l) => `  - ${l}`).join('\n')

  return `You are an Agent designer working inside AWOG. Your job is to create a single AGENT.md file based on what the user describes — format-compatible with Claude Code SDK subagents.

Output format on disk (YAML frontmatter + Markdown body):

---
name: Display Name                # required
description: One-sentence summary shown in the agent picker. Required.
model: claude-sonnet-4-6          # optional. One of: ${ANTHROPIC_MODELS.join(', ')}
role: BA                          # optional, short tag — AWOG extension
mcpServerIds: []                  # optional, AWOG extension — per-agent MCP whitelist (leave [] unless user mentions specific MCP servers)
---

You are a <role>. <Persona instructions in second person, 3-8 sentences>.
Cover: voice/tone, output style, anti-patterns to avoid, edge cases the user
mentioned. Be concrete.

Workflow:
1. Read the user's request. If genuinely vague, ASK ONE concise clarifying question (which role/persona? which task focus?). Do not interrogate.
2. Decide on a slug (kebab-case, lowercase, matching ^[a-z0-9][a-z0-9-]*$).
3. Pick a save location from this list. If the user didn't say, default to ${awogHome()}/agents/<slug>.md and mention briefly that you picked it (one line, no apologies).
4. Use the Write tool to create the file. The frontmatter MUST include name and description; everything else is optional. Body = the system prompt.
5. Finish with a one-sentence confirmation: which slug + which path you created. Nothing else.

Allowed save paths:
${allPaths}

Hard rules:
- Never write outside the paths listed above.
- Never modify or delete an existing agent unless the user explicitly asks.
- Frontmatter MUST include name and description.
- Body MUST be the system prompt itself (plain Markdown), not a description of the system prompt. No JSON wrapper, no code fences around the whole file.
- Default model is claude-sonnet-4-6 unless the user asks otherwise.
- Keep mcpServerIds as an empty array unless the user explicitly mentions MCP servers — those are managed via the editor picker.`
}

async function resolveProjectPaths(projectIds: string[]): Promise<string[]> {
  const paths: string[] = []
  for (const id of projectIds) {
    // eslint-disable-next-line no-await-in-loop
    const project = await loadProject(id)
    if (project) paths.push(project.path)
  }
  return paths
}

register('agents.author', async (raw) => {
  const params = Params.parse(raw)
  const account = await resolveAccount('anthropic', params.accountId)
  const tokens = await ensureFreshAccessToken('anthropic', account.id)

  const modelId = params.modelId ?? 'claude-sonnet-4-6'
  const projectPaths = await resolveProjectPaths(params.projectIds ?? [])
  const systemPrompt = buildSystemPrompt(projectPaths)

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
    systemPrompt,
  }

  log.info('agents.author start', {
    messageId: params.messageId,
    model: modelId,
    historyLen: params.history.length,
    projectCount: projectPaths.length,
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
          emit('agents.author.chunk', { messageId: params.messageId, delta: inner.delta.text })
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
            emit('agents.author.step', {
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
            emit('agents.author.step', {
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
            emit('agents.author.step', {
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
          throw new RpcError(-32021, `agent authoring failed: ${errMessages || evt.subtype}`)
        }
        continue
      }
    }
  } catch (err) {
    if (err instanceof RpcError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    log.warn('agents.author sdk error', { err: msg })
    throw new RpcError(-32021, `agent authoring failed: ${msg}`)
  }

  const result = {
    messageId: params.messageId,
    text: fullText,
    modelUsed: modelUsed || modelId,
    usage: { inputTokens, outputTokens },
    stopReason,
  }
  emit('agents.author.done', result)
  log.info('agents.author done', {
    messageId: params.messageId,
    model: result.modelUsed,
    inputTokens,
    outputTokens,
  })
  return result
})
