// `git.stashSave` — `git stash push [-u] -m <message>`. Per ADR 0017 + spec
// AC-23. Workspace clean → INVALID_PATH-style refusal (clear UI signal).
// Arg array keeps the message safe even when it contains spaces / quotes.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  message: z.string().min(1),
  includeUntracked: z.boolean().optional(),
})

interface Result {
  ok: true
  index: number
}

register('git.stashSave', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const trimmed = params.message.trim()
  if (trimmed.length === 0) {
    throw new RpcError(GIT_RPC_CODE, 'Stash message không được rỗng', {
      gitCode: GitErrorCode.INVALID_PATH,
    })
  }

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    const args = ['stash', 'push']
    if (params.includeUntracked) args.push('-u')
    args.push('-m', trimmed)

    const r = await runGit(params.workspaceRoot, args, { throwOnNonZero: false })
    if (r.code !== 0) {
      throw new RpcError(GIT_RPC_CODE, r.stderr.trim() || 'git stash push thất bại', {
        gitCode: GitErrorCode.UNKNOWN,
      })
    }
    // `git stash push` prints "No local changes to save" with exit 0 when the
    // tree is clean — surface as a structured refusal so UI can act on it.
    if (/no local changes to save/i.test(r.stdout)) {
      throw new RpcError(GIT_RPC_CODE, 'No local changes to save', {
        gitCode: GitErrorCode.INVALID_PATH,
      })
    }

    // Newest stash is always stash@{0}; resolve numerically for the response.
    const head = await runGit(params.workspaceRoot, [
      'stash',
      'list',
      '-n',
      '1',
      '--format=%gd',
    ])
    const match = head.stdout.trim().match(/^stash@\{(\d+)\}$/)
    const index = match ? Number.parseInt(match[1] as string, 10) : 0

    emit('git:status:changed', { reason: 'stash', workspaceRoot: params.workspaceRoot })
    return { ok: true as const, index }
  })
})
