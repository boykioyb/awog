// One-shot LLM call to draft / revise an Agent. Mirror of skills.generate.
//
// Used by the "Edit System Prompt via prompt" flow in AgentDetail — the model
// returns a single JSON object representing the full updated agent. Source +
// projectId are preserved on the UI side after apply (storage metadata).

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { completePi, isModelRefusal } from '../runtime/complete.js'
import { extractJson } from '../util/json-extract.js'

const ModelSchema = z.string().min(1).max(200)

const CurrentAgentSchema = z
  .object({
    id: z.string().max(64).optional(),
    name: z.string().max(120).optional(),
    description: z.string().max(2000).optional(),
    model: z.string().max(120).optional(),
    systemPrompt: z.string().max(64_000).optional(),
    role: z.string().max(60).optional(),
    mcpServerIds: z.array(z.string()).max(200).optional(),
    skillIds: z.array(z.string()).max(200).optional(),
    repos: z.array(z.string()).max(64).optional(),
    tools: z.array(z.string()).max(200).optional(),
  })
  .optional()

const Params = z.object({
  prompt: z.string().min(1).max(32_000),
  accountId: z.string().min(1).max(120).optional(),
  modelId: ModelSchema.optional(),
  // When provided, the model is asked to REVISE the existing agent instead of
  // drafting one from scratch. id + source/projectId are preserved on the UI
  // side.
  currentAgent: CurrentAgentSchema,
  // Real pickable values the UI allows (global skills + canonical tool names).
  // When present, the model may choose from these instead of echoing verbatim —
  // it cannot guess ids it has never seen, so the catalog is what turns AI
  // suggestions into valid whitelists.
  catalogs: z
    .object({
      skills: z
        .array(z.object({ id: z.string().max(200), name: z.string().max(200) }))
        .max(500)
        .optional(),
      tools: z.array(z.string().max(200)).max(500).optional(),
    })
    .optional(),
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
  // Per-agent tool whitelist — only meaningfully populated when the caller
  // passed a tool catalog; otherwise the UI keeps the stored value.
  tools: StringArray.default([]),
  // Per-agent skill whitelist + repo access list — optional, echoed back when
  // revising so an AI edit doesn't wipe the user's picker configuration.
  skillIds: StringArray.default([]),
  repos: z.array(z.string().min(1).max(500)).max(64).default([]),
  // Accept-and-drop for legacy Context Providers — see ADR 0016.
  context: z.unknown().optional(),
})

const BASE_SYSTEM_PROMPT = `You are an agent designer for AWOG, a local-first AI Team OS. You produce agents in the Claude Code SDK subagent format.

Respond with ONLY a JSON object (no markdown fence, no prose) with this exact shape:

{
  "id": "<kebab-case-slug>",
  "name": "<Title Case display name>",
  "description": "<1-sentence when-to-use summary>",
  "model": "<claude-opus-5 | claude-sonnet-5 | claude-haiku-4-5 — pick what fits>",
  "systemPrompt": "<the markdown body — persona instructions in second person>",
  "role": "<short tag like BA / DEV / Security — optional, can be empty>",
  "mcpServerIds": []
}

Rules:
- id MUST be lowercase, kebab-case, matching ^[a-z0-9][a-z0-9-]*$.
- description should explain WHEN to invoke the agent (1 sentence under 200 chars).
- systemPrompt is the agent's working spec in Markdown — a SENIOR-GRADE operating document, not a bio blurb. Open with "You are <name> — <one-line mission>." then build numbered ## sections with real depth, tailored to the role's domain:
  · scope — what the role owns end-to-end AND what it explicitly does NOT own
  · goals + non-goals
  · responsibilities — broken into sub-areas, each a short procedure or checklist, never a one-liner
  · domain deep-dives the role demands (a Dev covers review/testing/quality gates; an ML role covers model selection, evaluation, cost, security; a BA covers elicitation, acceptance criteria, edge cases…)
  · working method — the numbered procedure it follows per task
  · decision principles — an explicit priority ladder (e.g. correctness > reliability > security > performance > cost)
  · deliverables — the exact section list its finished work/report must contain
  · boundaries — the never-do list; when to stop, escalate, or ask
  · collaboration — how it works with each sibling role; in a team run it takes work from inbox handoffs and reports via team_say
  Length: a real role spec is typically 100-400 lines — depth beats brevity, but every line must be operational (concrete rules, procedures, tables/checklists where they help). No generic AI-assistant filler, no restating the user's request. When REVISING, keep the existing structure and deepen the thin sections rather than flattening to a shorter spec.
- Default model is claude-sonnet-5 unless the request hints at a more capable / cheaper tier.
- mcpServerIds should be empty unless the user explicitly listed MCP servers — these are managed via the editor picker.
- repos are managed via the editor picker — echo the current values back verbatim; only change them when the user explicitly asks.
- Do NOT wrap your output in a code fence. Output the raw JSON object only.`

const EDIT_INSTRUCTIONS = `\n\nYou are revising an EXISTING agent. Preserve the id and any optional fields the user is not asking to change. Apply the user's edit instruction below to the current agent and return the full updated agent JSON.`

type Catalogs = {
  skills?: { id: string; name: string }[] | undefined
  tools?: string[] | undefined
}

// Catalog block — only emitted when the UI sent real pickable values. When the
// model knows the valid ids it MAY populate skillIds/tools itself; the rules in
// BASE_SYSTEM_PROMPT defer to this section.
function buildCatalogPrompt(catalogs?: Catalogs): string {
  if (!catalogs) return ''
  const parts: string[] = []
  if (catalogs.skills?.length) {
    parts.push(
      `Available skills (id — name):\n${catalogs.skills.map((s) => `- ${s.id} — ${s.name}`).join('\n')}`,
    )
  }
  if (catalogs.tools?.length) {
    parts.push(`Available tools:\n${catalogs.tools.map((tl) => `- ${tl}`).join('\n')}`)
  }
  if (!parts.length) return ''
  return `\n\n${parts.join('\n\n')}

Rules for skillIds / tools:
- You may populate them ONLY from the lists above — never invent ids.
- A non-empty array is a whitelist (restricts the agent to just those); keep the field EMPTY (or echo the current value) when the user did not ask for a restriction.
- Prefer suggesting skills/tools when the user's request clearly implies capabilities (e.g. "đảm nhiệm review" → review-related skills).`
}

function buildSystemPrompt(currentAgent: unknown, catalogs?: Catalogs): string {
  const catalogBlock = buildCatalogPrompt(catalogs)
  if (!currentAgent) return `${BASE_SYSTEM_PROMPT}${catalogBlock}`
  return `${BASE_SYSTEM_PROMPT}${EDIT_INSTRUCTIONS}${catalogBlock}\n\nCurrent agent:\n${JSON.stringify(currentAgent, null, 2)}`
}

register('agents.generate', async (raw) => {
  const params = Params.parse(raw)

  // Sonnet is the default — system prompt revision is more nuanced than skill
  // drafting and worth the upgrade from Haiku.
  const modelId = params.modelId ?? 'claude-sonnet-5'

  log.info('agents.generate', {
    model: modelId,
    mode: params.currentAgent ? 'edit' : 'create',
  })

  // Pure-text generation through the Pi runtime (no tools).
  let collected: string
  let catalogDropped = false
  try {
    collected = await completePi({
      accountId: params.accountId,
      modelId,
      systemPrompt: buildSystemPrompt(params.currentAgent, params.catalogs),
      prompt: params.prompt,
    })
  } catch (err) {
    // Provider chặn request khi catalog skills chứa id trông "nhạy cảm" — các
    // skill user tự cài (pentest/RE/keygen tooling…) có thể dính classifier
    // cyber của Anthropic dù request chỉ là "chọn skill phù hợp". Retry đúng
    // một lần không kèm skills (và rỗng skillIds trong currentAgent — field
    // này echo lại đúng những id đó) để phần revise spec vẫn chạy; draft trả
    // skillIds rỗng nên phía UI giữ whitelist đang lưu thay vì xoá mất.
    const cats = params.catalogs
    if (!isModelRefusal(err) || !cats?.skills?.length) throw err
    log.warn('agents.generate refused with skills catalog — retrying without', {
      skills: cats.skills.length,
    })
    catalogDropped = true
    const current = params.currentAgent ? { ...params.currentAgent, skillIds: [] } : undefined
    collected = await completePi({
      accountId: params.accountId,
      modelId,
      systemPrompt: buildSystemPrompt(current, cats.tools ? { tools: cats.tools } : undefined),
      prompt: params.prompt,
    })
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

  // Drop hallucinated whitelist entries — the model is told to pick only from
  // the catalog but can still slip; an unknown id inside a non-empty list
  // reads as "restricted" while silently matching nothing at runtime.
  const cats = params.catalogs
  if (cats?.skills?.length && agent.data.skillIds.length) {
    const valid = new Set(cats.skills.map((s) => s.id))
    const dropped = agent.data.skillIds.filter((id) => !valid.has(id))
    if (dropped.length) {
      log.warn('agents.generate dropped unknown skillIds', { dropped })
      agent.data.skillIds = agent.data.skillIds.filter((id) => valid.has(id))
    }
  }
  if (cats?.tools?.length && agent.data.tools.length) {
    const valid = new Set(cats.tools)
    const dropped = agent.data.tools.filter((tl) => !valid.has(tl))
    if (dropped.length) {
      log.warn('agents.generate dropped unknown tools', { dropped })
      agent.data.tools = agent.data.tools.filter((tl) => valid.has(tl))
    }
  }

  return { agent: agent.data, catalogDropped }
})
