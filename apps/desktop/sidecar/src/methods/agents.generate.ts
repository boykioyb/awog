// One-shot LLM call to draft / revise an Agent. Mirror of skills.generate.
//
// Used by the "Edit System Prompt via prompt" flow in AgentDetail — the model
// returns a single JSON object representing the full updated agent. Source +
// projectId are preserved on the UI side after apply (storage metadata).

import { z } from 'zod'
import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { register, RpcError } from '../transport/rpc.js'
import { resolveAccount } from '../sessions/runner.js'
import { ensureFreshAccessToken } from '../credentials/token-manager.js'
import { log } from '../util/logger.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'

const ModelSchema = z.enum(ANTHROPIC_MODELS)

const CurrentAgentSchema = z
  .object({
    id: z.string().max(64).optional(),
    name: z.string().max(120).optional(),
    description: z.string().max(2000).optional(),
    model: z.string().max(120).optional(),
    systemPrompt: z.string().max(64_000).optional(),
    role: z.string().max(60).optional(),
    mcpServerIds: z.array(z.string()).max(200).optional(),
  })
  .optional()

const Params = z.object({
  prompt: z.string().min(1).max(8_000),
  accountId: z.string().min(1).max(120).optional(),
  modelId: ModelSchema.optional(),
  // When provided, the model is asked to REVISE the existing agent instead of
  // drafting one from scratch. id + source/projectId are preserved on the UI
  // side.
  currentAgent: CurrentAgentSchema,
})

const StringArray = z.array(z.string().min(1).max(200)).max(200)
const AgentDraftSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  model: z.string().max(120).default(''),
  systemPrompt: z.string().max(64_000).default(''),
  role: z.string().max(60).default(''),
  mcpServerIds: StringArray.default([]),
  // Accept-and-drop for legacy Context Providers — see ADR 0016.
  context: z.unknown().optional(),
})

const BASE_SYSTEM_PROMPT = `You are an agent designer for AWOG, a local-first AI Team OS. You produce agents in the Claude Code SDK subagent format.

Respond with ONLY a JSON object (no markdown fence, no prose) with this exact shape:

{
  "id": "<kebab-case-slug>",
  "name": "<Title Case display name>",
  "description": "<1-sentence when-to-use summary>",
  "model": "<claude-opus-4-7 | claude-sonnet-4-6 | claude-haiku-4-5 — pick what fits>",
  "systemPrompt": "<the markdown body — persona instructions in second person>",
  "role": "<short tag like BA / DEV / Security — optional, can be empty>",
  "mcpServerIds": []
}

Rules:
- id MUST be lowercase, kebab-case, matching ^[a-z0-9][a-z0-9-]*$.
- description should explain WHEN to invoke the agent (1 sentence under 200 chars).
- systemPrompt is the persona body in plain Markdown — start with "You are..." and cover voice, output style, anti-patterns. 3-8 sentences typical.
- Default model is claude-sonnet-4-6 unless the request hints at a more capable / cheaper tier.
- mcpServerIds should be empty unless the user explicitly listed MCP servers — these are managed via the editor picker.
- Do NOT wrap your output in a code fence. Output the raw JSON object only.`

const EDIT_INSTRUCTIONS = `\n\nYou are revising an EXISTING agent. Preserve the id and any optional fields the user is not asking to change. Apply the user's edit instruction below to the current agent and return the full updated agent JSON.`

function buildSystemPrompt(currentAgent: unknown): string {
  if (!currentAgent) return BASE_SYSTEM_PROMPT
  return `${BASE_SYSTEM_PROMPT}${EDIT_INSTRUCTIONS}\n\nCurrent agent:\n${JSON.stringify(currentAgent, null, 2)}`
}

function extractJson(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced && fenced[1]) return fenced[1].trim()
  return trimmed
}

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

register('agents.generate', async (raw) => {
  const params = Params.parse(raw)
  const account = await resolveAccount('anthropic', params.accountId)
  const tokens = await ensureFreshAccessToken('anthropic', account.id)

  // Sonnet is the default — system prompt revision is more nuanced than skill
  // drafting and worth the upgrade from Haiku.
  const modelId = params.modelId ?? 'claude-sonnet-4-6'

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
    systemPrompt: buildSystemPrompt(params.currentAgent),
  }

  log.info('agents.generate', {
    account: account.id,
    model: modelId,
    mode: params.currentAgent ? 'edit' : 'create',
  })

  let collected = ''
  try {
    const q = query({ prompt: params.prompt, options })
    for await (const evt of q) {
      if (evt.type === 'assistant') {
        const msg = evt.message as { content?: unknown[] }
        for (const block of msg.content ?? []) {
          if (isTextBlock(block)) collected += block.text
        }
      }
      if (evt.type === 'result') break
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn('agents.generate sdk error', { err: message })
    throw new RpcError(-32021, `agent generation failed: ${message}`)
  }

  if (!collected.trim()) {
    throw new RpcError(-32021, 'Empty response from model')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(collected))
  } catch (err) {
    log.warn('agents.generate bad json', { raw: collected.slice(0, 500) })
    throw new RpcError(-32021, `Model did not return valid JSON: ${(err as Error).message}`)
  }

  const agent = AgentDraftSchema.safeParse(parsed)
  if (!agent.success) {
    log.warn('agents.generate schema mismatch', { issues: agent.error.issues })
    throw new RpcError(-32021, `Model output failed schema: ${agent.error.issues[0]?.message}`)
  }

  return { agent: agent.data }
})
