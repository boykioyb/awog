import { z } from 'zod'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { workspaceFsWatcher } from '../fs-watcher.js'
import { listProjects } from '../projects/store.js'

// Start watching a project workspace tree (ADR 0022). Ref-counted: multiple
// callers (e.g. re-opens) share one chokidar watcher. fs.unwatch releases it.
//
// Least-privilege (infosec F3): the watcher enumerates an entire tree, so the
// root must be (a) an existing directory and (b) a registered AWOG project —
// not any absolute path the UI hands us. Otherwise a buggy/compromised UI could
// stream the file structure of e.g. /Users/<other> back to the renderer.

const Params = z.object({
  workspaceRoot: z.string().min(1),
})

register('fs.watch', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  if (!isAbsolute(params.workspaceRoot)) {
    throw new RpcError(-32602, 'workspaceRoot must be absolute')
  }

  const st = await stat(params.workspaceRoot).catch(() => null)
  if (!st || !st.isDirectory()) {
    throw new RpcError(-32602, 'workspaceRoot is not a directory')
  }

  const projects = await listProjects().catch(() => [])
  if (!projects.some((p) => p.path === params.workspaceRoot)) {
    throw new RpcError(-32602, 'workspaceRoot is not a registered project')
  }

  await workspaceFsWatcher.watch(params.workspaceRoot)
  return { ok: true }
})
