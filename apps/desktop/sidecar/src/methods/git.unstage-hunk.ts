// `git.unstageHunk` — unstage a single staged hunk (the inverse of git.stageHunk).
//
// Mechanism:
//   1. Take the STAGED diff of the file (`git diff --cached --no-color
//      --find-renames -- <relPath>`) = index vs HEAD.
//   2. Parse → pick `hunks[hunkIndex]`.
//   3. Build a minimal patch (file header + that hunk).
//   4. `git apply --cached --reverse --recount -` → reverse-applies the hunk to
//      the index, removing just that staged change (file stays modified in the
//      working tree). Per the partial-staging UX.
import { relative } from 'node:path'
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { parseUnifiedDiff } from '../git/parser.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { emit } from '../transport/stdio.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { buildHunkPatch } from '../git/hunk-patch.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
  hunkIndex: z.number().int().min(0),
})

register('git.unstageHunk', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  const abs = assertInsideWorkspace(params.workspaceRoot, params.path)
  const relPath = relative(params.workspaceRoot, abs) || '.'

  await withWorkspaceLock(params.workspaceRoot, async () => {
    const diffResult = await runGit(params.workspaceRoot, [
      'diff',
      '--cached',
      '--no-color',
      '--find-renames',
      '--',
      relPath,
    ])
    const files = parseUnifiedDiff(diffResult.stdout)
    const file = files[0]
    if (!file) {
      throw new RpcError(GIT_RPC_CODE, 'Không có diff staged cho file', {
        gitCode: GitErrorCode.INVALID_PATH,
        reason: 'no-diff',
      })
    }
    if (file.isBinary) {
      throw new RpcError(GIT_RPC_CODE, 'Unstage hunk không hỗ trợ binary file', {
        gitCode: GitErrorCode.INVALID_PATH,
        reason: 'binary',
      })
    }
    const hunk = file.hunks[params.hunkIndex]
    if (!hunk) {
      throw new RpcError(GIT_RPC_CODE, 'hunkIndex out of range', {
        gitCode: GitErrorCode.INVALID_REF,
        reason: 'hunk-out-of-range',
        hunkIndex: params.hunkIndex,
        hunkCount: file.hunks.length,
      })
    }

    const patch = buildHunkPatch(relPath, hunk)
    suppressEchoFor(params.workspaceRoot)
    await runGit(params.workspaceRoot, ['apply', '--cached', '--reverse', '--recount', '-'], {
      stdin: patch,
    })
  })

  emit('git:status:changed', { reason: 'unstage', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
