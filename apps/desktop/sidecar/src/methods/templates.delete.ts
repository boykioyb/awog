import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteTemplate } from '../templates/store.js'

const Params = z.object({ id: z.string().min(1).max(120) })

register('templates.delete', async (raw) => {
  const { id } = Params.parse(raw)
  await deleteTemplate(id)
  return { ok: true }
})
