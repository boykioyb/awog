import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteSession } from '../sessions/store.js'

const Params = z.object({
  id: z.string().min(1),
})

register('sessions.delete', async (raw) => {
  const params = Params.parse(raw)
  await deleteSession(params.id)
  return { ok: true }
})
