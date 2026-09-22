import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listPmsTasks } from '../logtime/mcp.js'

const Params = z.object({
  sourceId: z.string().min(1),
  projectId: z.string().min(1),
  q: z.string().max(200).optional(),
})

register('logtime.tasks', async (raw) => {
  const { sourceId, projectId, q } = Params.parse(raw)
  return { tasks: await listPmsTasks(sourceId, projectId, q) }
})
