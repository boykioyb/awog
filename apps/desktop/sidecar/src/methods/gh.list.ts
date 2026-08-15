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
    // PR-only: requested reviewer (`@me` or a login) → a `review-requested:`
    // search qualifier (gh pr list has no dedicated flag for it).
    reviewer: z.string().optional(),
    account: z.string().optional(),
    // Child repo of a multi-repo workspace (relativePath from git.discoverRepos).
    repoPath: z.string().optional(),
    // Server-side search: a bare `#?<number>` resolves the exact issue/PR (view);
    // anything else is a GitHub text search across the whole repo (not just the
    // loaded page). Empty = normal list.
    search: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
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
    // reviewer: same shape, PR-only (issues have no reviewers). Validated before it
    // reaches the search query so nothing unvetted lands in a gh argument.
    if (p.reviewer !== undefined && p.reviewer !== '') {
      if (p.kind !== 'pr') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reviewer'],
          message: 'reviewer is only valid for kind=pr',
        })
      } else if (p.reviewer !== '@me' && !isValidGhLogin(p.reviewer)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reviewer'], message: 'invalid reviewer' })
      }
    }
  })

// Field sets per kind. Issues have no isDraft/baseRefName/headRefName.
const ISSUE_FIELDS = 'number,title,state,author,assignees,labels,createdAt,updatedAt'
const PR_FIELDS =
  'number,title,state,isDraft,author,assignees,reviewRequests,latestReviews,labels,baseRefName,headRefName,createdAt,updatedAt'

interface Result {
  items: GhThreadSummary[]
}

register('gh.list', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const cwd = await resolveProjectCwd(params.projectId, params.repoPath)

  const limit = params.limit ?? 50
  const fields = params.kind === 'pr' ? PR_FIELDS : ISSUE_FIELDS
  const kindArg = params.kind === 'pr' ? 'pr' : 'issue'
  const search = (params.search ?? '').trim()

  // Exact number → resolve that one issue/PR directly (works regardless of which
  // page it's on, or its state). gh `view` returns a single object; wrap it as a
  // one-row list. A miss (wrong number / not a PR) → empty, not an error.
  const numMatch = /^#?(\d+)$/.exec(search)
  if (numMatch) {
    try {
      const one = await runGh([kindArg, 'view', numMatch[1], '--json', fields], cwd, params.account)
      return { items: parseThreadList(params.kind, `[${one}]`) }
    } catch {
      return { items: [] }
    }
  }

  const args = [kindArg, 'list', '--state', params.state, '--limit', String(limit), '--json', fields]
  // The reviewer filter has no gh flag → it rides the search query as a
  // `review-requested:` qualifier, merged with the user's text search when both
  // are set. `search` alone = GitHub text search across the whole repo (title/
  // body), not just this page.
  const reviewer = (params.reviewer ?? '').trim()
  const query = [search, reviewer ? `review-requested:${reviewer}` : '']
    .filter((part) => part !== '')
    .join(' ')
  if (query) args.push('--search', query)
  if (!search && params.assignee !== undefined && params.assignee !== '') {
    // Assignee filter only applies without a text search (which carries its own
    // scope); it combines fine with a reviewer-only search query.
    args.push('--assignee', params.assignee)
  }

  const stdout = await runGh(args, cwd, params.account)
  return { items: parseThreadList(params.kind, stdout) }
})
