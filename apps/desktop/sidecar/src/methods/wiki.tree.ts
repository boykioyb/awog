import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { scanWiki } from '../wiki/store.js'

const Params = z.object({
  projectIds: z.array(z.string()).max(200).optional(),
})

register('wiki.tree', async (raw) => {
  const params = Params.parse(raw ?? {})
  return await scanWiki(params.projectIds ?? [])
})
