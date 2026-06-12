import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteAgent } from '../agents/store.js'
import type { AgentSource } from '../types/shared.js'

const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

const AgentSourceSchema: z.ZodType<AgentSource> = z.enum(['global', 'project'])

const Params = z.object({
  id: z.string().regex(AGENT_ID_RE),
  source: AgentSourceSchema,
  projectId: z.string().min(1).max(64).optional(),
})

register('agents.delete', async (raw) => {
  const { id, source, projectId } = Params.parse(raw)
  await deleteAgent(id, source, projectId)
  return { ok: true }
})
