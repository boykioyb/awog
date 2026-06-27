// gh.comment → post a comment on an issue/PR (ADR 0049). cwd = project.path
// (server-loaded). `number` is an int and `body` is passed as a single arg (arg
// array, NO shell string) so its content can never be interpreted as flags or
// shell syntax. gh prints the created comment URL to stdout → returned trimmed.
//
// On gh failure, runGh throws the same RpcError envelope (GH_RPC_CODE + ghCode)
// the other gh methods use; stderr is token-stripped in the runner.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGh } from '../github/runner.js'
import { resolveProjectCwd } from '../github/project-cwd.js'

const Params = z.object({
  projectId: z.string().min(1),
  kind: z.enum(['issue', 'pr']),
  number: z.number().int().positive(),
  body: z.string().min(1).max(65_536),
  account: z.string().optional(),
  // Child repo of a multi-repo workspace (relativePath from git.discoverRepos).
  repoPath: z.string().optional(),
})

interface Result {
  url: string
}

register('gh.comment', async (raw): Promise<Result> => {
  const params = Params.parse(raw)

  const body = params.body.trim()
  if (!body) {
    throw new RpcError(-32602, 'comment body must not be empty')
  }

  const cwd = await resolveProjectCwd(params.projectId, params.repoPath)
  const kindArg = params.kind === 'pr' ? 'pr' : 'issue'
  // `--body <body>` as separate args — body is never spliced into a shell string.
  const stdout = await runGh(
    [kindArg, 'comment', String(params.number), '--body', body],
    cwd,
    params.account,
  )
  return { url: stdout.trim() }
})
