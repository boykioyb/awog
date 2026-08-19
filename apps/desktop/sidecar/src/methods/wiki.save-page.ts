import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { saveWikiPage } from '../wiki/store.js'
import { invalidateWikiCache } from '../wiki/inject.js'

const Params = z.object({
  source: z.enum(['global', 'project']),
  projectId: z.string().optional(),
  path: z.string().min(1),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  context: z.boolean().optional(),
  body: z.string().default(''),
  mode: z.enum(['create', 'update']).optional(),
})

register('wiki.savePage', async (raw) => {
  const params = Params.parse(raw)
  const page = await saveWikiPage(params)
  invalidateWikiCache()
  return { page }
})
