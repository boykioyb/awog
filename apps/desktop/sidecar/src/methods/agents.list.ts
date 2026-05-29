import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listAgents } from '../agents/store.js'

const Params = z
  .object({
    // When omitted, only user-level tiers (global, user-claude, user-agents)
    // are scanned. UI passes the registered project ids so .claude/.agents
    // under each project also get picked up.
    projectIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .optional()

register('agents.list', async (raw) => {
  const params = Params.parse(raw)
  const ids = params?.projectIds ?? []
  const { agents, reports } = await listAgents(ids)
  return { agents, reports }
})
