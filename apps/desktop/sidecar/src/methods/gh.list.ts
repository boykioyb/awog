// gh.list → issue/pr list rows for a project's repo (ADR 0049). cwd =
// project.path (server-loaded). state is validated per kind; assignee is an
// optional server-side filter (`@me` or a validated login). account optionally
// selects a non-active gh account (token injected in the runner, never logged).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGh, isValidGhLogin } from '../github/runner.js'
import { resolveProjectCwd } from '../github/project-cwd.js'
import { parseThreadList, type GhThreadSummary } from '../github/thread.js'

const ISSUE_STATES = ['open', 'closed', 'all'] as const
const PR_STATES = ['open', 'closed', 'merged', 'all'] as const

const Params = z
  .object({
    projectId: z.string().min(1),
    kind: z.enum(['issue', 'pr']),
    state: z.string().min(1),
    assignee: z.string().optional(),
    account: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .superRefine((p, ctx) => {
    const allowed: readonly string[] = p.kind === 'pr' ? PR_STATES : ISSUE_STATES
    if (!allowed.includes(p.state)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['state'],
        message: `state must be one of ${allowed.join('|')} for kind=${p.kind}`,
      })
    }
    // assignee: '@me' or a GitHub login; empty/omitted = no filter.
    if (p.assignee !== undefined && p.assignee !== '' && p.assignee !== '@me') {
      if (!isValidGhLogin(p.assignee)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['assignee'], message: 'invalid assignee' })
      }
    }
  })

// Field sets per kind. Issues have no isDraft/baseRefName/headRefName.
const ISSUE_FIELDS = 'number,title,state,author,assignees,labels,createdAt,updatedAt'
const PR_FIELDS =
  'number,title,state,isDraft,author,assignees,labels,baseRefName,headRefName,createdAt,updatedAt'

interface Result {
  items: GhThreadSummary[]
}

register('gh.list', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const cwd = await resolveProjectCwd(params.projectId)

  const limit = params.limit ?? 50
  const fields = params.kind === 'pr' ? PR_FIELDS : ISSUE_FIELDS
  const args = [
    params.kind === 'pr' ? 'pr' : 'issue',
    'list',
    '--state',
    params.state,
    '--limit',
    String(limit),
    '--json',
    fields,
  ]
  // Only append --assignee when present & non-empty (Anyone = no filter).
  if (params.assignee !== undefined && params.assignee !== '') {
    args.push('--assignee', params.assignee)
  }

  const stdout = await runGh(args, cwd, params.account)
  return { items: parseThreadList(params.kind, stdout) }
})
