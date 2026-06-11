// One-shot LLM call to draft / revise a Hook config from a natural-language
// prompt (mirrors skills.generate). Returns the editable config fields; the UI
// falls back to a local mock when no account / sidecar is available.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { completePi } from '../runtime/complete.js'
import { HOOK_EVENTS } from '../hooks/schema.js'

const ModelSchema = z.enum(ANTHROPIC_MODELS)

const CurrentHookSchema = z
  .object({
    name: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    event: z.string().max(64).optional(),
    matcher: z.record(z.string(), z.string()).optional(),
    command: z.string().max(8_000).optional(),
    cwd: z.string().max(2048).optional(),
    timeoutMs: z.number().optional(),
    runMode: z.string().max(32).optional(),
  })
  .optional()

const Params = z.object({
  prompt: z.string().min(1).max(8_000),
  accountId: z.string().min(1).max(120).optional(),
  modelId: ModelSchema.optional(),
  currentHook: CurrentHookSchema,
})

const HookDraftSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  event: z.enum(HOOK_EVENTS),
  matcher: z.record(z.string(), z.string()).default({}),
  command: z.string().min(1).max(8_000),
  cwd: z.string().max(2048).default('${workspace}'),
  timeoutMs: z.number().int().positive().max(300_000).default(30_000),
  runMode: z.enum(['blocking', 'background']).default('background'),
})

const BASE_SYSTEM_PROMPT = `You author "hooks" for AWOG — shell commands run when a lifecycle event fires. The runtime fires these events: ${HOOK_EVENTS.join(', ')}. A hook matches an event + an optional matcher and runs a shell command (stdin = JSON payload). \`*.before-*\` hooks can block by exiting non-zero.

Respond with ONLY a JSON object (no markdown fence, no prose) with this exact shape:

{
  "name": "<Title Case display name>",
  "description": "<1-sentence summary>",
  "event": "<one of the events listed above>",
  "matcher": { "<jsonPathKey>": "<glob-or-value>" },   // {} = match all; for tool.* use {"toolName":"Write"} or {"toolName":"{Edit,Write}"}
  "command": "<shell command; may use {{event.payload.path}} placeholders and \${workspace}>",
  "cwd": "\${workspace}",
  "timeoutMs": 30000,
  "runMode": "blocking" | "background"
}

Rules:
- event MUST be exactly one of the listed events.
- runMode "blocking" only for *.before-* / when the hook must gate the action; else "background".
- matcher is an AND-map of jsonPath → glob/value; use {} when it should run for every payload.
- Output the raw JSON object only.`

const EDIT_INSTRUCTIONS = `\n\nYou are REVISING an existing hook. Apply the user's instruction to the current hook and return the full updated hook JSON (keep parts the user did not ask to change).`

function buildSystemPrompt(currentHook: unknown): string {
  if (!currentHook) return BASE_SYSTEM_PROMPT
  return `${BASE_SYSTEM_PROMPT}${EDIT_INSTRUCTIONS}\n\nCurrent hook:\n${JSON.stringify(currentHook, null, 2)}`
}

function extractJson(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return fenced && fenced[1] ? fenced[1].trim() : trimmed
}

register('hooks.generate', async (raw) => {
  const params = Params.parse(raw)
  const modelId = params.modelId ?? 'claude-haiku-4-5'
  log.info('hooks.generate', { model: modelId, mode: params.currentHook ? 'edit' : 'create' })

  const collected = await completePi({
    accountId: params.accountId,
    modelId,
    systemPrompt: buildSystemPrompt(params.currentHook),
    prompt: params.prompt,
  })
  if (!collected.trim()) throw new RpcError(-32021, 'Empty response from model')

  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(collected))
  } catch (err) {
    log.warn('hooks.generate bad json', { raw: collected.slice(0, 500) })
    throw new RpcError(-32021, `Model did not return valid JSON: ${(err as Error).message}`)
  }
  const hook = HookDraftSchema.safeParse(parsed)
  if (!hook.success) {
    throw new RpcError(-32021, `Model output failed schema: ${hook.error.issues[0]?.message}`)
  }
  return { hook: hook.data }
})
