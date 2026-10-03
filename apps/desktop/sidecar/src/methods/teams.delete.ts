import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteTeam } from '../teams/store.js'

// Xoá một team spec. Cố ý KHÔNG đụng cây phiên đã materialize từ spec đó —
// instance đang chạy sống đời của nó (xoá spec chỉ mất "khuôn" để chạy sau).
const Params = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  source: z.enum(['global', 'project']).default('global'),
  projectId: z.string().min(1).max(64).optional(),
})

register('teams.delete', async (raw) => {
  const params = Params.parse(raw)
  await deleteTeam(params.id, params.source, params.projectId)
  return { ok: true }
})
