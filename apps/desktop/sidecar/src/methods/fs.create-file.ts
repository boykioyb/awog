import { z } from 'zod'
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'

// Create an empty file for the Project workspace explorer (ADR 0022). Uses the
// exclusive `wx` flag so an existing file is never silently clobbered — the UI
// gets a clear error instead. Security invariant #2: path gated by
// assertInsideWorkspace.

const Params = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
})

register('fs.createFile', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  if (!isAbsolute(params.workspaceRoot)) {
    throw new RpcError(-32602, 'workspaceRoot must be absolute')
  }
  const abs = assertInsideWorkspace(params.workspaceRoot, params.path)

  try {
    const handle = await open(abs, 'wx')
    await handle.close()
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') throw new RpcError(-32602, 'File already exists')
    throw err
  }
  return { ok: true }
})
