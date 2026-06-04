import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { renameTask } from '../tasks/store.js'

const Params = z.object({ id: z.string().min(1), title: z.string() })

register('tasks.rename', async (raw) => {
  const { id, title } = Params.parse(raw)
  await renameTask(id, title)
  return { ok: true }
})
