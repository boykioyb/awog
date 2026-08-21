// GitHub notification poller (docs/features/github-notifications.md).
//
// One `gh.notifications` call per tick pulls the account's whole unread inbox. The
// FULL list goes to useGhInbox (what the top-bar bell shows); only notifications
// belonging to the projects the user opted in to (Settings → Git) are ALERTED —
// toast + OS notification — with a click routing to that project's Issues/PR
// drawer. App-lifetime singleton: `startGhNotifications()` is called once from the
// main window's layout — a popout must not double-toast.
//
// The split matters: alerting is interruption (opt-in, per project), the inbox is
// reference (everything, so a bell that shows nothing means the inbox IS empty —
// not that a project checkbox is unticked somewhere).
//
// Everything below the state block is module scope (not closed over by start())
// so the Settings "preview" button can reuse the exact same toast + routing path
// the real notifications take — a preview built from a parallel code path would
// be free to look right while the real one is broken.
//
// SoC: no fs / no gh here; the sidecar owns the CLI. This orchestrates timing,
// dedupe and presentation only.
import { computed, ref, watch } from 'vue'
import { githubSlugFromRemote } from '~/components/project/data'
import { useSidecar } from '~/composables/useSidecar'
import { pushActionToast } from '~/composables/useActionToasts'
import {
  fetchGhInbox,
  setGhInbox,
  setGhInboxError,
  type GhNotification,
} from '~/composables/useGhInbox'
import { useProjectModal } from '~/composables/useProjectModal'
import { useSettingsStore } from '~/stores/settings'
import { useProjectsStore } from '~/stores/projects'

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
// Whether a baseline has EVER been established on this machine. The very first
// poll records what's already in the inbox WITHOUT toasting it — otherwise a fresh
// install would fire a wall of toasts for notifications already read on GitHub.
//
// Keyed on the persisted poll stamp, not on `seen` being non-empty: `seen` stays
// empty as long as nothing matched an opted-in project, and keying on it made EVERY
// app start re-seed — silently swallowing the first batch of real notifications
// after each launch (the "toasts never fire" bug).
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
    seeded = localStorage.getItem(POLLED_KEY) !== null || seenCache.size > 0
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

// Rebuild owner/repo → project. Seeded synchronously from EVERY project's own
// remote (cheap, and the bell must be able to route a click for a repo the user
// never opted in to), then widened by repo discovery — but only for the opted-in
// projects, since that costs one sidecar call each. A project can be a container
// holding several repos, in which case its own root has no remote.
async function buildRepoMap(): Promise<void> {
  const sc = useSidecar()
  const projects = useProjectsStore()
  repoToProject.clear()
  for (const p of projects.projects) {
    const slug = githubSlugFromRemote(p.gitRemote)
    if (slug) repoToProject.set(slug.toLowerCase(), p.id)
  }
  if (!sc.available) return
  for (const id of optedIn()) {
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

// GitHub `reason` → label. GitHub keeps adding reasons, so an unknown one degrades
// to its own prettified name rather than a missing i18n key. Shared with the bell
// rows so the toast and the inbox never word the same event differently.
export function reasonLabel(reason: string): string {
  const { t } = useI18n()
  return TRANSLATED_REASONS.has(reason)
    ? t(`github.notify.reason.${reason}`)
    : reason.replace(/_/g, ' ')
}

// Toast text: "owner/repo #12 · why · title".
function toastText(n: GhNotification): string {
  const ref = n.number != null ? `#${n.number}` : ''
  return `${n.repo} ${ref} · ${reasonLabel(n.reason)} · ${n.title}`.replace(/\s+/g, ' ').trim()
}

// The project a notification's repo belongs to, or null when no project tracks it.
// Exported so the bell can label a row and route its click through the same map the
// poller uses.
export function projectForRepo(repo: string): string | null {
  return repoToProject.get(repo.toLowerCase()) ?? null
}

// Whether a notification would ALERT (toast / OS notification): its repo maps to a
// project AND that project is opted in (Settings → Git). The inbox shows everything;
// only this subset is allowed to interrupt.
export function isAlerting(n: GhNotification): boolean {
  const id = projectForRepo(n.repo)
  return id !== null && optedIn().includes(id)
}

// Click-through: the project's own Issues/PR drawer when we know which project
// and which thread; github.com otherwise (releases, discussions, …).
export function openNotification(n: GhNotification): void {
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

// Can the OS path actually deliver right now? Split out because `present()` needs
// the answer to decide whether suppressing the toast would leave NOTHING visible.
const osDeliverable = (): boolean =>
  notificationsSupported() && Notification.permission === 'granted'

// OS notification. `delivery` decides WHEN: 'native' fires always (the toast is
// suppressed, so something must show even with the app in front); 'both' keeps
// the original rule — only when the window isn't in front, where the toast alone
// would be invisible. Never prompts here; that happens in Settings.
function nativeNotify(n: GhNotification): void {
  const settings = useSettingsStore()
  const delivery = settings.notifications.delivery
  if (delivery === 'toast') return
  if (delivery === 'both' && !document.hidden && document.hasFocus()) return
  if (!osDeliverable()) return
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
// notifications INSTEAD of in-app ones — but only when the OS can actually deliver:
// if permission was never granted (or the webview has no Notification API), keeping
// the toast suppressed would drop the notification entirely, which is exactly how
// this feature looked broken.
function present(n: GhNotification): void {
  const nativeOnly = useSettingsStore().notifications.delivery === 'native' && osDeliverable()
  if (!nativeOnly) {
    pushActionToast(toastText(n), 'info', {
      icon: n.type === 'PullRequest' ? 'fork' : 'alert',
      action: () => openNotification(n),
    })
  }
  nativeNotify(n)
}

async function poll(): Promise<void> {
  if (polling) return
  const settings = useSettingsStore()
  const { t } = useI18n()
  // The inbox is fetched whenever the feature is on — with or without project
  // opt-ins, which only gate the ALERT below. A bell that stays empty because a
  // checkbox is unticked is indistinguishable from a broken poller.
  if (!settings.githubNotify.enabled) return
  if (!useSidecar().available) return
  polling = true
  try {
    const list = await fetchGhInbox()
    lastError.value = null
    setGhInbox(list)
    // Stamp the poll BEFORE presenting: a toast that throws must not make the next
    // tick treat this run as the (silent) baseline again.
    try {
      localStorage.setItem(POLLED_KEY, new Date().toISOString().replace(/\.\d+Z$/, 'Z'))
    } catch {
      // Without the stamp we re-seed once on the next launch; `seen` still dedupes.
    }

    const store = seen()
    // `n.unread` matters now that the fetch includes read threads: something the
    // user already handled on github.com must never come back as a toast.
    const fresh = list
      .filter((n) => n.unread)
      .filter(isAlerting)
      .filter((n) => store.get(n.id) !== n.updatedAt)
    for (const n of fresh) store.set(n.id, n.updatedAt)
    writeSeen()

    // Very first poll on this machine establishes the baseline silently.
    if (!seeded) {
      seeded = true
      return
    }

    for (const n of fresh.slice(0, MAX_TOASTS)) present(n)
    const overflow = fresh.length - MAX_TOASTS
    if (overflow > 0) pushActionToast(t('github.notify.more', { n: overflow }), 'info')
  } catch (err) {
    // Poll failures are silent by design (gh not installed / not authed / rate
    // limited): a toast every minute would be worse than the missing feature. The
    // bell panel + Settings → Git surface the last one instead.
    const message = err instanceof Error ? err.message : 'gh.notifications failed'
    lastError.value = message
    setGhInboxError(message)
  } finally {
    polling = false
  }
}

function schedule(): void {
  if (timer) clearInterval(timer)
  timer = null
  const settings = useSettingsStore()
  if (!settings.githubNotify.enabled) return
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
    const list = await fetchGhInbox()
    lastError.value = null
    // Counts the UNREAD subset: the question this diagnostic answers is "would a
    // notification reach me", and read threads never would.
    const unread = list.filter((n) => n.unread)
    return { status: 'ok', matched: unread.filter(isAlerting).length, total: unread.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'gh.notifications failed'
    lastError.value = message
    return { status: 'error', message }
  }
}

// Read-only view for the Settings panel + the bell panel (surface the last failure
// and how many projects are opted in, without toasting either on every tick).
export function useGhNotificationsStatus() {
  return {
    started,
    lastError,
    watchedProjectCount: computed(() => optedIn().length),
  }
}
