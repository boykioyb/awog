import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listMemory } from '../memory/store.js'

const Params = z.object({
  projectIds: z.array(z.string()).max(200).optional(),
})

register('memory.list', async (raw) => {
  const params = Params.parse(raw ?? {})
  return await listMemory(params.projectIds ?? [])
})
