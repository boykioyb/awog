import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { resumeTask } from '../tasks/engine.js'

const Params = z.object({ id: z.string().min(1) })

register('tasks.resume', async (raw) => {
  const { id } = Params.parse(raw)
  const resumed = await resumeTask(id)
  return { resumed }
})
