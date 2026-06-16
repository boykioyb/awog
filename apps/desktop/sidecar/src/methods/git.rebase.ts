// `git.rebase` — replay the current branch onto another ref (non-interactive).
// Conflicts surface as the MERGE_CONFLICT envelope; the UI then finalizes via
// `git.rebaseContinue` / `git.rebaseAbort` (not `git commit`). Per ADR 0040.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode, sanitizeStderr } from '../git/error-map.js'
import { emit } from '../transport/stdio.js'

const SAFE_REF_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/

const Params = z.object({
  workspaceRoot: z.string().min(1),
  onto: z.string().min(1),
})

interface Result {
  ok: true
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

register('git.rebase', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  if (!SAFE_REF_RE.test(params.onto)) {
    throw new RpcError(GIT_RPC_CODE, 'Invalid ref', { gitCode: GitErrorCode.INVALID_REF })
  }

  return withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    try {
      await runGit(params.workspaceRoot, ['rebase', params.onto])
    } catch (err) {
      const data = (err as RpcError).data as { stderrSanitized?: string } | undefined
      const stderr = data?.stderrSanitized ?? ''
      if (/CONFLICT/i.test(stderr) || /could not apply/i.test(stderr) || /resolve all conflicts/i.test(stderr)) {
        const files = await getConflictedFiles(params.workspaceRoot)
        throw new RpcError(GIT_RPC_CODE, 'Rebase conflict', {
          gitCode: GitErrorCode.MERGE_CONFLICT,
          files,
          rebase: true,
          stderrSanitized: sanitizeStderr(stderr),
        })
      }
      throw err
    }

    const head = await runGit(params.workspaceRoot, ['rev-parse', 'HEAD'])
    const sha = head.stdout.trim()
    const sha7 = sha.slice(0, 7)
    emit('git:status:changed', { reason: 'commit', workspaceRoot: params.workspaceRoot })
    return { ok: true, sha, sha7 }
  })
})
