// `git.commit` — handles both normal commit and amend (flag-driven, per ADR
// 0017). Message is piped via stdin (`-F -`) to keep multi-line / unicode
// safe without shelling out.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  message: z.string(),
  amend: z.boolean().optional(),
  signoff: z.boolean().optional(),
})

interface Result {
  sha: string
  sha7: string
}

register('git.commit', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const trimmed = params.message.trim()
  if (trimmed.length === 0) {
    throw new RpcError(-32602, 'Commit message không được rỗng')
  }

  return withWorkspaceLock(params.workspaceRoot, async () => {
    // For non-amend, require at least one staged change. `diff --cached --quiet`
    // exits 0 (no change) / 1 (changes present) / other (error).
    if (!params.amend) {
      const check = await runGit(params.workspaceRoot, ['diff', '--cached', '--quiet'], {
        throwOnNonZero: false,
      })
      if (check.code === 0) {
        throw new RpcError(-32602, 'Không có change nào staged để commit')
      }
    }

    suppressEchoFor(params.workspaceRoot)
    const args = ['commit']
    if (params.amend) args.push('--amend')
    if (params.signoff) args.push('-s')
    args.push('-F', '-')
    await runGit(params.workspaceRoot, args, { stdin: trimmed })

    const head = await runGit(params.workspaceRoot, ['rev-parse', 'HEAD'])
    const sha = head.stdout.trim()
    const sha7 = sha.slice(0, 7)

    emit('git:status:changed', { reason: 'commit', workspaceRoot: params.workspaceRoot })
    return { sha, sha7 }
  })
})
