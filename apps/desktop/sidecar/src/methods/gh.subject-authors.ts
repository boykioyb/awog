// gh.subjectAuthors → who opened each issue/PR, in ONE request
// (docs/features/github-notifications.md).
//
// The notifications REST payload carries no author (only subject title/url/type),
// and fetching each thread's subject would be one request per row — 50 spawns per
// panel open. So this batches: one `gh api graphql` call with an alias per item.
//
// SECURITY: every caller-supplied value (owner, name, number) travels as a GraphQL
// VARIABLE, never spliced into the query text. The only generated part of the query
// is the alias index (`a0`, `a1`, …), which the caller cannot influence. `repo` is
// still shape-validated so a malformed entry fails fast instead of costing a
// request. Account-scoped like gh.notifications: no cwd, nothing path-like.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGhAccountAllowPartial } from '../github/runner.js'

// GitHub owner/repo charset. Deliberately strict — this is a boundary check, not a
// beauty contest.
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

const MAX_ITEMS = 50

const AUTHOR_FRAGMENT =
  '__typename ... on PullRequest { author { login } } ... on Issue { author { login } }'

const Params = z.object({
  account: z.string().optional(),
  items: z
    .array(
      z.object({
        repo: z.string().regex(REPO_RE),
        number: z.number().int().positive(),
      }),
    )
    .max(MAX_ITEMS),
})

// `issueOrPullRequest` covers both kinds, so the caller doesn't have to know which
// it is. A thread we can't see (or a deleted author) comes back null → skipped.
const AuthorJson = z
  .object({
    data: z
      .record(
        z
          .object({
            issueOrPullRequest: z
              .object({ author: z.object({ login: z.string() }).nullable().optional() })
              .nullable()
              .optional(),
          })
          .nullable(),
      )
      .optional(),
  })
  .passthrough()

interface Result {
  // "<owner>/<repo>#<number>" → login
  authors: Record<string, string>
}

register('gh.subjectAuthors', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  if (params.items.length === 0) return { authors: {} }

  const fields: string[] = []
  const selections = params.items.map((item, i) => {
    const [owner, name] = item.repo.split('/')
    fields.push('-f', `o${i}=${owner}`, '-f', `n${i}=${name}`, '-F', `num${i}=${item.number}`)
    return `a${i}: repository(owner:$o${i},name:$n${i}){issueOrPullRequest(number:$num${i}){${AUTHOR_FRAGMENT}}}`
  })
  const varDefs = params.items
    .map((_, i) => `$o${i}:String!,$n${i}:String!,$num${i}:Int!`)
    .join(',')
  const query = `query(${varDefs}){${selections.join(' ')}}`

  // Partial-tolerant on purpose: GraphQL answers "these 49 rows, plus an error for
  // the repo you lost access to" and gh exits 1 for it. Losing every author because
  // of one dead repo would be the wrong trade.
  const stdout = await runGhAccountAllowPartial(
    ['api', 'graphql', '-f', `query=${query}`, ...fields],
    params.account,
  )
  const parsed = AuthorJson.parse(JSON.parse(stdout))

  const authors: Record<string, string> = {}
  params.items.forEach((item, i) => {
    const login = parsed.data?.[`a${i}`]?.issueOrPullRequest?.author?.login
    if (login) authors[`${item.repo}#${item.number}`] = login
  })
  return { authors }
})
