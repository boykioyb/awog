// GitHub notification poller (docs/features/github-notifications.md).
//
// One `gh.notifications` call per tick pulls the account's whole unread inbox;
// this module keeps only the notifications belonging to the projects the user
// opted in to (Settings → Git), toasts what's new, and routes a click to that
// project's Issues/PR drawer. App-lifetime singleton: `startGhNotifications()` is
// called once from the main window's layout — a popout must not double-toast.
//
// Everything below the state block is module scope (not closed over by start())
// so the Settings "preview" button can reuse the exact same toast + routing path
// the real notifications take — a preview built from a parallel code path would
// be free to look right while the real one is broken.
//
// SoC: no fs / no gh here; the sidecar owns the CLI. This orchestrates timing,
// dedupe and presentation only.
import { ref, watch } from 'vue'
import { githubSlugFromRemote } from '~/components/project/data'
import { useSidecar } from '~/composables/useSidecar'
import { pushActionToast } from '~/composables/useActionToasts'
import { useProjectModal } from '~/composables/useProjectModal'
import { useSettingsStore } from '~/stores/settings'
import { useProjectsStore } from '~/stores/projects'

export type GhNotificationType = 'PullRequest' | 'Issue' | 'Other'

export interface GhNotification {
  id: string
  reason: string
  updatedAt: string
  title: string
  type: GhNotificationType
  repo: string
  number: number | null
  url: string
}

type GitRepoEntryDto = { relativePath: string; remote?: string }

// Seen threads: id → the updatedAt we last toasted. A thread keeps its id across
// updates, so the pair is what makes "new comment on an old PR" a new event.
// Persisted so a restart doesn't re-toast the backlog; capped to stay small.
const SEEN_KEY = 'awog.gh.notify.seen'
const SEEN_CAP = 300
const POLLED_KEY = 'awog.gh.notify.polledAt'
// At most this many individual toasts per tick; the rest collapse into one line.
const MAX_TOASTS = 3
// GitHub `reason` values we have wording for (i18n github.notify.reason.*).
const TRANSLATED_REASONS = new Set([
  'review_requested',
  'mention',
  'assign',
  'comment',
  'author',
  'state_change',
  'subscribed',
  'team_mention',
  'ci_activity',
])

const started = ref(false)
const lastError = ref<string | null>(null)
// owner/repo (lowercased) → project id, for the opted-in projects only.
const repoToProject = new Map<string, string>()

let seenCache: Map<string, string> | null = null
// Whether this run has established a baseline. The first poll after app start
// records what's already in the inbox WITHOUT toasting it — otherwise opening the
// app would fire a wall of toasts for notifications already read on GitHub.
let seeded = false
let timer: ReturnType<typeof setInterval> | null = null
let polling = false

function readSeen(): Map<string, string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    if (!raw) return new Map()
    const arr = JSON.parse(raw) as [string, string][]
    return Array.isArray(arr) ? new Map(arr) : new Map()
  } catch {
    return new Map()
  }
}

function seen(): Map<string, string> {
  if (!seenCache) {
    seenCache = readSeen()
    seeded = seenCache.size > 0
  }
  return seenCache
}

function writeSeen(): void {
  try {
    // Keep the newest entries only (insertion order = arrival order).
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen().entries()].slice(-SEEN_CAP)))
  } catch {
    // localStorage unavailable — dedupe still works for this session.
  }
}

const optedIn = (): string[] => useSettingsStore().githubNotify.projectIds

// Rebuild owner/repo → project. Seeded synchronously from each project's own
// remote, then widened by repo discovery (a project can be a container holding
// several repos, in which case its own root has no remote).
async function buildRepoMap(): Promise<void> {
  const sc = useSidecar()
  const projects = useProjectsStore()
  repoToProject.clear()
  const ids = optedIn()
  for (const id of ids) {
    const p = projects.projectById(id)
    if (!p) continue
    const slug = githubSlugFromRemote(p.gitRemote)
    if (slug) repoToProject.set(slug.toLowerCase(), id)
  }
  if (!sc.available) return
  for (const id of ids) {
    const p = projects.projectById(id)
    if (!p?.path) continue
    try {
      const res = await sc.request<{ repos: GitRepoEntryDto[] }>('git.discoverRepos', {
        root: p.path,
      })
      for (const r of res.repos) {
        const slug = githubSlugFromRemote(r.remote ?? '')
        if (slug) repoToProject.set(slug.toLowerCase(), id)
      }
    } catch {
      // Discovery failed — the entity-derived slug above still covers the common
      // single-repo project.
    }
  }
}

// Toast text: "owner/repo #12 · why · title". GitHub keeps adding reasons, so an
// unknown one degrades to its own prettified name rather than a missing key.
function toastText(n: GhNotification): string {
  const { t } = useI18n()
  const reason = TRANSLATED_REASONS.has(n.reason)
    ? t(`github.notify.reason.${n.reason}`)
    : n.reason.replace(/_/g, ' ')
  const ref = n.number != null ? `#${n.number}` : ''
  return `${n.repo} ${ref} · ${reason} · ${n.title}`.replace(/\s+/g, ' ').trim()
}

// Click-through: the project's own Issues/PR drawer when we know which project
// and which thread; github.com otherwise (releases, discussions, …).
function openNotification(n: GhNotification): void {
  const projectId = repoToProject.get(n.repo.toLowerCase())
  if (projectId && n.number != null && n.type !== 'Other') {
    useProjectModal().open(projectId, {
      tab: n.type === 'PullRequest' ? 'prs' : 'issues',
      ghNumber: n.number,
    })
    return
  }
  if (n.url) void useSidecar().openExternal(n.url)
}

const notificationsSupported = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window

// Ask once, on demand — called when the user picks a delivery mode that needs the
// OS (never on app boot: an unprompted permission dialog at startup is hostile).
export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

// OS notification. `delivery` decides WHEN: 'native' fires always (the toast is
// suppressed, so something must show even with the app in front); 'both' keeps
// the original rule — only when the window isn't in front, where the toast alone
// would be invisible. Never prompts here; that happens in Settings.
function nativeNotify(n: GhNotification): void {
  const settings = useSettingsStore()
  const delivery = settings.notifications.delivery
  if (delivery === 'toast') return
  if (delivery === 'both' && !document.hidden && document.hasFocus()) return
  if (!notificationsSupported()) return
  if (Notification.permission !== 'granted') return
  try {
    const note = new Notification(n.repo, { body: toastText(n), tag: `gh-${n.id}` })
    note.onclick = () => {
      try {
        window.focus()
      } catch {
        /* the OS may refuse; the route below still runs */
      }
      openNotification(n)
    }
  } catch {
    // Notification construction can throw in locked-down webviews.
  }
}

// The one presentation path. `delivery === 'native'` means the user asked for OS
// notifications INSTEAD of in-app ones, so the toast is skipped entirely.
function present(n: GhNotification): void {
  if (useSettingsStore().notifications.delivery !== 'native') {
    pushActionToast(toastText(n), 'info', {
      icon: n.type === 'PullRequest' ? 'fork' : 'alert',
      action: () => openNotification(n),
    })
  }
  nativeNotify(n)
}

// Fetch the inbox. `since` keeps the payload small on the polling path; the
// preview omits it so it can find something to show even on a quiet day.
async function fetchInbox(opts: { since?: string; limit: number }): Promise<GhNotification[]> {
  const settings = useSettingsStore()
  const params: { account?: string; since?: string; limit: number } = { limit: opts.limit }
  if (settings.githubAccount) params.account = settings.githubAccount
  if (opts.since) params.since = opts.since
  const res = await useSidecar().request<{ notifications: GhNotification[] }>(
    'gh.notifications',
    params,
  )
  return res.notifications
}

const forOptedInProjects = (list: GhNotification[]): GhNotification[] =>
  list.filter((n) => repoToProject.has(n.repo.toLowerCase()))

async function poll(): Promise<void> {
  if (polling) return
  const settings = useSettingsStore()
  const { t } = useI18n()
  if (!settings.githubNotify.enabled || optedIn().length === 0) return
  if (!useSidecar().available) return
  polling = true
  try {
    const since = localStorage.getItem(POLLED_KEY) ?? undefined
    const list = await fetchInbox({ limit: 50, ...(since ? { since } : {}) })
    lastError.value = null
    // Stamp the poll BEFORE presenting: a toast that throws must not make the
    // next tick re-deliver the same window of notifications.
    try {
      localStorage.setItem(POLLED_KEY, new Date().toISOString().replace(/\.\d+Z$/, 'Z'))
    } catch {
      // Without the stamp we just re-scan a wider window; `seen` still dedupes.
    }

    const store = seen()
    const fresh = forOptedInProjects(list).filter((n) => store.get(n.id) !== n.updatedAt)
    for (const n of fresh) store.set(n.id, n.updatedAt)
    writeSeen()

    // First run establishes the baseline silently.
    if (!seeded) {
      seeded = true
      return
    }

    for (const n of fresh.slice(0, MAX_TOASTS)) present(n)
    const overflow = fresh.length - MAX_TOASTS
    if (overflow > 0) pushActionToast(t('github.notify.more', { n: overflow }), 'info')
  } catch (err) {
    // Poll failures are silent by design (gh not installed / not authed / rate
    // limited): a toast every minute would be worse than the missing feature.
    lastError.value = err instanceof Error ? err.message : 'gh.notifications failed'
  } finally {
    polling = false
  }
}

function schedule(): void {
  if (timer) clearInterval(timer)
  timer = null
  const settings = useSettingsStore()
  if (!settings.githubNotify.enabled || optedIn().length === 0) return
  // Floor at 60s — GitHub's documented minimum poll interval for this API.
  const ms = Math.max(60_000, settings.githubNotify.intervalMs)
  timer = setInterval(() => void poll(), ms)
  void poll()
}

export function startGhNotifications(): void {
  if (started.value) return
  started.value = true
  const settings = useSettingsStore()
  const projects = useProjectsStore()

  // Re-arm whenever the toggle, the interval or the project selection changes;
  // the project list matters too (a selected project can be renamed/removed).
  watch(
    () => [
      settings.githubNotify.enabled,
      settings.githubNotify.intervalMs,
      settings.githubNotify.projectIds.join(','),
      settings.githubAccount,
      projects.projects.length,
    ],
    async () => {
      await buildRepoMap()
      schedule()
    },
    { immediate: true },
  )
}

// Fire ONE sample OS notification, bypassing the focus gate (this is an explicit
// test — the user is looking at Settings, so the app IS focused). Requests
// permission first; the caller renders the outcome inline.
export type GhNativeProbe = 'ok' | 'denied' | 'unsupported'
export async function previewNativeNotification(): Promise<GhNativeProbe> {
  const { t } = useI18n()
  if (!notificationsSupported()) return 'unsupported'
  if ((await ensureNotificationPermission()) !== 'granted') return 'denied'
  try {
    new Notification('AWOG · GitHub', {
      body: t('github.notify.nativeSample'),
      tag: 'gh-native-preview',
    })
    return 'ok'
  } catch {
    return 'unsupported'
  }
}

// Outcome of the Settings → Git connection check. This is a DIAGNOSTIC, not a
// toast preview (how toasts look/where they sit is an Appearance concern): it
// answers "is my polling actually wired up?" — gh reachable, account authed,
// selected projects mapping to real repos.
export type GhNotifyCheck =
  | { status: 'no-projects' }
  | { status: 'offline' }
  | { status: 'ok'; matched: number; total: number }
  | { status: 'error'; message: string }

// Run one real inbox fetch and report what it found, without toasting anything
// and WITHOUT touching `seen` / `polledAt` — checking must not swallow a
// notification the poller still owes the user.
export async function checkGhNotifications(): Promise<GhNotifyCheck> {
  if (optedIn().length === 0) return { status: 'no-projects' }
  if (!useSidecar().available) return { status: 'offline' }
  try {
    await buildRepoMap()
    const list = await fetchInbox({ limit: 50 })
    lastError.value = null
    return { status: 'ok', matched: forOptedInProjects(list).length, total: list.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'gh.notifications failed'
    lastError.value = message
    return { status: 'error', message }
  }
}

// Read-only view for the Settings panel (surface the last failure without
// toasting it on every tick).
export function useGhNotificationsStatus() {
  return { started, lastError }
}
