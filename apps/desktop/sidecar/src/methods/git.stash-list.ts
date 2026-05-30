import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { parseStashList } from '../git/parser.js'
import type { GitStashEntry } from '../git/types.js'

const Params = z.object({ workspaceRoot: z.string().min(1) })

const STASH_FORMAT = '%gd%x00%H%x00%cI%x00%gs%x1e'

interface Result {
  stashes: GitStashEntry[]
}

register('git.stashList', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const r = await runGit(params.workspaceRoot, ['stash', 'list', `--format=${STASH_FORMAT}`])
  return { stashes: parseStashList(r.stdout) }
})
