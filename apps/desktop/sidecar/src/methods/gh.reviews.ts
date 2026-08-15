// gh.reviews → a PR's review timeline (reviews + their nested inline comment
// threads), split out of `gh.get` so opening a PR paints after ONE gh call and
// the timeline streams in behind it (ADR 0049). cwd = project.path
// (server-loaded); `number` is a validated int.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { resolveProjectCwd } from '../github/project-cwd.js'
import { fetchReviews } from '../github/reviews.js'
import type { GhReview } from '../github/thread.js'

const Params = z.object({
  projectId: z.string().min(1),
  number: z.number().int().positive(),
  account: z.string().optional(),
  // Child repo of a multi-repo workspace (relativePath from git.discoverRepos).
  repoPath: z.string().optional(),
})

interface Result {
  reviews: GhReview[]
}

register('gh.reviews', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const cwd = await resolveProjectCwd(params.projectId, params.repoPath)
  return { reviews: await fetchReviews(cwd, params.number, params.account) }
})
