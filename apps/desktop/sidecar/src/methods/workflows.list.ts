import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listWorkflows } from '../workflows/store.js'

const Params = z
  .object({ projectIds: z.array(z.string()).optional() })
  .optional()

register('workflows.list', async (raw) => {
  const params = Params.parse(raw)
  const workflows = await listWorkflows(params?.projectIds ?? [])
  return { workflows }
})
