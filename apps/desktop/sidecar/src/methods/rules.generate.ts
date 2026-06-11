// One-shot LLM call to draft / revise a Rule body from a natural-language prompt
// (mirrors skills.generate). Runs through the Pi runtime (completePi); the UI
// falls back to a local mock when no account / sidecar is available.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { completePi } from '../runtime/complete.js'

const ModelSchema = z.enum(ANTHROPIC_MODELS)

const CurrentRuleSchema = z
  .object({
    name: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    body: z.string().max(64_000).optional(),
  })
  .optional()

const Params = z.object({
  prompt: z.string().min(1).max(8_000),
  accountId: z.string().min(1).max(120).optional(),
  modelId: ModelSchema.optional(),
  // When provided, REVISE the existing rule instead of drafting from scratch.
  currentRule: CurrentRuleSchema,
})

const RuleDraftSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  body: z.string().min(1).max(64_000),
})

const BASE_SYSTEM_PROMPT = `You author "rules" for AWOG — short Markdown instruction files injected into an AI agent's system prompt for every session/task (like CLAUDE.md). A rule states cross-cutting conventions/policy the agent must follow.

Respond with ONLY a JSON object (no markdown fence, no prose) with this exact shape:

{
  "name": "<Title Case display name>",
  "description": "<1-sentence summary>",
  "body": "<the rule, as concise Markdown instructions for the agent>"
}

Rules:
- body is plain Markdown (headings/bullets), imperative and concrete — no YAML frontmatter, no code fence around the whole output.
- Keep description under 200 characters.
- Output the raw JSON object only.`

const EDIT_INSTRUCTIONS = `\n\nYou are REVISING an existing rule. Apply the user's instruction to the current rule and return the full updated rule JSON (keep parts the user did not ask to change).`

function buildSystemPrompt(currentRule: unknown): string {
  if (!currentRule) return BASE_SYSTEM_PROMPT
  return `${BASE_SYSTEM_PROMPT}${EDIT_INSTRUCTIONS}\n\nCurrent rule:\n${JSON.stringify(currentRule, null, 2)}`
}

function extractJson(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return fenced && fenced[1] ? fenced[1].trim() : trimmed
}

register('rules.generate', async (raw) => {
  const params = Params.parse(raw)
  const modelId = params.modelId ?? 'claude-haiku-4-5'
  log.info('rules.generate', { model: modelId, mode: params.currentRule ? 'edit' : 'create' })

  const collected = await completePi({
    accountId: params.accountId,
    modelId,
    systemPrompt: buildSystemPrompt(params.currentRule),
    prompt: params.prompt,
  })
  if (!collected.trim()) throw new RpcError(-32021, 'Empty response from model')

  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(collected))
  } catch (err) {
    log.warn('rules.generate bad json', { raw: collected.slice(0, 500) })
    throw new RpcError(-32021, `Model did not return valid JSON: ${(err as Error).message}`)
  }
  const rule = RuleDraftSchema.safeParse(parsed)
  if (!rule.success) {
    throw new RpcError(-32021, `Model output failed schema: ${rule.error.issues[0]?.message}`)
  }
  return { rule: rule.data }
})
