// `git.merge` — merge a branch into the current HEAD. Conflicts surface as the
// standard MERGE_CONFLICT envelope so the UI routes into the conflict resolver
// (same shape as `git.cherryPick`). Per ADR 0040.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode, sanitizeStderr } from '../git/error-map.js'
import { emit } from '../transport/stdio.js'

// Allowlist for refs coming from the UI: typical git-ref chars only, no leading
// dash (option injection) and no `..` (range/traversal). Args go through an
// array (never a shell string), so this is defense in depth.
const SAFE_REF_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/

const Params = z.object({
  workspaceRoot: z.string().min(1),
  branch: z.string().min(1),
})

interface Result {
  ok: true
  fastForward: boolean
  sha: string
  sha7: string
}

const NUL = String.fromCharCode(0)

function parseConflictedFiles(porcelain: string): string[] {
  const out: string[] = []
  for (const entry of porcelain.split(NUL)) {
    if (!entry.startsWith('u ')) continue
    const lastSpace = entry.lastIndexOf(' ')
    if (lastSpace > 0) out.push(entry.slice(lastSpace + 1))
  }
  return out
}

async function getConflictedFiles(workspaceRoot: string): Promise<string[]> {
  try {
    const r = await runGit(
      workspaceRoot,
      ['status', '--porcelain=v2', '-z', '--untracked-files=no'],
      { throwOnNonZero: false },
    )
    return parseConflictedFiles(r.stdout)
  } catch {
    return []
  }
}

register('git.merge', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  if (!SAFE_REF_RE.test(params.branch)) {
    throw new RpcError(GIT_RPC_CODE, 'Invalid branch ref', { gitCode: GitErrorCode.INVALID_REF })
  }

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    let fastForward = false
    try {
      // `--no-edit` keeps the default merge-commit message (never opens an editor
      // that would hang the headless git process).
      const r = await runGit(params.workspaceRoot, ['merge', '--no-edit', params.branch])
      fastForward = /fast-forward/i.test(r.stdout)
    } catch (err) {
      const data = (err as RpcError).data as { stderrSanitized?: string } | undefined
      const stderr = data?.stderrSanitized ?? ''
      if (/CONFLICT/i.test(stderr) || /automatic merge failed/i.test(stderr)) {
        const files = await getConflictedFiles(params.workspaceRoot)
        throw new RpcError(GIT_RPC_CODE, 'Merge conflict', {
          gitCode: GitErrorCode.MERGE_CONFLICT,
          files,
          stderrSanitized: sanitizeStderr(stderr),
        })
      }
      throw err
    }

    const head = await runGit(params.workspaceRoot, ['rev-parse', 'HEAD'])
    const sha = head.stdout.trim()
    const sha7 = sha.slice(0, 7)
    emit('git:status:changed', { reason: 'commit', workspaceRoot: params.workspaceRoot })
    return { ok: true, fastForward, sha, sha7 }
  })
})
