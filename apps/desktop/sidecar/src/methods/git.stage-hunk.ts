// `git.stageHunk` — stage một hunk đơn lẻ của một file (AC-04).
//
// Cơ chế:
//   1. Lấy unified diff hiện tại của file (`git diff --no-color --find-renames -- <relPath>`).
//   2. Parse qua `parseUnifiedDiff` để lấy `GitFileDiff[0].hunks[hunkIndex]`.
//   3. Build patch tối thiểu chứa header file + chỉ hunk đó.
//   4. `git apply --cached --recount -` qua stdin.
//
// Patch line endings dùng `\n` thuần (POSIX); git apply tự normalize theo
// `core.autocrlf` của repo. Hunk thuần text — không hỗ trợ binary hunk
// (binary diff không có hunk index theo nghĩa thông thường).
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
import type { GitDiffHunk, GitDiffLine } from '../git/types.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
  hunkIndex: z.number().int().min(0),
})

// Tái dựng raw diff line từ GitDiffLine. `noeol` giữ nguyên marker.
function diffLineToRaw(line: GitDiffLine): string {
  if (line.kind === 'noeol') return line.content
  const prefix = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '
  return `${prefix}${line.content}`
}

function buildPatch(relPath: string, hunk: GitDiffHunk): string {
  const header = [
    `diff --git a/${relPath} b/${relPath}`,
    `--- a/${relPath}`,
    `+++ b/${relPath}`,
    hunk.header,
  ]
  const body = hunk.lines.map(diffLineToRaw)
  // Trailing newline cần thiết để `git apply` chấp nhận patch.
  return `${[...header, ...body].join('\n')}\n`
}

register('git.stageHunk', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  const abs = assertInsideWorkspace(params.workspaceRoot, params.path)
  const relPath = relative(params.workspaceRoot, abs) || '.'

  await withWorkspaceLock(params.workspaceRoot, async () => {
    // Bước 1: lấy diff hiện tại.
    const diffResult = await runGit(params.workspaceRoot, [
      'diff',
      '--no-color',
      '--find-renames',
      '--',
      relPath,
    ])
    const files = parseUnifiedDiff(diffResult.stdout)
    const file = files[0]
    if (!file) {
      throw new RpcError(GIT_RPC_CODE, 'Không có diff cho file', {
        gitCode: GitErrorCode.INVALID_PATH,
        reason: 'no-diff',
      })
    }
    if (file.isBinary) {
      throw new RpcError(GIT_RPC_CODE, 'Stage hunk không hỗ trợ binary file', {
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

    // Bước 2-3: build patch + apply qua stdin.
    const patch = buildPatch(relPath, hunk)
    suppressEchoFor(params.workspaceRoot)
    await runGit(params.workspaceRoot, ['apply', '--cached', '--recount', '-'], {
      stdin: patch,
    })
  })

  emit('git:status:changed', { reason: 'stage', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
