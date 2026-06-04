import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { approvePhase } from '../tasks/engine.js'

const Params = z.object({ taskId: z.string().min(1), nodeId: z.string().min(1) })

register('tasks.approvePhase', async (raw) => {
  const { taskId, nodeId } = Params.parse(raw)
  await approvePhase(taskId, nodeId)
  return { ok: true }
})
