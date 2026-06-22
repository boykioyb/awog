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
}

export interface GhThread extends GhThreadSummary {
  body: string
  url: string
  comments: GhThreadComment[]
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
  })
  .passthrough()

const ThreadJson = SummaryJson.extend({
  body: z.string().optional(),
  url: z.string().optional(),
  comments: z.array(Comment).optional(),
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
  return {
    ...toSummary(kind, j),
    body: j.body ?? '',
    url: j.url ?? '',
    comments,
  }
}
