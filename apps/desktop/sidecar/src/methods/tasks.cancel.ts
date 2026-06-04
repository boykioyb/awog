import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { cancelTask } from '../tasks/engine.js'

const Params = z.object({ id: z.string().min(1) })

register('tasks.cancel', async (raw) => {
  const { id } = Params.parse(raw)
  const canceled = cancelTask(id)
  return { canceled }
})
