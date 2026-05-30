import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { parseRemoteV } from '../git/parser.js'
import type { GitRemote } from '../git/types.js'

const Params = z.object({ workspaceRoot: z.string().min(1) })

interface Result {
  remotes: GitRemote[]
}

register('git.remoteList', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const r = await runGit(params.workspaceRoot, ['remote', '-v'])
  return { remotes: parseRemoteV(r.stdout) }
})
