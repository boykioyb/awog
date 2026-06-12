import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { deleteSkill } from '../skills/store.js'

const Params = z.object({
  id: z.string().min(1),
  source: z.enum(['global', 'project']),
  projectId: z.string().min(1).max(64).optional(),
})

register('skills.delete', async (raw) => {
  const params = Params.parse(raw)
  if (params.source === 'project' && !params.projectId) {
    throw new RpcError(-32602, 'Project skill requires projectId')
  }
  await deleteSkill(params.id, params.source, params.projectId)
  return { ok: true }
})
