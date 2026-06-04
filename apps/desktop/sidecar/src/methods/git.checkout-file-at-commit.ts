// `git.checkoutFileAtCommit` — per-file revert: `git checkout <ref> -- <path>`.
// Stages the file at that commit's version. Used by AC Flow 6 ("revert this
// file to version before commit"). Path sanitized; ref validated.
import { relative } from 'node:path'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { assertValidGenericRef } from '../git/ref-validate.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
  ref: z.string().min(1),
})

register('git.checkoutFileAtCommit', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  assertValidGenericRef(params.ref)
  const abs = assertInsideWorkspace(params.workspaceRoot, params.path)
  const rel = relative(params.workspaceRoot, abs) || '.'

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    await runGit(params.workspaceRoot, ['checkout', params.ref, '--', rel])
  })

  // `git checkout <ref> -- <path>` updates index + worktree for that path —
  // mirror staging semantics for the watcher event.
  emit('git:status:changed', { reason: 'stage', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
