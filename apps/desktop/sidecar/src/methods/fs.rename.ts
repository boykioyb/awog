import { z } from 'zod'
import { rename, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'

// Rename / move a file or directory inside the Project workspace (ADR 0022).
// BOTH endpoints are gated by assertInsideWorkspace — a move can't smuggle a
// path out of the workspace via `toPath`. Refuses to overwrite an existing
// target and refuses to rename the workspace root itself. Security invariant #2.

const Params = z.object({
  workspaceRoot: z.string().min(1),
  fromPath: z.string().min(1),
  toPath: z.string().min(1),
})

register('fs.rename', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  if (!isAbsolute(params.workspaceRoot)) {
    throw new RpcError(-32602, 'workspaceRoot must be absolute')
  }
  const root = resolve(params.workspaceRoot)
  const absFrom = assertInsideWorkspace(params.workspaceRoot, params.fromPath)
  const absTo = assertInsideWorkspace(params.workspaceRoot, params.toPath)

  if (absFrom === root) throw new RpcError(-32602, 'Cannot rename the workspace root')
  // Don't let a rename move/clobber the repo metadata (infosec F5).
  if (
    params.fromPath.split(/[\\/]+/)[0] === '.git' ||
    params.toPath.split(/[\\/]+/)[0] === '.git'
  ) {
    throw new RpcError(-32602, 'Refusing to rename .git')
  }
  if (absFrom === absTo) return { ok: true }

  // Don't clobber an existing target.
  try {
    await stat(absTo)
    throw new RpcError(-32602, 'Target already exists')
  } catch (err) {
    if (err instanceof RpcError) throw err
    // ENOENT — target free, proceed.
  }

  await rename(absFrom, absTo)
  return { ok: true }
})
