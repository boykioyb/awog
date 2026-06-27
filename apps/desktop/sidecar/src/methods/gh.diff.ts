// gh.diff → the raw unified diff for a PR (ADR 0049). cwd = project.path
// (server-loaded). `number` is an int; nothing path-like from params reaches the
// args. Issues have no diff → `{ patch: '' }` without spawning gh.
//
// On gh failure, runGh throws the same RpcError envelope (GH_RPC_CODE + ghCode)
// the other gh methods use; stderr is token-stripped in the runner.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGh } from '../github/runner.js'
import { resolveProjectCwd } from '../github/project-cwd.js'

const Params = z.object({
  projectId: z.string().min(1),
  kind: z.enum(['issue', 'pr']),
  number: z.number().int().positive(),
  account: z.string().optional(),
  // Child repo of a multi-repo workspace (relativePath from git.discoverRepos).
  repoPath: z.string().optional(),
})

interface Result {
  patch: string
}

register('gh.diff', async (raw): Promise<Result> => {
  const params = Params.parse(raw)

  // Issues carry no diff — return empty without touching gh.
  if (params.kind === 'issue') return { patch: '' }

  const cwd = await resolveProjectCwd(params.projectId, params.repoPath)
  const patch = await runGh(['pr', 'diff', String(params.number)], cwd, params.account)
  return { patch }
})
