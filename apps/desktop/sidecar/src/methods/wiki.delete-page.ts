import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteWikiPage } from '../wiki/store.js'
import { invalidateWikiCache } from '../wiki/inject.js'

const Params = z.object({
  source: z.enum(['global', 'project']),
  projectId: z.string().optional(),
  path: z.string().min(1),
})

register('wiki.deletePage', async (raw) => {
  const params = Params.parse(raw)
  await deleteWikiPage(params.source, params.projectId, params.path)
  invalidateWikiCache()
  return { ok: true }
})
