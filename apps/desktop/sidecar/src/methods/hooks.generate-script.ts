// One-shot LLM call to write / revise a hook's SCRIPT FILE (raw code, e.g. a
// bash/node script) from a natural-language prompt. Unlike the *.generate
// methods this returns raw file content, not JSON. UI falls back to a local
// no-op when no account / sidecar is available.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { completePi } from '../runtime/complete.js'

const ModelSchema = z.enum(ANTHROPIC_MODELS)

const Params = z.object({
  prompt: z.string().min(1).max(8_000),
  accountId: z.string().min(1).max(120).optional(),
  modelId: ModelSchema.optional(),
  // The hook command (so the model knows how the script is invoked + its path).
  command: z.string().max(8_000).optional(),
  // Current script content to revise (omit to write from scratch).
  currentScript: z.string().max(256_000).optional(),
})

const SYSTEM_PROMPT = `You write the SCRIPT FILE that an AWOG hook runs. The hook invokes this script as a shell command; the event payload is passed on STDIN as JSON (e.g. {"event":"artifact.after-write","payload":{"path":"..."}}). For imported Claude Code hooks, STDIN is the Claude Code schema ({"hook_event_name","tool_name","tool_input":{"file_path":...},"cwd"}) and $CLAUDE_PROJECT_DIR is set.

Output ONLY the raw file content — no markdown fence, no commentary. Infer the language from the file extension in the command (.sh → bash with a shebang; .mjs/.cjs/.js → node; .py → python). Make the script robust: read stdin if needed, exit 0 on success, print errors to stderr.`

function stripFence(raw: string): string {
  const t = raw.trim()
  const fenced = t.match(/```(?:[\w.-]+)?\s*([\s\S]*?)\s*```/)
  return fenced && fenced[1] ? fenced[1].trim() : t
}

register('hooks.generate-script', async (raw) => {
  const params = Params.parse(raw)
  const modelId = params.modelId ?? 'claude-haiku-4-5'
  log.info('hooks.generate-script', { model: modelId, mode: params.currentScript ? 'edit' : 'create' })

  const context = [
    params.command ? `Hook command: ${params.command}` : '',
    params.currentScript ? `Current script:\n\`\`\`\n${params.currentScript}\n\`\`\`` : '',
    `Instruction: ${params.prompt}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const collected = await completePi({
    accountId: params.accountId,
    modelId,
    systemPrompt: SYSTEM_PROMPT,
    prompt: context,
  })
  const content = stripFence(collected)
  if (!content.trim()) throw new RpcError(-32021, 'Empty response from model')
  return { content }
})
