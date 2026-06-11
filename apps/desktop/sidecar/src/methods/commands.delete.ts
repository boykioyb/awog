import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteCommand } from '../commands/store.js'

const Params = z.object({
  id: z.string(),
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().optional(),
})

register('commands.delete', async (raw) => {
  const params = Params.parse(raw)
  await deleteCommand(params.id, params.source ?? 'global', params.projectId)
  return { ok: true }
})
