import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listRules } from '../rules/store.js'

const Params = z.object({
  projectIds: z.array(z.string()).optional(),
})

register('rules.list', async (raw) => {
  const params = Params.parse(raw ?? {})
  const { rules, reports } = await listRules(params.projectIds ?? [])
  return { rules, reports }
})
