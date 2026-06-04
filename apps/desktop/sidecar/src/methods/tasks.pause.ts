import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { pauseTask } from '../tasks/engine.js'

const Params = z.object({ id: z.string().min(1) })

register('tasks.pause', async (raw) => {
  const { id } = Params.parse(raw)
  const paused = pauseTask(id)
  return { paused }
})
