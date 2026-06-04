import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteWorkflow } from '../workflows/store.js'

const Params = z.object({
  id: z.string().min(1),
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().optional(),
})

register('workflows.delete', async (raw) => {
  const { id, source, projectId } = Params.parse(raw)
  await deleteWorkflow(id, source ?? 'global', projectId)
  return { ok: true }
})
