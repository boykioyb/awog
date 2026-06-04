import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { rerunPhase } from '../tasks/engine.js'

const Params = z.object({
  taskId: z.string().min(1),
  nodeId: z.string().min(1),
  instruction: z.string().optional(),
})

register('tasks.rerunPhase', async (raw) => {
  const { taskId, nodeId, instruction } = Params.parse(raw)
  await rerunPhase(taskId, nodeId, instruction)
  return { ok: true }
})
