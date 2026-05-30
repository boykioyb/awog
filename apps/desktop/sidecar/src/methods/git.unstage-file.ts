// `git.unstageFile` — `git reset HEAD -- <paths>` (universal across Git
// versions; works pre-2.23 unlike `git restore --staged`). Per ADR 0017.
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

register('git.unstageFile', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  const relPaths = params.paths.map((p) => {
    const abs = assertInsideWorkspace(params.workspaceRoot, p)
    return relative(params.workspaceRoot, abs) || '.'
  })

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    // `reset HEAD -- <paths>` exits 1 when there is something to "unstage" but
    // the working tree differs; that's expected. We pass throwOnNonZero:false
    // to ignore the harmless exit code and inspect stderr only if needed.
    const r = await runGit(params.workspaceRoot, ['reset', 'HEAD', '--', ...relPaths], {
      throwOnNonZero: false,
    })
    if (r.code !== 0 && r.code !== 1) {
      // Code 0 = clean reset; code 1 = "unstaged changes after reset" (still
      // succeeded). Anything else is a real failure — re-run with throw so the
      // runner produces a proper RpcError envelope from stderr.
      await runGit(params.workspaceRoot, ['reset', 'HEAD', '--', ...relPaths])
    }
  })

  emit('git:status:changed', { reason: 'unstage', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
