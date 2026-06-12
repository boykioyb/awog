import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listAgents } from '../agents/store.js'

const Params = z
  .object({
    // When omitted, only the global tier (~/.awog/agents) is scanned. UI passes
    // the registered project ids so {project}/.awog/agents is also picked up.
    projectIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .optional()

register('agents.list', async (raw) => {
  const params = Params.parse(raw)
  const ids = params?.projectIds ?? []
  const { agents, reports } = await listAgents(ids)
  return { agents, reports }
})
