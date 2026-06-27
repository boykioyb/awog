// gh.review → submit a PR review (approve / comment / request-changes). cwd =
// project.path (server-loaded). `number` is an int and `body` is a single arg (arg
// array, NO shell string) so its content can never be parsed as flags/shell.
// `approve` may omit the body; the other events require one. On gh failure runGh
// throws the same RpcError envelope (GH_RPC_CODE + ghCode) the other gh methods use
// — e.g. approving your own PR / a closed PR surfaces as a normal error.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGh } from '../github/runner.js'
import { resolveProjectCwd } from '../github/project-cwd.js'

const Params = z.object({
  projectId: z.string().min(1),
  number: z.number().int().positive(),
  event: z.enum(['approve', 'comment', 'request-changes']),
  body: z.string().max(65536).optional(),
  account: z.string().optional(),
  repoPath: z.string().optional(),
})

const EVENT_FLAG = {
  approve: '--approve',
  comment: '--comment',
  'request-changes': '--request-changes',
} as const

register('gh.review', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  const body = (params.body ?? '').trim()
  // comment / request-changes require a body; approve may stand alone.
  if (params.event !== 'approve' && !body) {
    throw new RpcError(-32602, `${params.event} requires a body`)
  }
  const cwd = await resolveProjectCwd(params.projectId, params.repoPath)
  const args = ['pr', 'review', String(params.number), EVENT_FLAG[params.event]]
  if (body) args.push('--body', body)
  await runGh(args, cwd, params.account)
  return { ok: true }
})
