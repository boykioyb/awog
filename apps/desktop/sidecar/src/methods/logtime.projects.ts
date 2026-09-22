import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listPmsProjects } from '../logtime/mcp.js'

const Params = z.object({
  sourceId: z.string().min(1),
  q: z.string().max(200).optional(),
})

register('logtime.projects', async (raw) => {
  const { sourceId, q } = Params.parse(raw)
  return { projects: await listPmsProjects(sourceId, q) }
})
