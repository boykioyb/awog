import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listHooks } from '../hooks/store.js'

const Params = z.object({
  projectIds: z.array(z.string()).optional(),
})

register('hooks.list', async (raw) => {
  const params = Params.parse(raw ?? {})
  const { hooks, reports } = await listHooks(params.projectIds ?? [])
  return { hooks, reports }
})
