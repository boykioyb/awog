// `git.discardFile` — destructively reverts the working tree.
//   - Tracked file: `git checkout -- <path>` (universal, no Git 2.23 dep).
//   - Untracked file: `fs.unlink` (checkout has no effect on untracked).
// Classifies via `git status --porcelain=v2 -z` so we only have to spawn once
// to learn the kind, then issue at most one checkout and one rm.
import { unlink } from 'node:fs/promises'
import { relative } from 'node:path'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
})

interface Resolved {
  rel: string
  abs: string
}

// Parse porcelain v2 -z entries to find which of the given paths are untracked
// (`? path\0`). All other recognized entries (1/2/u) are treated as tracked.
function classifyUntracked(stdout: string, candidates: Resolved[]): Set<string> {
  const untracked = new Set<string>()
  const tokens = stdout.split('\0')
  let i = 0
  while (i < tokens.length) {
    const line = tokens[i]
    if (!line) {
      i += 1
      continue
    }
    if (line.startsWith('# ')) {
      i += 1
      continue
    }
    if (line.startsWith('? ')) {
      untracked.add(line.slice(2))
      i += 1
      continue
    }
    if (line.startsWith('2 ')) {
      // Renamed entry: format `2 XY ... <path>\0<origPath>\0` — skip the
      // extra origPath token that follows.
      i += 2
      continue
    }
    // 1, u, !, anything else: single-token entry.
    i += 1
  }
  // Restrict to the rel paths we actually care about.
  const wanted = new Set(candidates.map((c) => c.rel))
  return new Set([...untracked].filter((p) => wanted.has(p)))
}

register('git.discardFile', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  const resolved: Resolved[] = params.paths.map((p) => {
    const abs = assertInsideWorkspace(params.workspaceRoot, p)
    return { abs, rel: relative(params.workspaceRoot, abs) || '.' }
  })

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)
    const statusArgs = [
      'status',
      '--porcelain=v2',
      '-z',
      '--untracked-files=all',
      '--',
      ...resolved.map((r) => r.rel),
    ]
    const statusOut = await runGit(params.workspaceRoot, statusArgs)
    const untrackedSet = classifyUntracked(statusOut.stdout, resolved)

    const tracked = resolved.filter((r) => !untrackedSet.has(r.rel))
    const untracked = resolved.filter((r) => untrackedSet.has(r.rel))

    if (tracked.length > 0) {
      await runGit(params.workspaceRoot, ['checkout', '--', ...tracked.map((r) => r.rel)])
    }
    // Untracked files are not under git's control; remove directly. Path was
    // already validated via assertInsideWorkspace so this is workspace-scoped.
    for (const u of untracked) {
      // eslint-disable-next-line no-await-in-loop -- sequential to surface the
      // first failure with a clear path in stderr; the list is short (UI-driven).
      await unlink(u.abs).catch(() => undefined)
    }
  })

  emit('git:status:changed', { reason: 'discard', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
