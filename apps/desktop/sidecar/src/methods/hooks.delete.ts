import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteHook } from '../hooks/store.js'
import { invalidateHookCache } from '../hooks/dispatcher.js'

const Params = z.object({
  id: z.string(),
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().optional(),
})

register('hooks.delete', async (raw) => {
  const params = Params.parse(raw)
  await deleteHook(params.id, params.source ?? 'global', params.projectId)
  invalidateHookCache()
  return { ok: true }
})
