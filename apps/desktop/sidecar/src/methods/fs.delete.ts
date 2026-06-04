import { z } from 'zod'
import { rm, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'

// Delete a file or directory inside the Project workspace (ADR 0022). Refuses to
// delete the workspace root. A non-empty directory requires `recursive: true`
// (the UI confirms first). Security invariant #2: path gated by
// assertInsideWorkspace. Hard delete in MVP; move-to-trash is a future option.

const Params = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
  recursive: z.boolean().optional(),
})

register('fs.delete', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  if (!isAbsolute(params.workspaceRoot)) {
    throw new RpcError(-32602, 'workspaceRoot must be absolute')
  }
  const root = resolve(params.workspaceRoot)
  const abs = assertInsideWorkspace(params.workspaceRoot, params.path)
  if (abs === root) throw new RpcError(-32602, 'Cannot delete the workspace root')
  // Don't let a "code editor" nuke the repo metadata (infosec F5).
  if (params.path.split(/[\\/]+/)[0] === '.git') {
    throw new RpcError(-32602, 'Refusing to delete .git')
  }

  const st = await stat(abs)
  if (st.isDirectory()) {
    await rm(abs, { recursive: params.recursive === true, force: false })
  } else {
    await rm(abs, { force: false })
  }
  return { ok: true }
})
