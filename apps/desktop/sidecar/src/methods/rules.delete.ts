import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteRule } from '../rules/store.js'
import { invalidateRulesCache } from '../rules/inject.js'

const Params = z.object({
  id: z.string(),
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().optional(),
})

register('rules.delete', async (raw) => {
  const params = Params.parse(raw)
  await deleteRule(params.id, params.source ?? 'global', params.projectId)
  invalidateRulesCache()
  return { ok: true }
})
