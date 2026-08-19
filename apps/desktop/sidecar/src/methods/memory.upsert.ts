import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { saveFact } from '../memory/store.js'
import { invalidateMemoryCache } from '../memory/inject.js'

const Params = z.object({
  // Absent = derive the slug from `name` (a new fact).
  id: z.string().max(120).optional(),
  source: z.enum(['global', 'project']),
  projectId: z.string().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000),
  body: z.string().max(64_000).optional(),
  type: z.enum(['user', 'feedback', 'project', 'reference']).optional(),
  enabled: z.boolean().optional(),
})

register('memory.upsert', async (raw) => {
  const params = Params.parse(raw)
  const fact = await saveFact(params)
  invalidateMemoryCache()
  return { fact }
})
