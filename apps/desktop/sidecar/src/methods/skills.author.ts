// Mini chat session for authoring a skill. Unlike the main chat surface this
// has no persistence (UI owns the history), no project linkage, and a fixed
// system prompt that nudges the model to use Write/Read to materialise a
// SKILL.md folder somewhere under the recognised skill dirs.
//
// Events fired (sidecar.event):
//   skills.author.chunk { messageId, delta }       — text delta
//   skills.author.step  { messageId, step }        — tool_use / tool_result
//   skills.author.done  { messageId, text, ... }   — terminal

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
  // Full conversation so far (excluding the new user turn). UI owns history.
  history: z.array(ChatMessage).default([]),
  userText: z.string().min(1).max(8_000),
  accountId: z.string().min(1).max(120).optional(),
  modelId: ModelSchema.optional(),
  // Registered project paths the model may also write into (.claude/skills,
  // .agents/skills). UI sends ws.projects.map(p => p.id); sidecar resolves.
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

// The transcript is the Anthropic-friendly "User: ... / Assistant: ..." format
// used by runner.renderTranscript — kept inlined here because skills.author has
// no notion of a SessionMessage row.
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

async function buildSystemPrompt(projectPaths: string[]): Promise<string> {
  const userDirs = [
    `${awogHome()}/skills/<slug>/SKILL.md  (AWOG-native, default for personal skills)`,
    `${homedir()}/.claude/skills/<slug>/SKILL.md  (Claude Code SDK shared)`,
    `${homedir()}/.agents/skills/<slug>/SKILL.md  (Craft Agents shared)`,
  ]
  const projectLines = projectPaths.map(
    (p) =>
      `${p}/.claude/skills/<slug>/SKILL.md  or  ${p}/.agents/skills/<slug>/SKILL.md  (project-scoped)`,
  )
  const allPaths = [...userDirs, ...projectLines].map((l) => `  - ${l}`).join('\n')

  return `You are a skill author working inside AWOG. Your job is to create a SKILL.md file based on what the user describes.

Output format on disk (YAML frontmatter + Markdown body, identical to the Claude Code SDK / craft-agents-oss format):

---
name: Display Name
description: One- or two-sentence summary shown in the skill picker.
globs: ["*.ts"]            # optional, file patterns that auto-suggest this skill
alwaysAllow: ["Bash"]      # optional, tool names to pre-approve
icon: "🔧"                 # optional, single emoji
requiredSources: ["github"]# optional, source slugs to auto-enable
---

# Title

Concrete instructions for the agent who will USE this skill. Short headings,
bullet rules, concrete examples — write it so Claude knows exactly what to do
when the skill is active.

Workflow:
1. Read the user's request. If it's vague, ASK ONE concise clarifying question (slug? body focus?). Do not interrogate.
2. Decide on a slug (kebab-case, lowercase, matching ^[a-z0-9][a-z0-9-]*$).
3. Pick a save location from this list. If the user didn't say, default to ${awogHome()}/skills/<slug>/SKILL.md and mention briefly that you picked it (one line, no apologies).
4. Use the Write tool to create the folder + SKILL.md. Do NOT echo the file contents back as a chat message — the Write tool result is enough.
5. Finish with a one-sentence confirmation: which slug + which path you created. Nothing else.

Allowed save paths:
${allPaths}

Hard rules:
- Never write outside the paths listed above.
- Never modify or delete an existing skill unless the user explicitly asks.
- Frontmatter MUST include name and description; everything else is optional.
- The body MUST be plain Markdown — no fences around the whole file, no JSON wrapper.`
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

register('skills.author', async (raw) => {
  const params = Params.parse(raw)
  const account = await resolveAccount('anthropic', params.accountId)
  const tokens = await ensureFreshAccessToken('anthropic', account.id)

  const modelId = params.modelId ?? 'claude-sonnet-4-6'
  const projectPaths = await resolveProjectPaths(params.projectIds ?? [])
  const systemPrompt = await buildSystemPrompt(projectPaths)

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
    // Default tool preset (Read/Write/Edit/Bash/Glob/Grep). We restrict via
    // system prompt instead of fine-grained canUseTool — the user explicitly
    // opened "skill author" so any Write under the listed paths is implicit
    // consent.
  }

  log.info('skills.author start', {
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
          emit('skills.author.chunk', { messageId: params.messageId, delta: inner.delta.text })
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
            emit('skills.author.step', {
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
            emit('skills.author.step', {
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
            emit('skills.author.step', {
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
          throw new RpcError(-32021, `skill authoring failed: ${errMessages || evt.subtype}`)
        }
        continue
      }
    }
  } catch (err) {
    if (err instanceof RpcError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    log.warn('skills.author sdk error', { err: msg })
    throw new RpcError(-32021, `skill authoring failed: ${msg}`)
  }

  const result = {
    messageId: params.messageId,
    text: fullText,
    modelUsed: modelUsed || modelId,
    usage: { inputTokens, outputTokens },
    stopReason,
  }
  emit('skills.author.done', result)
  log.info('skills.author done', {
    messageId: params.messageId,
    model: result.modelUsed,
    inputTokens,
    outputTokens,
  })
  return result
})
