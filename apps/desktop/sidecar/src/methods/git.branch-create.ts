// `git.branchCreate` — create a new branch off `from` (default HEAD), optionally
// checking it out. Per ADR 0017: validate ref names server-side (defense in
// depth; UI also validates), hold mutex, suppress echo, emit status-changed.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { assertValidBranchName, assertValidFromRef } from '../git/ref-validate.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  name: z.string().min(1),
  from: z.string().min(1).optional(),
  checkout: z.boolean().optional(),
})

register('git.branchCreate', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  assertValidBranchName(params.name)
  if (params.from !== undefined) assertValidFromRef(params.from)

  const shouldCheckout = params.checkout ?? true

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    if (shouldCheckout) {
      const args = ['checkout', '-b', params.name]
      if (params.from !== undefined) args.push(params.from)
      await runGit(params.workspaceRoot, args)
    } else {
      const args = ['branch', params.name]
      if (params.from !== undefined) args.push(params.from)
      await runGit(params.workspaceRoot, args)
    }
  })

  // `checkout` reason when HEAD moves; otherwise `external` (refs changed but
  // working tree is intact). Keeps the watcher event taxonomy honest.
  emit('git:status:changed', {
    reason: shouldCheckout ? 'checkout' : 'external',
    workspaceRoot: params.workspaceRoot,
  })
  return { ok: true }
})
