import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { clearMemory } from '../memory/store.js'
import { invalidateMemoryCache } from '../memory/inject.js'

const Params = z.object({
  source: z.enum(['global', 'project']),
  projectId: z.string().optional(),
})

register('memory.clear', async (raw) => {
  const params = Params.parse(raw)
  const result = await clearMemory(params.source, params.projectId)
  invalidateMemoryCache()
  return result
})
