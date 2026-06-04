// `git.tagCreate` — create a tag (lightweight or annotated) at HEAD or at
// the provided sha. Per ADR 0017: validate ref name + sha server-side, hold
// mutex, suppress echo, emit status-changed with reason `external` because
// the working tree is untouched (only refs/tags/* changes).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { assertValidBranchName } from '../git/ref-validate.js'
import { emit } from '../transport/stdio.js'

const SHA_RE = /^[a-fA-F0-9]{4,40}$/

const Params = z.object({
  workspaceRoot: z.string().min(1),
  name: z.string().min(1),
  sha: z.string().optional(),
  message: z.string().optional(),
  annotated: z.boolean().optional(),
})

register('git.tagCreate', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  // Tag names follow the same character rules as branch names — defense in
  // depth even though `git tag` itself will refuse invalid names.
  assertValidBranchName(params.name)
  if (params.sha !== undefined && !SHA_RE.test(params.sha)) {
    throw new Error('Invalid sha for tag target')
  }

  const wantAnnotated = params.annotated === true || (params.message ?? '').trim().length > 0
  const message = params.message ?? ''

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    if (wantAnnotated) {
      // `-F -` piped via stdin keeps multi-line / unicode messages safe.
      const args = ['tag', '-a', params.name]
      if (params.sha !== undefined) args.push(params.sha)
      args.push('-F', '-')
      await runGit(params.workspaceRoot, args, { stdin: message })
    } else {
      const args = ['tag', params.name]
      if (params.sha !== undefined) args.push(params.sha)
      await runGit(params.workspaceRoot, args)
    }
  })

  emit('git:status:changed', { reason: 'external', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
