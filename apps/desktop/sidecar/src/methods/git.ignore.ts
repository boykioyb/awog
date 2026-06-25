// `git.ignore` — append patterns to `<workspaceRoot>/.gitignore`, deduping
// against lines already present. Only mutates a workspace file (not the repo
// itself) so no echo suppression is strictly required, but we suppress + emit
// status-changed so the UI refreshes immediately. Security invariant #2: the
// target path is resolved via assertInsideWorkspace so it can never escape the
// workspace; patterns are validated at the boundary (no newline injection).
import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { emit } from '../transport/stdio.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  patterns: z
    .array(z.string().min(1).refine((s) => !s.includes('\n'), 'pattern must not contain newline'))
    .min(1)
    .max(50),
})

register('git.ignore', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  // Guarantees the resolved path is `<workspaceRoot>/.gitignore` and rejects any
  // symlink/traversal escape before we touch the filesystem.
  const gitignorePath = assertInsideWorkspace(params.workspaceRoot, '.gitignore')

  await withWorkspaceLock(params.workspaceRoot, async () => {
    let existing = ''
    try {
      existing = await readFile(gitignorePath, 'utf8')
    } catch (err) {
      // Missing file → treat as empty; any other error propagates.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }

    const present = new Set(existing.split('\n').map((l) => l.trim()))
    const toAppend = params.patterns.filter((p) => !present.has(p.trim()))
    if (toAppend.length === 0) return // everything already ignored

    // Normalize: ensure the existing content ends with a newline before we
    // append, and the file ends with a trailing newline after.
    let next = existing
    if (next.length > 0 && !next.endsWith('\n')) next += '\n'
    next += toAppend.join('\n') + '\n'

    suppressEchoFor(params.workspaceRoot)
    await writeFile(gitignorePath, next, 'utf8')
  })

  emit('git:status:changed', { reason: 'external', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
