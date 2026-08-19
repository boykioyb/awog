import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { searchWiki } from '../wiki/search.js'

const Params = z.object({
  query: z.string().min(1).max(500),
  projectIds: z.array(z.string()).max(200).optional(),
  space: z.string().max(200).optional(),
  max: z.number().int().positive().max(500).optional(),
})

register('wiki.search', async (raw) => {
  const params = Params.parse(raw)
  const hits = await searchWiki(params)
  return { hits }
})
