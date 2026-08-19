import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { readWikiPage } from '../wiki/store.js'
import { backlinksOf } from '../wiki/search.js'

const Params = z.object({
  source: z.enum(['global', 'project']),
  projectId: z.string().optional(),
  path: z.string().min(1),
  // Backlinks cost a grep pass; the reader wants them, a quick preview does not.
  withBacklinks: z.boolean().optional(),
})

register('wiki.readPage', async (raw) => {
  const params = Params.parse(raw)
  const content = await readWikiPage(params.source, params.projectId, params.path)
  if (params.withBacklinks !== true) return { ...content, backlinks: [] }
  const backlinks = await backlinksOf(params.path, params.projectId ? [params.projectId] : [])
  return { ...content, backlinks }
})
