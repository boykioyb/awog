import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteFact } from '../memory/store.js'
import { invalidateMemoryCache } from '../memory/inject.js'

const Params = z.object({
  id: z.string().min(1).max(120),
  source: z.enum(['global', 'project']),
  projectId: z.string().optional(),
})

register('memory.delete', async (raw) => {
  const params = Params.parse(raw)
  await deleteFact(params.id, params.source, params.projectId)
  invalidateMemoryCache()
  return { ok: true }
})
