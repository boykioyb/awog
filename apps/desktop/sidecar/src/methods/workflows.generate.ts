// One-shot LLM call to draft a Workflow DAG from a natural-language prompt.
// Mirror of agents.generate / skills.generate. The model is given the set of
// agents it may use (already scoped by the UI to the workflow's project) and
// returns a DAG: nodes each pick an agentId + (optional) skillId, plus edges.
//
// Node x/y layout + agent source/projectId resolution happen on the UI side
// (it owns the agent list + canvas geometry) — this method only does the LLM
// call + JSON validation.

import { z } from 'zod'
import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { register, RpcError } from '../transport/rpc.js'
import { resolveAccount } from '../sessions/runner.js'
import { ensureFreshAccessToken } from '../credentials/token-manager.js'
import { log } from '../util/logger.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'

const ModelSchema = z.enum(ANTHROPIC_MODELS)

const AvailableAgentSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().max(120).default(''),
  role: z.string().max(60).default(''),
  // 'project' = lives in this project's repo; 'global' = shared. The model is
  // told to prefer project agents over global when both could do a step.
  scope: z.enum(['project', 'global']).default('global'),
})

// Skills are independent of agents (no per-agent skill list). The whole
// workspace skill set is offered; the model assigns one to each node as needed.
const AvailableSkillSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().max(120).default(''),
})

const Params = z.object({
  prompt: z.string().min(1).max(8_000),
  accountId: z.string().min(1).max(120).optional(),
  modelId: ModelSchema.optional(),
  availableAgents: z.array(AvailableAgentSchema).max(200).default([]),
  availableSkills: z.array(AvailableSkillSchema).max(500).default([]),
})

const NodeSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/i),
  agentId: z.string().min(1).max(120),
  skillId: z.string().max(120).default(''),
  outputs: z.array(z.string().min(1).max(120)).max(10).default(['output.md']),
  approval: z.boolean().default(false),
})

const EdgeSchema = z.object({ from: z.string().min(1), to: z.string().min(1) })

const WorkflowGenSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  nodes: z.array(NodeSchema).max(50).default([]),
  edges: z.array(EdgeSchema).max(200).default([]),
})

function buildSystemPrompt(
  agents: z.infer<typeof AvailableAgentSchema>[],
  skills: z.infer<typeof AvailableSkillSchema>[],
): string {
  // Project agents first so the model sees them as the primary choices.
  const ordered = [...agents].sort((a, b) => {
    if (a.scope === b.scope) return 0
    return a.scope === 'project' ? -1 : 1
  })
  const agentList =
    ordered.length > 0
      ? ordered
          .map((a) => `- [${a.scope}] id: ${a.id} | role: ${a.role || '—'} | name: ${a.name}`)
          .join('\n')
      : '(no agents available — return an empty nodes array and explain in the description)'

  const skillList =
    skills.length > 0
      ? skills.map((s) => `- id: ${s.id} | name: ${s.name}`).join('\n')
      : '(no skills available — leave skillId empty on every node)'

  return `You are a workflow designer for AWOG, a local-first AI Team OS. A workflow is a DAG of steps; each step (node) runs ONE agent applying ONE skill (the step's task template), producing artifact file(s). Edges define order + dependencies (a node runs after all its upstream nodes complete). Independent branches run in parallel.

Available agents (you MUST only use these agent ids):
${agentList}

Available skills (a node's skillId MUST be one of these, or empty):
${skillList}

Respond with ONLY a JSON object (no markdown fence, no prose) of this exact shape:

{
  "name": "<Title Case workflow name>",
  "description": "<1-sentence summary>",
  "nodes": [
    { "id": "n1", "agentId": "<one of the agent ids above>", "skillId": "<one of the skill ids above, or empty>", "outputs": ["<artifact filename, e.g. requirements.md>"], "approval": false }
  ],
  "edges": [ { "from": "n1", "to": "n2" } ]
}

Rules:
- node id: short, unique, kebab/alnum (e.g. n1, n2, review).
- agentId MUST be one of the listed agent ids. skillId MUST be one of the listed skill ids (or "" if none fits).
- PREFER [project] agents over [global] agents when both could perform a step — project agents are tailored to this codebase. Only fall back to a [global] agent when no [project] agent fits the step.
- Build a sensible pipeline: sequence dependent steps with edges; put genuinely independent steps as parallel branches (no edge between them).
- Set "approval": true on steps a human should review before continuing (e.g. after architecture/design, before code merge).
- outputs: one or more short artifact filenames the step produces (.md / .diff / .yaml).
- Do NOT invent agent ids. If no agents are available, return "nodes": [] and "edges": [].
- Output the raw JSON object only — no code fence.`
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

register('workflows.generate', async (raw) => {
  const params = Params.parse(raw)
  const account = await resolveAccount('anthropic', params.accountId)
  const tokens = await ensureFreshAccessToken('anthropic', account.id)

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
    systemPrompt: buildSystemPrompt(params.availableAgents, params.availableSkills),
  }

  log.info('workflows.generate', { account: account.id, model: modelId, agents: params.availableAgents.length })

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
    log.warn('workflows.generate sdk error', { err: message })
    throw new RpcError(-32021, `workflow generation failed: ${message}`)
  }

  if (!collected.trim()) throw new RpcError(-32021, 'Empty response from model')

  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(collected))
  } catch (err) {
    log.warn('workflows.generate bad json', { raw: collected.slice(0, 500) })
    throw new RpcError(-32021, `Model did not return valid JSON: ${(err as Error).message}`)
  }

  const result = WorkflowGenSchema.safeParse(parsed)
  if (!result.success) {
    log.warn('workflows.generate schema mismatch', { issues: result.error.issues })
    throw new RpcError(-32021, `Model output failed schema: ${result.error.issues[0]?.message}`)
  }

  return { workflow: result.data }
})
