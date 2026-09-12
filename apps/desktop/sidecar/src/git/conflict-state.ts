// One place that answers "is the repo mid-conflict, and from what?".
//
// This used to live as six near-identical copies of `getConflictedFiles` plus six
// hand-rolled "is this error a conflict?" regexes — and the copies drifted: the
// one in `git.merge.ts` matched on stderr, but `git merge` prints its CONFLICT
// lines to STDOUT and leaves stderr empty, so every merge conflict escaped as
// gitCode UNKNOWN and the UI never opened the resolver. Git output is also
// localised (LANG/LC_ALL are passed through to the child), so matching English
// text was never going to hold.
//
// The rule here: never classify a conflict by reading a message. Ask the index —
// an unmerged entry exists only after a conflicting merge/rebase/cherry-pick/
// revert/stash-apply — and ask `.git/` which operation is in flight.
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { runGit } from './runner.js'
import { GIT_RPC_CODE, GitErrorCode, sanitizeStderr } from './error-map.js'
import { RpcError } from '../transport/rpc.js'

const NUL = String.fromCharCode(0)

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** Paths with an unmerged index entry. Empty when the tree is not conflicted. */
export async function conflictedFiles(workspaceRoot: string): Promise<string[]> {
  try {
    const r = await runGit(
      workspaceRoot,
      ['status', '--porcelain=v2', '-z', '--untracked-files=no'],
      { throwOnNonZero: false },
    )
    const out: string[] = []
    for (const entry of r.stdout.split(NUL)) {
      if (!entry.startsWith('u ')) continue
      const lastSpace = entry.lastIndexOf(' ')
      if (lastSpace > 0) out.push(entry.slice(lastSpace + 1))
    }
    return out
  } catch {
    return []
  }
}

/** The multi-step operation git is in the middle of, if any. */
export type GitPendingOp = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

export async function pendingOpOf(workspaceRoot: string): Promise<GitPendingOp | null> {
  const gitDir = join(workspaceRoot, '.git')
  const [merge, rebaseMerge, rebaseApply, cherry, revert] = await Promise.all([
    exists(join(gitDir, 'MERGE_HEAD')),
    exists(join(gitDir, 'rebase-merge')),
    exists(join(gitDir, 'rebase-apply')),
    exists(join(gitDir, 'CHERRY_PICK_HEAD')),
    exists(join(gitDir, 'REVERT_HEAD')),
  ])
  // Rebase first: its own step can leave a MERGE_HEAD behind, and "you are
  // rebasing" is the state the user has to act on.
  if (rebaseMerge || rebaseApply) return 'rebase'
  if (merge) return 'merge'
  if (cherry) return 'cherry-pick'
  if (revert) return 'revert'
  return null
}

/**
 * Turn a failed git invocation into the MERGE_CONFLICT envelope the UI routes on
 * — or null when the failure was something else (dirty tree, bad ref, …), which
 * the caller must rethrow untouched.
 */
export async function asConflictError(
  workspaceRoot: string,
  err: unknown,
  message: string,
  extra?: Record<string, unknown>,
): Promise<RpcError | null> {
  const files = await conflictedFiles(workspaceRoot)
  if (files.length === 0) return null
  const data = (err as RpcError | undefined)?.data as { stderrSanitized?: string } | undefined
  return new RpcError(GIT_RPC_CODE, message, {
    gitCode: GitErrorCode.MERGE_CONFLICT,
    files,
    ...extra,
    stderrSanitized: sanitizeStderr(data?.stderrSanitized ?? ''),
  })
}
