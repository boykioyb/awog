import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { moveWikiPage } from '../wiki/store.js'
import { invalidateWikiCache } from '../wiki/inject.js'

const Params = z.object({
  source: z.enum(['global', 'project']),
  projectId: z.string().optional(),
  from: z.string().min(1),
  to: z.string().min(1),
})

register('wiki.movePage', async (raw) => {
  const params = Params.parse(raw)
  const page = await moveWikiPage(params.source, params.projectId, params.from, params.to)
  invalidateWikiCache()
  return { page }
})
