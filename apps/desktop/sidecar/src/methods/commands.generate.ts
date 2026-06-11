// One-shot LLM call to draft / revise a slash command from a natural-language
// prompt (mirrors rules.generate / skills.generate). Runs through the Pi runtime
// (completePi); the UI falls back to a local mock when no account / sidecar.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { completePi } from '../runtime/complete.js'

const ModelSchema = z.enum(ANTHROPIC_MODELS)

const CurrentCommandSchema = z
  .object({
    name: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    argumentHint: z.string().max(400).optional(),
    body: z.string().max(64_000).optional(),
  })
  .optional()

const Params = z.object({
  prompt: z.string().min(1).max(8_000),
  accountId: z.string().min(1).max(120).optional(),
  modelId: ModelSchema.optional(),
  // When provided, REVISE the existing command instead of drafting from scratch.
  currentCommand: CurrentCommandSchema,
})

const CommandDraftSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  argumentHint: z.string().max(400).default(''),
  body: z.string().min(1).max(64_000),
})

const BASE_SYSTEM_PROMPT = `You author "slash commands" for AWOG — reusable prompt templates a user invokes from the chat composer by typing "/<name> [args]" (the AWOG-native analog of Claude Code's .claude/commands/*.md). On send, the body is expanded into the prompt and SENT TO THE AGENT.

Respond with ONLY a JSON object (no markdown fence, no prose) with this exact shape:

{
  "name": "<kebab-case-slug, the text after the slash>",
  "description": "<1-sentence summary shown in the command picker>",
  "argumentHint": "<short hint for expected args, e.g. \\"[focus]\\" — empty string if none>",
  "body": "<the prompt template the agent receives>"
}

Rules:
- name is a short kebab-case slug (no leading slash, no spaces).
- body is a clear instruction to the agent, plain Markdown allowed. Use the literal token "$ARGUMENTS" where the user's arguments should be inserted, or "$1", "$2" … for positional args. If the command takes no arguments, omit those tokens.
- Keep description under 200 characters.
- Output the raw JSON object only.`

const EDIT_INSTRUCTIONS = `\n\nYou are REVISING an existing command. Apply the user's instruction and return the full updated command JSON (keep parts the user did not ask to change).`

function buildSystemPrompt(current: unknown): string {
  if (!current) return BASE_SYSTEM_PROMPT
  return `${BASE_SYSTEM_PROMPT}${EDIT_INSTRUCTIONS}\n\nCurrent command:\n${JSON.stringify(current, null, 2)}`
}

function extractJson(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return fenced && fenced[1] ? fenced[1].trim() : trimmed
}

register('commands.generate', async (raw) => {
  const params = Params.parse(raw)
  const modelId = params.modelId ?? 'claude-haiku-4-5'
  log.info('commands.generate', { model: modelId, mode: params.currentCommand ? 'edit' : 'create' })

  const collected = await completePi({
    accountId: params.accountId,
    modelId,
    systemPrompt: buildSystemPrompt(params.currentCommand),
    prompt: params.prompt,
  })
  if (!collected.trim()) throw new RpcError(-32021, 'Empty response from model')

  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(collected))
  } catch (err) {
    log.warn('commands.generate bad json', { raw: collected.slice(0, 500) })
    throw new RpcError(-32021, `Model did not return valid JSON: ${(err as Error).message}`)
  }
  const command = CommandDraftSchema.safeParse(parsed)
  if (!command.success) {
    throw new RpcError(-32021, `Model output failed schema: ${command.error.issues[0]?.message}`)
  }
  return { command: command.data }
})
