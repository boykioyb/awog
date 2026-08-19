import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { backlinksOf } from '../wiki/search.js'

const Params = z.object({
  path: z.string().min(1),
  projectIds: z.array(z.string()).max(200).optional(),
})

register('wiki.backlinks', async (raw) => {
  const params = Params.parse(raw)
  const pages = await backlinksOf(params.path, params.projectIds ?? [])
  return { pages }
})
