import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { DevServerError, stopDevServer } from '../devserver/registry.js'
import { resolveProjectRoot } from '../devserver/project.js'

// Dừng một dev server theo tên (giết cả process group qua bg-registry).
const Params = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  name: z.string().min(1).max(64),
})

register('devserver.stop', async (raw) => {
  const { projectId, sessionId, name } = Params.parse(raw)
  const projectRoot = await resolveProjectRoot(projectId)
  try {
    return { server: await stopDevServer({ projectRoot, sessionId, name }) }
  } catch (err) {
    if (err instanceof DevServerError) throw new RpcError(-32602, err.message)
    throw err
  }
})
