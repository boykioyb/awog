// gh.get → a single issue/pr with body + comments folded in (ADR 0049). cwd =
// project.path (server-loaded). `number` is an int; nothing path-like from
// params reaches the args.
//
// ONE gh spawn by default. A PR's review timeline needs two more (REST) and is
// what made opening a PR feel slow, so it moved to `gh.reviews`, which the UI
// loads progressively behind the painted thread. `withReviews` folds them back
// in for callers that want the whole thing in one round-trip.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGh } from '../github/runner.js'
import { resolveProjectCwd } from '../github/project-cwd.js'
import { fetchReviews } from '../github/reviews.js'
import { parseThread, type GhThread } from '../github/thread.js'

const Params = z.object({
  projectId: z.string().min(1),
  kind: z.enum(['issue', 'pr']),
  number: z.number().int().positive(),
  account: z.string().optional(),
  // Child repo of a multi-repo workspace (relativePath from git.discoverRepos).
  repoPath: z.string().optional(),
  // PR-only: also pull the review timeline (2 extra gh calls). Default off.
  withReviews: z.boolean().optional(),
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

  if (params.kind === 'pr' && params.withReviews) {
    const reviews = await fetchReviews(cwd, params.number, params.account)
    if (reviews.length) thread.reviews = reviews
  }

  return thread
})
