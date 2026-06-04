import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadAgent, renameAgent, saveAgent } from '../agents/store.js'
import type { Agent, AgentSource } from '../types/shared.js'

const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

const AgentIdSchema = z.string().regex(AGENT_ID_RE, 'id must match [a-z0-9][a-z0-9-]{0,62}')

const AgentSourceSchema: z.ZodType<AgentSource> = z.enum([
  'global',
  'user-claude',
  'user-agents',
  'project-claude',
  'project-agents',
])

const USER_SOURCES: AgentSource[] = ['global', 'user-claude', 'user-agents']
const isUserSource = (s: AgentSource): boolean => USER_SOURCES.includes(s)

const StringArray = z.array(z.string().min(1).max(200)).max(200)

const AgentSchema = z.object({
  id: AgentIdSchema,
  source: AgentSourceSchema,
  projectId: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  model: z.string().max(120).default(''),
  systemPrompt: z.string().max(64_000).default(''),
  role: z.string().max(60).default(''),
  // Claude Code subagent `tools` field — SDK tool whitelist for this agent.
  tools: StringArray.optional(),
  // Per-agent MCP server whitelist (ADR 0016 replacement for context).
  mcpServerIds: StringArray.optional(),
  // Backwards-compat: silently accept-and-drop `context` from legacy clients
  // (Context Providers feature was deprecated — see ADR 0016).
  context: z.unknown().optional(),
})

const Params = z.object({
  agent: AgentSchema,
  mode: z.enum(['create', 'update']),
  previousId: AgentIdSchema.optional(),
})

register('agents.upsert', async (raw) => {
  const params = Params.parse(raw)
  const incoming = params.agent

  if (!isUserSource(incoming.source) && !incoming.projectId) {
    throw new RpcError(-32602, `Source ${incoming.source} requires projectId`)
  }
  if (isUserSource(incoming.source) && incoming.projectId) {
    throw new RpcError(
      -32602,
      `projectId must be omitted for user-level source ${incoming.source}`,
    )
  }

  if (params.previousId && params.previousId !== incoming.id) {
    if (params.mode !== 'update') {
      throw new RpcError(-32602, 'previousId only valid in update mode')
    }
    const existing = await loadAgent(params.previousId, incoming.source, incoming.projectId)
    if (!existing) {
      throw new RpcError(-32602, `Agent not found: ${params.previousId}`)
    }
    await renameAgent(params.previousId, incoming.id, incoming.source, incoming.projectId)
  } else {
    const existing = await loadAgent(incoming.id, incoming.source, incoming.projectId)
    if (params.mode === 'create' && existing) {
      throw new RpcError(-32602, `Agent id already exists: ${incoming.id}`)
    }
    if (params.mode === 'update' && !existing) {
      throw new RpcError(-32602, `Agent not found: ${incoming.id}`)
    }
  }

  const agent: Agent = {
    id: incoming.id,
    source: incoming.source,
    name: incoming.name,
    description: incoming.description,
    model: incoming.model,
    systemPrompt: incoming.systemPrompt,
    role: incoming.role,
  }
  if (incoming.projectId) agent.projectId = incoming.projectId
  if (incoming.tools && incoming.tools.length > 0) agent.tools = incoming.tools
  if (incoming.mcpServerIds && incoming.mcpServerIds.length > 0) {
    agent.mcpServerIds = incoming.mcpServerIds
  }

  await saveAgent(agent)
  return { agent }
})
