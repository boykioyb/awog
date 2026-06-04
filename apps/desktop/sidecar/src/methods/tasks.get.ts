import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadTask } from '../tasks/store.js'

const Params = z.object({ id: z.string().min(1) })

register('tasks.get', async (raw) => {
  const { id } = Params.parse(raw)
  const task = await loadTask(id)
  return { task }
})
