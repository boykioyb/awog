// Mini chat session for authoring a skill. Unlike the main chat surface this
// has no persistence (UI owns the history), no project linkage, and a fixed
// system prompt that nudges the model to use Write/Read to materialise a
// SKILL.md folder somewhere under the recognised skill dirs.
//
// Events fired (sidecar.event):
//   skills.author.chunk { messageId, delta }       — text delta
//   skills.author.step  { messageId, step }        — tool_use / tool_result
//   skills.author.done  { messageId, text, ... }   — terminal

import { join } from 'node:path'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { stepFromToolResult, stepFromToolUse } from '../sessions/step-mapper.js'
import { loadProject } from '../projects/store.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { claudeHome, projectClaudeDir } from '../util/path.js'
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
  // Where to save: 'global' (→ ~/.claude/skills) or a registered projectId
  // (→ {project}/.claude/skills). Chosen via the creator's "Save to" picker.
  scope: z.string().min(1).max(64).default('global'),
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

function buildSystemPrompt(skillsDir: string): string {
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
3. Use the Write tool to create the folder + SKILL.md at EXACTLY this path (create parent dirs as needed):
     ${skillsDir}/<slug>/SKILL.md
   Replace <slug> with your chosen slug. Do not write any other file. Do NOT echo the file contents back as a chat message — the Write tool result is enough.
4. Finish with a one-sentence confirmation: which slug + which path you created. Nothing else.

Hard rules:
- Write ONLY under the path above. Never write or modify any other file.
- Never modify or delete an existing skill unless the user explicitly asks.
- Frontmatter MUST include name and description; everything else is optional.
- The body MUST be plain Markdown — no fences around the whole file, no JSON wrapper.`
}

// Resolve the chosen scope into the single skills dir to write into + the cwd
// that bounds the Write tool (assertInsideWorkspace). Throws on an unknown
// projectId so the UI surfaces a clear error instead of a silent global write.
async function resolveTarget(scope: string): Promise<{ skillsDir: string; cwd: string }> {
  if (scope === 'global') {
    return { skillsDir: join(claudeHome(), 'skills'), cwd: claudeHome() }
  }
  const project = await loadProject(scope)
  if (!project) throw new Error(`Unknown project: ${scope}`)
  return { skillsDir: join(projectClaudeDir(project.path), 'skills'), cwd: project.path }
}

register('skills.author', async (raw) => {
  const params = Params.parse(raw)

  const modelId = params.modelId ?? 'claude-sonnet-5'
  const { skillsDir, cwd } = await resolveTarget(params.scope)
  const systemPrompt = buildSystemPrompt(skillsDir)

  log.info('skills.author start', {
    messageId: params.messageId,
    model: modelId,
    historyLen: params.history.length,
    scope: params.scope,
  })

  const transcript = renderTranscript(params.history, params.userText)

  // Author through the Pi runtime. Writes a SKILL.md via the Write tool (cwd
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
