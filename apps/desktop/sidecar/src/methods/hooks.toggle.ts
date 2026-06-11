import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadHook, saveHook } from '../hooks/store.js'
import { invalidateHookCache } from '../hooks/dispatcher.js'

const Params = z.object({
  id: z.string(),
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().optional(),
  enabled: z.boolean(),
})

register('hooks.toggle', async (raw) => {
  const params = Params.parse(raw)
  const hook = await loadHook(params.id, params.source ?? 'global', params.projectId)
  if (!hook) throw new RpcError(-32602, `hook not found: ${params.id}`)
  hook.enabled = params.enabled
  await saveHook(hook)
  invalidateHookCache()
  return { id: params.id, enabled: params.enabled }
})
