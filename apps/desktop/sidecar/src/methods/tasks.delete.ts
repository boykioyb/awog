import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteTask } from '../tasks/store.js'
import { cancelTask } from '../tasks/engine.js'

const Params = z.object({ id: z.string().min(1) })

register('tasks.delete', async (raw) => {
  const { id } = Params.parse(raw)
  // Abort any in-flight execution before tombstoning so we don't leave orphan
  // SDK turns writing into a deleted task's log.
  cancelTask(id)
  await deleteTask(id)
  return { ok: true }
})
