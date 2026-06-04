import { z } from 'zod'
import { isAbsolute } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { workspaceFsWatcher } from '../fs-watcher.js'

// Release a project workspace watcher started by fs.watch (ADR 0022).

const Params = z.object({
  workspaceRoot: z.string().min(1),
})

register('fs.unwatch', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  if (!isAbsolute(params.workspaceRoot)) {
    throw new RpcError(-32602, 'workspaceRoot must be absolute')
  }
  await workspaceFsWatcher.unwatch(params.workspaceRoot)
  return { ok: true }
})
