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

import { join } from 'node:path'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { stepFromToolResult, stepFromToolUse } from '../sessions/step-mapper.js'
import { loadProject } from '../projects/store.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { awogHome } from '../util/path.js'
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
  // Where to save: 'global' (→ ~/.awog/agents) or a registered projectId
  // (→ {project}/.awog/agents). Chosen via the creator's "Save to" picker.
  scope: z.string().min(1).max(64).default('global'),
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

function buildSystemPrompt(agentsDir: string): string {
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
3. Use the Write tool to create the file at EXACTLY this path (create parent dirs as needed):
     ${agentsDir}/<slug>.md
   Replace <slug> with your chosen slug. Do not write any other file.
4. Finish with a one-sentence confirmation: which slug + which path you created. Nothing else.

Hard rules:
- Write ONLY under the path above. Never write or modify any other file.
- Never modify or delete an existing agent unless the user explicitly asks.
- Frontmatter MUST include name and description.
- Body MUST be the system prompt itself (plain Markdown), not a description of the system prompt. No JSON wrapper, no code fences around the whole file.
- Default model is claude-sonnet-4-6 unless the user asks otherwise.
- Keep mcpServerIds as an empty array unless the user explicitly mentions MCP servers — those are managed via the editor picker.`
}

// Resolve the chosen scope into the single agents dir to write into + the cwd
// that bounds the Write tool (assertInsideWorkspace). Throws on an unknown
// projectId so the UI surfaces a clear error instead of a silent global write.
async function resolveTarget(scope: string): Promise<{ agentsDir: string; cwd: string }> {
  if (scope === 'global') {
    return { agentsDir: join(awogHome(), 'agents'), cwd: awogHome() }
  }
  const project = await loadProject(scope)
  if (!project) throw new Error(`Unknown project: ${scope}`)
  return { agentsDir: join(project.path, '.awog', 'agents'), cwd: project.path }
}

register('agents.author', async (raw) => {
  const params = Params.parse(raw)

  const modelId = params.modelId ?? 'claude-sonnet-4-6'
  const { agentsDir, cwd } = await resolveTarget(params.scope)
  const systemPrompt = buildSystemPrompt(agentsDir)

  log.info('agents.author start', {
    messageId: params.messageId,
    model: modelId,
    historyLen: params.history.length,
    scope: params.scope,
  })

  const transcript = renderTranscript(params.history, params.userText)

  // Author through the Pi runtime. Writes an AGENT.md via the Write tool (cwd
  // bounds it to the chosen scope's dir), forwarding text/step events below.
  const res = await authorPi(
    {
      accountId: params.accountId,
      modelId,
      systemPrompt,
      prompt: transcript,
      cwd,
    },
    {
      onText: (delta) => emit('agents.author.chunk', { messageId: params.messageId, delta }),
      onToolUse: (use) =>
        emit('agents.author.step', {
          messageId: params.messageId,
          step: stepFromToolUse({ id: use.id, name: use.name, input: use.input }),
        }),
      onToolResult: (r) =>
        emit('agents.author.step', {
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
  emit('agents.author.done', result)
  log.info('agents.author done', {
    messageId: params.messageId,
    model: result.modelUsed,
    inputTokens: res.usage.inputTokens,
    outputTokens: res.usage.outputTokens,
  })
  return result
})
