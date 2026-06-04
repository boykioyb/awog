import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { parseForEachRef } from '../git/parser.js'
import type { GitBranch } from '../git/types.js'

const Params = z.object({ workspaceRoot: z.string().min(1) })

const REF_FORMAT =
  '%(refname)%00%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(objectname)%00%(contents:subject)%00%(committerdate:iso-strict)%1e'

interface Result {
  branches: GitBranch[]
}

register('git.branchList', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const r = await runGit(params.workspaceRoot, [
    'for-each-ref',
    `--format=${REF_FORMAT}`,
    'refs/heads',
    'refs/remotes',
  ])
  const branches = parseForEachRef(r.stdout)

  // Resolve current HEAD; tolerate detached state.
  let head = ''
  try {
    const sym = await runGit(params.workspaceRoot, ['symbolic-ref', '--short', 'HEAD'], {
      throwOnNonZero: false,
    })
    if (sym.code === 0) head = sym.stdout.trim()
  } catch {
    // ignore
  }
  if (head) {
    for (const b of branches) {
      if (b.kind === 'local' && b.name === head) b.isCurrent = true
    }
  }
  return { branches }
})
