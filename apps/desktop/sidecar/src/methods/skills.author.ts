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
  // Full conversation so far (excluding the new user turn). UI owns history.
  history: z.array(ChatMessage).default([]),
  userText: z.string().min(1).max(8_000),
  accountId: z.string().min(1).max(120).optional(),
  modelId: ModelSchema.optional(),
  // Registered project paths the model may also write into (.claude/skills,
  // .agents/skills). UI sends ws.projects.map(p => p.id); sidecar resolves.
  projectIds: z.array(z.string().min(1).max(64)).max(50).optional(),
})

// The transcript is the Anthropic-friendly "User: ... / Assistant: ..." format
// the runtime context builder consumes — kept inlined here because
// skills.author has no notion of a SessionMessage row.
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

  const modelId = params.modelId ?? 'claude-sonnet-4-6'
  const projectPaths = await resolveProjectPaths(params.projectIds ?? [])
  const systemPrompt = await buildSystemPrompt(projectPaths)

  log.info('skills.author start', {
    messageId: params.messageId,
    model: modelId,
    historyLen: params.history.length,
    projectCount: projectPaths.length,
  })

  const transcript = renderTranscript(params.history, params.userText)

  // Author through the Pi runtime. This flow WRITES a SKILL.md via the Write
  // tool (not pure text), so authorPi drives an agentic loop with the full tool
  // set (bypass permission — the user explicitly opened "skill author") and
  // forwards text/step events to the emitters below.
  const res = await authorPi(
    {
      accountId: params.accountId,
      modelId,
      systemPrompt,
      prompt: transcript,
    },
    {
      onText: (delta) => emit('skills.author.chunk', { messageId: params.messageId, delta }),
      onToolUse: (use) =>
        emit('skills.author.step', {
          messageId: params.messageId,
          step: stepFromToolUse({ id: use.id, name: use.name, input: use.input }),
        }),
      onToolResult: (r) =>
        emit('skills.author.step', {
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
  emit('skills.author.done', result)
  log.info('skills.author done', {
    messageId: params.messageId,
    model: result.modelUsed,
    inputTokens: res.usage.inputTokens,
    outputTokens: res.usage.outputTokens,
  })
  return result
})
