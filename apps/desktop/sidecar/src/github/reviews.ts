// PR review timeline fetch (ADR 0049) — shared by `gh.reviews` and `gh.get`'s
// opt-in `withReviews`.
//
// The timeline isn't in `pr view --json`, and the GraphQL review id there can't be
// joined to the REST comments, so both come from REST and join by numeric review
// id. gh resolves {owner}/{repo} from the repo cwd; `number` is a validated int,
// so nothing path-like from params reaches the args.
import { runGh } from './runner.js'
import { parseReviews, type GhReview } from './thread.js'

// Best-effort: a failure returns [] (the drawer just shows no review timeline)
// rather than failing the whole detail view.
export async function fetchReviews(
  cwd: string,
  number: number,
  account: string | undefined,
): Promise<GhReview[]> {
  try {
    const [reviewsOut, commentsOut] = await Promise.all([
      runGh(['api', `repos/{owner}/{repo}/pulls/${number}/reviews?per_page=100`], cwd, account),
      runGh(['api', `repos/{owner}/{repo}/pulls/${number}/comments?per_page=100`], cwd, account),
    ])
    return parseReviews(reviewsOut, commentsOut)
  } catch {
    return []
  }
}
