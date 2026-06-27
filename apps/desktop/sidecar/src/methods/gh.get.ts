// gh.get → a single issue/pr with body + comments folded in (ADR 0049). cwd =
// project.path (server-loaded). `number` is an int; nothing path-like from
// params reaches the args.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGh } from '../github/runner.js'
import { resolveProjectCwd } from '../github/project-cwd.js'
import { parseThread, parseReviews, type GhThread } from '../github/thread.js'

const Params = z.object({
  projectId: z.string().min(1),
  kind: z.enum(['issue', 'pr']),
  number: z.number().int().positive(),
  account: z.string().optional(),
  // Child repo of a multi-repo workspace (relativePath from git.discoverRepos).
  repoPath: z.string().optional(),
})

// Detail field sets. PR adds isDraft + base/head refs on top of the issue set.
const ISSUE_FIELDS =
  'number,title,state,author,assignees,labels,createdAt,updatedAt,body,url,comments'
const PR_FIELDS =
  'number,title,state,isDraft,author,assignees,labels,baseRefName,headRefName,createdAt,updatedAt,body,url,comments,files'

register('gh.get', async (raw): Promise<GhThread> => {
  const params = Params.parse(raw)
  const cwd = await resolveProjectCwd(params.projectId, params.repoPath)

  const fields = params.kind === 'pr' ? PR_FIELDS : ISSUE_FIELDS
  const args = [
    params.kind === 'pr' ? 'pr' : 'issue',
    'view',
    String(params.number),
    '--json',
    fields,
  ]

  const stdout = await runGh(args, cwd, params.account)
  const thread = parseThread(params.kind, stdout)

  // PR-only: the review timeline (reviews + their nested inline comment threads)
  // isn't in `pr view --json` — and the GraphQL review id there can't be joined to
  // the REST comments. Pull both from REST (gh resolves {owner}/{repo} from the repo
  // cwd; `number` is a validated int) and join by numeric review id. Best-effort —
  // a failure just omits the reviews.
  if (params.kind === 'pr') {
    try {
      const [reviewsOut, commentsOut] = await Promise.all([
        runGh(
          ['api', `repos/{owner}/{repo}/pulls/${params.number}/reviews?per_page=100`],
          cwd,
          params.account,
        ),
        runGh(
          ['api', `repos/{owner}/{repo}/pulls/${params.number}/comments?per_page=100`],
          cwd,
          params.account,
        ),
      ])
      const reviews = parseReviews(reviewsOut, commentsOut)
      if (reviews.length) thread.reviews = reviews
    } catch {
      // leave reviews undefined
    }
  }

  return thread
})
