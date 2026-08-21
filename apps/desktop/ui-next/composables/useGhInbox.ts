// GitHub notification INBOX — the list behind the top-bar bell
// (docs/features/github-notifications.md).
//
// Split from useGhNotifications on purpose: that module owns TIMING + ALERTING
// (when to poll, what is new, toast/OS notification), this one owns the LIST the
// user browses (current state, read state, counts). The poller feeds this store on
// every tick, so the badge stays live without a second `gh` spawn.
//
// App-lifetime singleton (module-level state): the bell, the poller and Settings
// all read the same inbox.
//
// SoC: no `gh` here — the sidecar owns the CLI. This orchestrates state only.
import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { useSettingsStore } from '~/stores/settings'

export type GhNotificationType = 'PullRequest' | 'Issue' | 'Other'

export interface GhNotification {
  id: string
  // false once the thread is read — here, or on github.com.
  unread: boolean
  reason: string
  updatedAt: string
  title: string
  type: GhNotificationType
  repo: string
  number: number | null
  url: string
}

// How many unread threads one fetch pulls. GitHub's notifications endpoint hands
// back at most 50 rows per page whatever we ask for (measured), so 50 it is.
const FETCH_LIMIT = 50
// How many already-read rows the list keeps around (newest first). Enough to see
// what you just handled without the panel turning into an archive.
const READ_KEEP = 25
// Authors are looked up in ONE batched GraphQL call; this is the cap that call takes.
const AUTHOR_BATCH = 50

const items = ref<GhNotification[]>([])
const loading = ref(false)
// Last failure, kept for display (polling itself stays silent by design).
const error = ref<string | null>(null)
const lastFetchedAt = ref<string | null>(null)
// Threads whose mark-read RPC is IN FLIGHT. Held only for that window so a row
// can't be clicked twice and an in-flight poll can't flip the row back to unread
// after we already showed it as read. Cleared when the call settles — a thread that
// becomes unread again later (new comment, same id) must be free to come back.
const pendingRead = ref<Set<string>>(new Set())
// "<repo>#<number>" → login of whoever opened the issue/PR. The notifications REST
// payload has no author, so this is a separate lookup (gh.subjectAuthors). A PR's
// author never changes, so entries are cached for the app's lifetime — no TTL.
const authors = ref<Map<string, string>>(new Map())

const authorKey = (n: GhNotification): string | null =>
  n.number != null && n.type !== 'Other' ? `${n.repo}#${n.number}` : null

const newestFirst = (list: GhNotification[]): GhNotification[] =>
  [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))

// One inbox fetch (UNREAD threads). Shared by the poller (every tick), the bell
// (manual refresh) and the Settings connection check — one code path, so a bug can't
// hide in the one the user isn't looking at.
export async function fetchGhInbox(): Promise<GhNotification[]> {
  const settings = useSettingsStore()
  const params: { account?: string; limit: number } = { limit: FETCH_LIMIT }
  if (settings.githubAccount) params.account = settings.githubAccount
  const res = await useSidecar().request<{ notifications: GhNotification[] }>(
    'gh.notifications',
    params,
  )
  return res.notifications
}

// Fold a fresh UNREAD page into the list. Called by the poller on every tick.
//
// Read rows are the renderer's own bookkeeping, not GitHub's: a thread that was in
// the list and is no longer in the unread page has been read (here, or on
// github.com), so it stays — dimmed — instead of vanishing. Asking GitHub for read
// threads directly (`all=true`) is the obvious alternative and it is WRONG here: the
// page is capped at 50 rows, so read threads push real unread ones off the page and
// out of the badge count (measured: 50 unread → 39).
export function setGhInbox(list: GhNotification[]): void {
  // A thread with a mark-read call in flight shows read regardless, so the row can't
  // flicker back to unread mid-request.
  const fetched = list.map((n) => ({ ...n, unread: !pendingRead.value.has(n.id) }))
  const fetchedIds = new Set(fetched.map((n) => n.id))
  const read = items.value
    .filter((n) => !fetchedIds.has(n.id))
    .map((n) => (n.unread ? { ...n, unread: false } : n))
    .slice(0, READ_KEEP)
  items.value = newestFirst([...fetched, ...read])
  lastFetchedAt.value = new Date().toISOString()
  error.value = null
}

export function setGhInboxError(message: string): void {
  error.value = message
}

// Fill in missing authors for the rows we hold, in one request. Called when the
// panel opens/refreshes rather than on every poll tick: it costs an extra `gh`
// spawn, and nobody is reading the list in between.
export async function hydrateGhAuthors(): Promise<void> {
  const missing = new Map<string, { repo: string; number: number }>()
  for (const n of items.value) {
    const key = authorKey(n)
    if (!key || authors.value.has(key) || missing.has(key)) continue
    missing.set(key, { repo: n.repo, number: n.number as number })
    if (missing.size >= AUTHOR_BATCH) break
  }
  if (missing.size === 0 || !useSidecar().available) return
  try {
    const res = await useSidecar().request<{ authors: Record<string, string> }>(
      'gh.subjectAuthors',
      { ...accountParams(), items: [...missing.values()] },
    )
    const next = new Map(authors.value)
    for (const [key, login] of Object.entries(res.authors)) next.set(key, login)
    authors.value = next
  } catch {
    // Authors are an enrichment, not the list. A failure here must not colour the
    // panel with an error the user can do nothing about.
  }
}

// Manual refresh (bell → refresh button). Unlike the poller this surfaces its own
// failure: the user asked, so silence would read as "nothing happened".
export async function refreshGhInbox(): Promise<void> {
  if (loading.value) return
  if (!useSidecar().available) {
    error.value = useI18n().t('github.inbox.offline')
    return
  }
  loading.value = true
  try {
    setGhInbox(await fetchGhInbox())
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'gh.notifications failed'
  } finally {
    loading.value = false
  }
  await hydrateGhAuthors()
}

// Mark ONE thread read on GitHub. Optimistic, and the row STAYS: seeing it go
// quiet-but-present is the feedback ("I handled this"); a row that vanishes reads
// like a mis-click. The next poll would restore `unread` if the call failed.
export async function markGhNotificationRead(id: string): Promise<void> {
  if (pendingRead.value.has(id)) return
  pendingRead.value = new Set(pendingRead.value).add(id)
  items.value = items.value.map((n) => (n.id === id ? { ...n, unread: false } : n))
  try {
    await useSidecar().request('gh.notificationsRead', threadParams(id))
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'gh.notificationsRead failed'
  } finally {
    const next = new Set(pendingRead.value)
    next.delete(id)
    pendingRead.value = next
  }
}

// Mark the WHOLE GitHub inbox read — including repos AWOG never shows. The caller
// (panel) confirms first; this only performs it.
export async function markAllGhNotificationsRead(): Promise<void> {
  const previous = items.value
  items.value = items.value.map((n) => (n.unread ? { ...n, unread: false } : n))
  try {
    await useSidecar().request('gh.notificationsRead', accountParams())
    lastFetchedAt.value = new Date().toISOString()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'gh.notificationsRead failed'
    items.value = previous
  }
}

function accountParams(): { account?: string } {
  const account = useSettingsStore().githubAccount
  return account ? { account } : {}
}

function threadParams(id: string): { account?: string; threadId: string } {
  return { ...accountParams(), threadId: id }
}

// Read-only view for the bell + Settings.
export function useGhInbox() {
  return {
    items,
    loading,
    error,
    lastFetchedAt,
    unreadCount: computed(() => items.value.filter((n) => n.unread).length),
    // '' when unknown (release/discussion, or the lookup hasn't run/failed) — the
    // row simply omits the author rather than showing a placeholder.
    authorOf: (n: GhNotification): string => {
      const key = authorKey(n)
      return key ? (authors.value.get(key) ?? '') : ''
    },
  }
}
