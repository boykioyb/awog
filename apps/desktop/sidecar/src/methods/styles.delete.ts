// Xoá một Output Style của người dùng. Xoá style trùng id với bản dựng sẵn thì
// bản dựng sẵn tự động hiện lại (resolveDirective fallback) — không mất style.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteUserStyle } from '../style/store.js'

const Params = z.object({
  id: z.string().min(1).max(64),
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().optional(),
})

register('styles.delete', async (raw) => {
  const params = Params.parse(raw)
  await deleteUserStyle(params.id, params.source ?? 'global', params.projectId)
  return { ok: true }
})
