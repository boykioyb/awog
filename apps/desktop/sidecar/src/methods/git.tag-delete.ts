// `git.tagDelete` — delete a tag (`git tag -d <name>`). Mirrors tagCreate:
// validate the name server-side, hold the workspace mutex, suppress the echo
// loop, and emit status-changed with reason `external` (only refs/tags/* moves;
// the working tree is untouched).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { assertValidBranchName } from '../git/ref-validate.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  name: z.string().min(1),
})

register('git.tagDelete', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  // Tag names follow the same character rules as branch names — defense in
  // depth so we never spawn `git` with an attacker-controlled token.
  assertValidBranchName(params.name)

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    await runGit(params.workspaceRoot, ['tag', '-d', params.name])
  })

  emit('git:status:changed', { reason: 'external', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
