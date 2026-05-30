// `git.stageFile` — `git add -- <paths>`. Multi-path safe (zod min(1)).
// Per ADR 0017: validate path inside workspace, hold workspace mutex, suppress
// the watcher echo, then emit `git:status:changed` so UI refreshes once.
import { relative } from 'node:path'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
})

register('git.stageFile', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  const relPaths = params.paths.map((p) => {
    const abs = assertInsideWorkspace(params.workspaceRoot, p)
    return relative(params.workspaceRoot, abs) || '.'
  })

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    await runGit(params.workspaceRoot, ['add', '--', ...relPaths])
  })

  emit('git:status:changed', { reason: 'stage', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
