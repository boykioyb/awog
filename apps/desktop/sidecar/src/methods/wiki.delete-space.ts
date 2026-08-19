import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteWikiSpace } from '../wiki/store.js'
import { invalidateWikiCache } from '../wiki/inject.js'

const Params = z.object({
  source: z.enum(['global', 'project']),
  projectId: z.string().optional(),
  space: z.string().min(1),
})

register('wiki.deleteSpace', async (raw) => {
  const params = Params.parse(raw)
  await deleteWikiSpace(params.source, params.projectId, params.space)
  invalidateWikiCache()
  return { ok: true }
})
