// `git.init` — khởi tạo repo Git trống tại workspaceRoot.
//
// Flow:
//   1. Validate workspaceRoot tồn tại + chưa có `.git/`.
//   2. `git init`.
//   3. `git config core.autocrlf <input|true>` theo platform.
//   4. Emit `git:status:changed` để UI re-fetch.
//
// Không hold mutex (lock map theo workspace dùng `.git/` mà ta đang tạo —
// đầu tiên không có gì để serialize). Echo guard không cần vì watcher chưa
// attach (lazy-attach trong `git.status`).
import { access, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { emit } from '../transport/stdio.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
})

async function gitDirExists(workspaceRoot: string): Promise<boolean> {
  try {
    await access(join(workspaceRoot, '.git'))
    return true
  } catch {
    return false
  }
}

function platformAutocrlf(): 'true' | 'input' {
  return process.platform === 'win32' ? 'true' : 'input'
}

register('git.init', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)

  // Workspace dir phải tồn tại + là directory.
  try {
    const s = await stat(params.workspaceRoot)
    if (!s.isDirectory()) {
      throw new RpcError(GIT_RPC_CODE, 'Workspace path không phải directory', {
        gitCode: GitErrorCode.WORKSPACE_NOT_FOUND,
      })
    }
  } catch (err) {
    if (err instanceof RpcError) throw err
    throw new RpcError(GIT_RPC_CODE, 'Workspace không tồn tại', {
      gitCode: GitErrorCode.WORKSPACE_NOT_FOUND,
    })
  }

  if (await gitDirExists(params.workspaceRoot)) {
    throw new RpcError(GIT_RPC_CODE, 'Repo đã được initialized', {
      gitCode: GitErrorCode.INVALID_PATH,
      reason: 'already-initialized',
    })
  }

  await runGit(params.workspaceRoot, ['init'])
  await runGit(params.workspaceRoot, ['config', 'core.autocrlf', platformAutocrlf()])

  emit('git:status:changed', { reason: 'external', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
