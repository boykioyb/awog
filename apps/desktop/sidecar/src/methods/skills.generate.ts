// One-shot LLM call to draft a SKILL.md from a natural-language prompt.
//
// Runs through the Pi runtime (completePi) — Anthropic account resolved by
// accountId. Unlike chat we do not stream: we collect the full assistant text,
// strip the surrounding ```json fence if present, and parse a strict schema.
// The mock generator in the UI is the fallback when no account / sidecar is
// available; this method is only reached when both are present.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { completePi } from '../runtime/complete.js'

const ModelSchema = z.enum(ANTHROPIC_MODELS)

const CurrentSkillSchema = z
  .object({
    id: z.string().max(64).optional(),
    name: z.string().max(120).optional(),
    description: z.string().max(2000).optional(),
    body: z.string().max(64_000).optional(),
    icon: z.string().max(2048).optional(),
    globs: z.array(z.string()).max(20).optional(),
    alwaysAllow: z.array(z.string()).max(20).optional(),
    requiredSources: z.array(z.string()).max(20).optional(),
  })
  .optional()

const Params = z.object({
  prompt: z.string().min(1).max(8_000),
  accountId: z.string().min(1).max(120).optional(),
  modelId: ModelSchema.optional(),
  // When provided, the model is asked to REVISE the existing skill instead of
  // drafting one from scratch. id is preserved unless the edit prompt
  // explicitly renames it.
  currentSkill: CurrentSkillSchema,
})

// What the LLM must return. Mirrors SkillDraft on the UI side (id is the slug;
// source/projectId are picked in the editor afterwards).
const StringArray = z.array(z.string().min(1).max(200)).max(20)
const SkillDraftSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  body: z.string().max(64_000),
  icon: z.string().max(2048).optional(),
  globs: StringArray.optional(),
  alwaysAllow: StringArray.optional(),
  requiredSources: StringArray.optional(),
})

const BASE_SYSTEM_PROMPT = `You are a skill author for AWOG, a local-first AI Team OS. You produce skills in the Claude Code SDK / craft-agents-oss SKILL.md format.

Respond with ONLY a JSON object (no markdown fence, no prose) with this exact shape:

{
  "id": "<kebab-case-slug>",
  "name": "<Title Case display name>",
  "description": "<1–2 sentence summary>",
  "body": "<the markdown body of SKILL.md, without YAML frontmatter>",
  "icon": "<single emoji, optional>",
  "globs": ["<file glob>", ...],            // optional, omit if not applicable
  "alwaysAllow": ["Bash", ...],              // optional, list of tool names
  "requiredSources": ["github", ...]        // optional, source slugs
}

Rules:
- The id MUST be lowercase, kebab-case, matching ^[a-z0-9][a-z0-9-]*$.
- Keep description under 200 characters.
- The body must be valid Markdown with concrete instructions for Claude — short headings, bullet rules, concrete examples.
- Do NOT include the YAML frontmatter delimiters (---). Only the markdown body.
- Do NOT wrap your output in a code fence. Output the raw JSON object only.`

const EDIT_INSTRUCTIONS = `\n\nYou are revising an EXISTING skill. Preserve the id and any optional fields (icon/globs/alwaysAllow/requiredSources) the user is not asking to change. Apply the user's edit instruction below to the current skill and return the full updated skill JSON.`

function buildSystemPrompt(currentSkill: unknown): string {
  if (!currentSkill) return BASE_SYSTEM_PROMPT
  return `${BASE_SYSTEM_PROMPT}${EDIT_INSTRUCTIONS}\n\nCurrent skill:\n${JSON.stringify(currentSkill, null, 2)}`
}

function extractJson(raw: string): string {
  const trimmed = raw.trim()
  // Tolerate the model wrapping the JSON in a ```json fence even though we
  // asked it not to.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced && fenced[1]) return fenced[1].trim()
  return trimmed
}

register('skills.generate', async (raw) => {
  const params = Params.parse(raw)

  // Haiku is the cheap default — generating a one-page SKILL.md does not need
  // Opus. UI may override via modelId if user wants a higher tier.
  const modelId = params.modelId ?? 'claude-haiku-4-5'

  log.info('skills.generate', {
    model: modelId,
    mode: params.currentSkill ? 'edit' : 'create',
  })

  // Pure-text generation through the Pi runtime (no tools).
  const collected = await completePi({
    accountId: params.accountId,
    modelId,
    systemPrompt: buildSystemPrompt(params.currentSkill),
    prompt: params.prompt,
  })

  if (!collected.trim()) {
    throw new RpcError(-32021, 'Empty response from model')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(collected))
  } catch (err) {
    log.warn('skills.generate bad json', { raw: collected.slice(0, 500) })
    throw new RpcError(-32021, `Model did not return valid JSON: ${(err as Error).message}`)
  }

  const skill = SkillDraftSchema.safeParse(parsed)
  if (!skill.success) {
    log.warn('skills.generate schema mismatch', { issues: skill.error.issues })
    throw new RpcError(-32021, `Model output failed schema: ${skill.error.issues[0]?.message}`)
  }

  return { skill: skill.data }
})
