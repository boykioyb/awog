import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { setHookTrust } from '../hooks/store.js'
import { invalidateHookCache } from '../hooks/dispatcher.js'

// Grant trust to project-tier hooks (ADR 0032 D-8). Global hooks need no entry.
const Params = z.object({
  projectId: z.string(),
  hookIds: z.array(z.string()),
})

register('hooks.trust', async (raw) => {
  const params = Params.parse(raw)
  await setHookTrust(params.projectId, params.hookIds)
  invalidateHookCache()
  return { trusted: params.hookIds }
})
