import { z } from 'zod'
import { mkdir } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'

// Create a directory (recursive) for the Project workspace explorer (ADR 0022).
// Every resolved segment stays inside workspaceRoot — assertInsideWorkspace
// validates the final path, and intermediate dirs are by definition inside it.
// Security invariant #2.

const Params = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
})

register('fs.createDir', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  if (!isAbsolute(params.workspaceRoot)) {
    throw new RpcError(-32602, 'workspaceRoot must be absolute')
  }
  const abs = assertInsideWorkspace(params.workspaceRoot, params.path)

  await mkdir(abs, { recursive: true })
  return { ok: true }
})
