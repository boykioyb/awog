import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { discussPhase } from '../tasks/engine.js'

const Params = z.object({
  taskId: z.string().min(1),
  nodeId: z.string().min(1),
  runVersion: z.number(),
  text: z.string().min(1),
})

register('tasks.discuss', async (raw) => {
  const { taskId, nodeId, runVersion, text } = Params.parse(raw)
  // Fire the Q&A turn without blocking the RPC — the reply streams via
  // task.message events.
  void discussPhase(taskId, nodeId, runVersion, text)
  return { ok: true }
})
