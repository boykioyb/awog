// gh.notifications → the authenticated user's GitHub notification inbox
// (docs/features/github-notifications.md). Account-scoped, NOT repo-scoped: the
// inbox spans every repo, so there is no cwd and nothing path-like in the args.
//
// One `gh api notifications` call per poll. `since` (the renderer's last poll
// stamp) keeps the payload small; the renderer does the dedupe + per-project
// filtering, since only it knows which projects the user opted in to.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGhAccount } from '../github/runner.js'

// ISO-8601 UTC, the shape GitHub's `since` expects. Validated (not just typed) —
// it is the one caller-supplied value that reaches the request path.
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

const Params = z.object({
  account: z.string().optional(),
  since: z.string().regex(ISO_UTC_RE).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

// GitHub REST notification. Lenient: pick what the UI shows, keep unknown keys.
const NotificationJson = z
  .object({
    id: z.string(),
    reason: z.string().optional(),
    updated_at: z.string().optional(),
    subject: z
      .object({
        title: z.string().optional(),
        url: z.string().nullable().optional(),
        type: z.string().optional(),
      })
      .passthrough()
      .optional(),
    repository: z
      .object({ full_name: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough()
const NotificationsJson = z.array(NotificationJson)

export type GhNotificationType = 'PullRequest' | 'Issue' | 'Other'

export interface GhNotification {
  id: string
  // GitHub's reason (review_requested / mention / assign / comment / …).
  reason: string
  updatedAt: string
  title: string
  type: GhNotificationType
  // owner/repo.
  repo: string
  // Issue/PR number when the subject is one; null for releases, discussions, …
  number: number | null
  // Web URL, ALWAYS on https://github.com/ (anything else is dropped) — the UI
  // hands this to openExternal.
  url: string
}

// Subject urls are API urls (…/repos/{o}/{r}/pulls/123). Map to the web url the
// user expects, and to the issue/PR number the UI opens in its own drawer.
function subjectTarget(
  repo: string,
  subjectUrl: string | null | undefined,
  subjectType: string | undefined,
): { type: GhNotificationType; number: number | null; url: string } {
  const repoUrl = repo ? `https://github.com/${repo}` : ''
  const m = /\/repos\/([^/]+)\/([^/]+)\/(pulls|issues)\/(\d+)$/.exec(subjectUrl ?? '')
  if (m) {
    const [, owner, name, kind, num] = m
    const path = kind === 'pulls' ? 'pull' : 'issues'
    return {
      type: kind === 'pulls' ? 'PullRequest' : 'Issue',
      number: Number(num),
      url: `https://github.com/${owner}/${name}/${path}/${num}`,
    }
  }
  // Release / Discussion / CheckSuite / … — no number to open in-app.
  const type: GhNotificationType =
    subjectType === 'PullRequest' ? 'PullRequest' : subjectType === 'Issue' ? 'Issue' : 'Other'
  return { type, number: null, url: repoUrl }
}

interface Result {
  notifications: GhNotification[]
}

register('gh.notifications', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const limit = params.limit ?? 50
  // Unread only (`all=false` is gh's default) across every repo the account can
  // see; the renderer filters down to the opted-in projects.
  const query = [`per_page=${limit}`, params.since ? `since=${params.since}` : '']
    .filter((p) => p !== '')
    .join('&')

  const stdout = await runGhAccount(['api', `notifications?${query}`], params.account)
  const rows = NotificationsJson.parse(JSON.parse(stdout))

  const notifications: GhNotification[] = rows.map((r) => {
    const repo = r.repository?.full_name ?? ''
    const target = subjectTarget(repo, r.subject?.url, r.subject?.type)
    return {
      id: r.id,
      reason: r.reason ?? '',
      updatedAt: r.updated_at ?? '',
      title: r.subject?.title ?? '',
      type: target.type,
      repo,
      number: target.number,
      url: target.url,
    }
  })
  return { notifications }
})
