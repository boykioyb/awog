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
  // Registered project paths the model may also write into (.claude/agents,
  // .agents/agents). UI sends ws.projects.map(p => p.id).
  projectIds: z.array(z.string().min(1).max(64)).max(50).optional(),
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

function buildSystemPrompt(projectPaths: string[]): string {
  const userDirs = [
    `${awogHome()}/agents/<slug>.md  (AWOG-native, default for personal agents)`,
    `${homedir()}/.claude/agents/<slug>.md  (Claude Code SDK subagents — shared)`,
    `${homedir()}/.agents/agents/<slug>.md  (Craft Agents shared)`,
  ]
  const projectLines = projectPaths.map(
    (p) => `${p}/.claude/agents/<slug>.md  or  ${p}/.agents/agents/<slug>.md  (project-scoped)`,
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

  const modelId = params.modelId ?? 'claude-sonnet-4-6'
  const projectPaths = await resolveProjectPaths(params.projectIds ?? [])
  const systemPrompt = buildSystemPrompt(projectPaths)

  log.info('agents.author start', {
    messageId: params.messageId,
    model: modelId,
    historyLen: params.history.length,
    projectCount: projectPaths.length,
  })

  const transcript = renderTranscript(params.history, params.userText)

  // Author through the Pi runtime. Writes an AGENT.md via the Write tool, so
  // authorPi drives an agentic loop with the full tool set (bypass permission)
  // and forwards text/step events to the emitters below.
  const res = await authorPi(
    {
      accountId: params.accountId,
      modelId,
      systemPrompt,
      prompt: transcript,
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
