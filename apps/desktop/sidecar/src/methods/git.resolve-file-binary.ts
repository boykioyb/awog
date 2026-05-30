// `git.resolveFileBinary` — file-level pick for binary conflicts. Uses
// `git checkout --ours / --theirs -- <path>` to materialise the chosen
// version then stages it. Per ADR 0017 + spec "Binary conflict" section.
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
  path: z.string().min(1),
  choice: z.enum(['ours', 'theirs']),
})

register('git.resolveFileBinary', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  const abs = assertInsideWorkspace(params.workspaceRoot, params.path)
  const rel = relative(params.workspaceRoot, abs) || '.'
  const flag = params.choice === 'ours' ? '--ours' : '--theirs'

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    await runGit(params.workspaceRoot, ['checkout', flag, '--', rel])
    await runGit(params.workspaceRoot, ['add', '--', rel])
  })

  emit('git:status:changed', { reason: 'stage', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
