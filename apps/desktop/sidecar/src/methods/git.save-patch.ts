// `git.savePatch` — capture a `git diff` of the working tree (or one path) and
// write it to `<workspaceRoot>/<base>.patch`. Read of the repo + write of a new
// untracked file only; no mutex needed (doesn't mutate the repo). Echo
// suppression is skipped — the new `.patch` shows up as an untracked file, which
// is acceptable. Security invariant #2: both the optional diff path and the
// output path are gated by assertInsideWorkspace; git is always spawned with an
// arg array (never a shell string), with `path` passed after `--`.
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().optional(),
})

interface Result {
  ok: true
  path: string
}

register('git.savePatch', async (raw): Promise<Result> => {
  const params = Params.parse(raw)

  const args = ['diff']
  let base = 'working-tree'
  if (params.path !== undefined) {
    // Validate the diff target is inside the workspace before passing it through.
    assertInsideWorkspace(params.workspaceRoot, params.path)
    base = basename(params.path) || 'working-tree'
    args.push('--', params.path)
  }

  // Patches for large diffs can exceed the default buffer when binary content
  // is present — bump like git.formatPatch.
  const r = await runGit(params.workspaceRoot, args, { maxBuffer: 64 * 1024 * 1024 })

  // Resolve + validate the output path inside the workspace.
  const outPath = assertInsideWorkspace(params.workspaceRoot, `${base}.patch`)
  await writeFile(outPath, r.stdout, 'utf8')
  return { ok: true, path: outPath }
})
