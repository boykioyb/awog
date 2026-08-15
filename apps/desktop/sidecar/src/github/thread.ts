// Shared shapes + lenient parsers for gh issue/pr JSON → the RPC contract
// (ADR 0049). Issue and PR share one "GitHub thread" shape; PR-only fields are
// optional. gh `--json` returns `state` UPPERCASE (OPEN/CLOSED/MERGED) and may
// include extra keys across versions → schemas are lenient (.passthrough(),
// pick only what we need; never reject unknown keys).
import { z } from 'zod'

export type GhThreadKind = 'issue' | 'pr'
export type GhThreadState = 'OPEN' | 'CLOSED' | 'MERGED'

export interface GhThreadLabel {
  name: string
  color: string
}

export interface GhThreadComment {
  author: { login: string }
  body: string
  createdAt: string
}

// PR-only: a changed file with its line delta.
export interface GhThreadFile {
  path: string
  additions: number
  deletions: number
}

// PR-only: a threaded inline review-comment conversation (a root comment on a code
// line + its replies). GitHub nests these under the review that created them.
export interface GhReviewThreadComment {
  author: { login: string }
  body: string
  createdAt: string
}
export interface GhReviewThread {
  path: string
  line: number | null
  // The unified-diff snippet around the commented line (GitHub's `diff_hunk`) — the
  // code context shown above the thread. Empty when unavailable.
  diffHunk: string
  comments: GhReviewThreadComment[]
}

// PR-only: a submitted review — a timeline entry with its state + optional summary
// body + the inline comment threads it created (GitHub shows threads INSIDE their
// review). Fetched from the REST reviews + comments endpoints (numeric ids join).
export interface GhReview {
  author: { login: string }
  state: string
  body: string
  createdAt: string
  threads: GhReviewThread[]
}

// PR-only: one person on the review of a PR. 'PENDING' = review requested but not
// submitted yet; the rest mirror GitHub's review states.
export type GhReviewerState =
  | 'PENDING'
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'COMMENTED'
  | 'DISMISSED'
export interface GhThreadReviewer {
  login: string
  state: GhReviewerState
}

export interface GhThreadSummary {
  kind: GhThreadKind
  number: number
  title: string
  state: GhThreadState
  author: { login: string }
  assignees: { login: string }[]
  labels: GhThreadLabel[]
  createdAt: string
  updatedAt: string
  // PR-only.
  isDraft?: boolean
  baseRefName?: string
  headRefName?: string
  // PR-only: who is on the review — pending review requests first, then whoever
  // already submitted one. Users only (team requests carry no login and are
  // dropped, since the reviewer filter keys on a login).
  reviewers?: GhThreadReviewer[]
}

export interface GhThread extends GhThreadSummary {
  body: string
  url: string
  comments: GhThreadComment[]
  // PR-only (absent / empty for issues).
  files?: GhThreadFile[]
  // PR-only: submitted reviews (timeline), each with its nested inline threads.
  reviews?: GhReview[]
}

// gh sometimes returns author/assignee as `null` (ghost user) — coerce to a
// login of ''. labels carry name+color (+ id/description we drop).
const Actor = z
  .object({ login: z.string() })
  .passthrough()
  .nullable()

const Label = z
  .object({ name: z.string(), color: z.string().optional() })
  .passthrough()

const Comment = z
  .object({
    author: Actor.optional(),
    body: z.string().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough()

// Shared summary fields (issue + pr list rows). PR-only fields optional.
const SummaryJson = z
  .object({
    number: z.number(),
    title: z.string().optional(),
    state: z.string().optional(),
    author: Actor.optional(),
    assignees: z.array(Actor).optional(),
    labels: z.array(Label).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    isDraft: z.boolean().optional(),
    baseRefName: z.string().optional(),
    headRefName: z.string().optional(),
    // gh `reviewRequests` mixes users ({ __typename: 'User', login }) and teams
    // ({ __typename: 'Team', name, slug }) → login is optional here.
    reviewRequests: z.array(z.object({ login: z.string().optional() }).passthrough()).optional(),
    // gh `latestReviews` — the last submitted review per person. Carries a `body`
    // we deliberately drop (the list row only shows who + verdict).
    latestReviews: z
      .array(z.object({ author: Actor.optional(), state: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough()

const FileJson = z
  .object({
    path: z.string(),
    additions: z.number().optional(),
    deletions: z.number().optional(),
  })
  .passthrough()

const ThreadJson = SummaryJson.extend({
  body: z.string().optional(),
  url: z.string().optional(),
  comments: z.array(Comment).optional(),
  files: z.array(FileJson).optional(),
})

export const SummaryListJson = z.array(SummaryJson)

type SummaryJsonT = z.infer<typeof SummaryJson>
type ThreadJsonT = z.infer<typeof ThreadJson>

function login(actor: z.infer<typeof Actor> | undefined): { login: string } {
  return { login: actor?.login ?? '' }
}

// gh state is UPPERCASE already; default to OPEN if absent. Only OPEN/CLOSED/
// MERGED are contract states — anything unexpected falls back to OPEN (lenient).
function toState(state: string | undefined): GhThreadState {
  const s = (state ?? 'OPEN').toUpperCase()
  if (s === 'CLOSED') return 'CLOSED'
  if (s === 'MERGED') return 'MERGED'
  return 'OPEN'
}

const REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'])

// Merge a PR's pending review requests + already-submitted reviews into one
// per-person list. Pending first (it's the actionable half) and pending WINS when
// someone both reviewed and was asked to look again — GitHub reports that person
// in both fields. Returns undefined when gh sent neither field (older builds /
// issue rows) so the summary key stays absent instead of an empty array.
function toReviewers(j: SummaryJsonT): GhThreadReviewer[] | undefined {
  if (j.reviewRequests === undefined && j.latestReviews === undefined) return undefined
  const byLogin = new Map<string, GhReviewerState>()
  for (const r of j.reviewRequests ?? []) {
    // Team requests carry no login — drop them (the filter keys on a login).
    if (r.login) byLogin.set(r.login, 'PENDING')
  }
  for (const r of j.latestReviews ?? []) {
    const l = r.author?.login
    if (!l || byLogin.has(l)) continue
    const state = (r.state ?? '').toUpperCase()
    byLogin.set(l, REVIEW_STATES.has(state) ? (state as GhReviewerState) : 'COMMENTED')
  }
  return [...byLogin].map(([login, state]) => ({ login, state }))
}

function toSummary(kind: GhThreadKind, j: SummaryJsonT): GhThreadSummary {
  const out: GhThreadSummary = {
    kind,
    number: j.number,
    title: j.title ?? '',
    state: toState(j.state),
    author: login(j.author),
    assignees: (j.assignees ?? []).map((a) => login(a)),
    labels: (j.labels ?? []).map((l) => ({ name: l.name, color: l.color ?? '' })),
    createdAt: j.createdAt ?? '',
    updatedAt: j.updatedAt ?? '',
  }
  if (kind === 'pr') {
    if (j.isDraft !== undefined) out.isDraft = j.isDraft
    if (j.baseRefName !== undefined) out.baseRefName = j.baseRefName
    if (j.headRefName !== undefined) out.headRefName = j.headRefName
    const reviewers = toReviewers(j)
    if (reviewers) out.reviewers = reviewers
  }
  return out
}

// Parse `gh issue/pr list --json …` stdout → summaries, stamping `kind`.
export function parseThreadList(kind: GhThreadKind, stdout: string): GhThreadSummary[] {
  const rows = SummaryListJson.parse(JSON.parse(stdout))
  return rows.map((r) => toSummary(kind, r))
}

// Parse `gh issue/pr view <n> --json …` stdout → a full thread, stamping `kind`
// + folding comments (sorted oldest → newest by createdAt).
export function parseThread(kind: GhThreadKind, stdout: string): GhThread {
  const j: ThreadJsonT = ThreadJson.parse(JSON.parse(stdout))
  const comments: GhThreadComment[] = (j.comments ?? []).map((c) => ({
    author: login(c.author),
    body: c.body ?? '',
    createdAt: c.createdAt ?? '',
  }))
  comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const thread: GhThread = {
    ...toSummary(kind, j),
    body: j.body ?? '',
    url: j.url ?? '',
    comments,
  }

  // PR-only changed files (reviews come from the REST endpoints — see parseReviews).
  if (kind === 'pr') {
    thread.files = (j.files ?? []).map((f) => ({
      path: f.path,
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
    }))
  }

  return thread
}

// REST review (gh api .../pulls/N/reviews) — numeric id joins the comments below.
const RestReviewJson = z
  .object({
    id: z.number(),
    user: Actor.optional(),
    body: z.string().optional(),
    state: z.string().optional(),
    submitted_at: z.string().nullable().optional(),
  })
  .passthrough()
const RestReviewsJson = z.array(RestReviewJson)

// REST review comment (gh api .../pulls/N/comments). snake_case + lenient.
// `pull_request_review_id` links it to its parent review; `in_reply_to_id` threads it.
const ReviewCommentJson = z
  .object({
    id: z.number(),
    pull_request_review_id: z.number().nullable().optional(),
    in_reply_to_id: z.number().nullable().optional(),
    path: z.string().optional(),
    line: z.number().nullable().optional(),
    original_line: z.number().nullable().optional(),
    diff_hunk: z.string().optional(),
    user: Actor.optional(),
    body: z.string().optional(),
    created_at: z.string().optional(),
  })
  .passthrough()
const ReviewCommentsJson = z.array(ReviewCommentJson)

const MEANINGFUL_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'])

// Build the PR review timeline from the REST reviews + review-comments endpoints
// (GitHub nests inline comment threads under the review that created them). Comments
// are grouped into threads (root + replies by in_reply_to_id), each thread attached
// to its root comment's `pull_request_review_id`; threads whose review is missing
// fall into a synthetic "commented" review so nothing is dropped. A review is kept
// when it has a body, threads, or a meaningful state (approved / changes / dismiss).
// Best-effort: unparseable input → []. L1-untrusted (rendered as markdown, no HTML).
export function parseReviews(reviewsStdout: string, commentsStdout: string): GhReview[] {
  let reviewsArr: z.infer<typeof RestReviewsJson> = []
  let commentsArr: z.infer<typeof ReviewCommentsJson> = []
  try {
    reviewsArr = RestReviewsJson.parse(JSON.parse(reviewsStdout))
  } catch {
    reviewsArr = []
  }
  try {
    commentsArr = ReviewCommentsJson.parse(JSON.parse(commentsStdout))
  } catch {
    commentsArr = []
  }

  // Group comments into threads (oldest first → roots precede replies), tracking the
  // root comment's owning review id.
  const sorted = [...commentsArr].sort((a, b) =>
    (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  )
  type Th = GhReviewThread & { reviewId: number | null }
  const threadMap = new Map<number, Th>()
  for (const c of sorted) {
    const rootId = c.in_reply_to_id ?? c.id
    let th = threadMap.get(rootId)
    if (!th) {
      th = {
        path: c.path ?? '',
        line: c.line ?? c.original_line ?? null,
        diffHunk: c.diff_hunk ?? '',
        comments: [],
        reviewId: c.pull_request_review_id ?? null,
      }
      threadMap.set(rootId, th)
    }
    th.comments.push({ author: login(c.user), body: c.body ?? '', createdAt: c.created_at ?? '' })
  }

  const reviews: GhReview[] = reviewsArr.map((r) => ({
    author: login(r.user),
    state: (r.state ?? '').toUpperCase(),
    body: r.body ?? '',
    createdAt: r.submitted_at ?? '',
    threads: [],
  }))
  const byId = new Map<number, GhReview>()
  reviewsArr.forEach((r, i) => byId.set(r.id, reviews[i]!))

  for (const th of threadMap.values()) {
    const { reviewId, ...thread } = th
    const target = reviewId != null ? byId.get(reviewId) : undefined
    if (target) {
      target.threads.push(thread)
    } else {
      // Orphan thread (review not in the page) → its own commented review entry.
      reviews.push({
        author: thread.comments[0]?.author ?? { login: '' },
        state: 'COMMENTED',
        body: '',
        createdAt: thread.comments[0]?.createdAt ?? '',
        threads: [thread],
      })
    }
  }

  return reviews
    .filter((r) => r.body.trim().length > 0 || r.threads.length > 0 || MEANINGFUL_STATES.has(r.state))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
