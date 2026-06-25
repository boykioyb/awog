import { formatTime } from '~/utils/time'

// Page-controller for the Home bento dashboard (pages/index.vue). Pure
// presentation over existing store getters — no IPC, no store mutations beyond
// the selection a click implies (select-then-navigate). The page binds these
// computeds directly; all wiring lives here so the SFC stays a thin template.
export const useHomeDashboard = () => {
  const sessions = useSessionsStore()
  const tasks = useTasksStore()
  const git = useGitStore()
  const workspace = useWorkspaceStore()
  const { t: tr } = useI18n()

  // ─── Needs attention ──────────────────────────────────────────────────────
  const awaitingSessions = computed(() =>
    sessions.sessions.filter((s) => sessions.isSessionAwaitingInput(s.id)).slice(0, 5),
  )
  const awaitingTasks = computed(() =>
    tasks.tasks.filter((task) => task.status === 'waiting_approval').slice(0, 5),
  )
  const attentionCount = computed(() => awaitingSessions.value.length + awaitingTasks.value.length)
  const attentionTo = computed(() => (awaitingTasks.value.length ? '/tasks' : '/sessions'))

  // ─── Running ────────────────────────────────────────────────────────────────
  const streamingSessions = computed(() =>
    sessions.sessions
      .filter((s) => sessions.isSessionStreaming(s.id) && !sessions.isSessionAwaitingInput(s.id))
      .slice(0, 5),
  )
  const runningTasks = computed(() =>
    tasks.tasks.filter((task) => task.status === 'running').slice(0, 5),
  )
  const runningCount = computed(() => streamingSessions.value.length + runningTasks.value.length)
  const runningTo = computed(() => (runningTasks.value.length ? '/tasks' : '/sessions'))

  // ─── Git ──────────────────────────────────────────────────────────────────
  const dirtyCount = computed(() => git.dirtyCountByProject[git.selectedProjectId] ?? 0)

  // ─── Agents / Activity / Recent ─────────────────────────────────────────────
  const topAgents = computed(() => workspace.agents.slice(0, 4))

  // Recent commits in the last 24h (only populated once /git history has loaded).
  const recentCommits = computed(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    return git.commits
      .filter((c) => {
        const ts = Date.parse(c.date)
        return Number.isNaN(ts) ? false : ts >= cutoff
      })
      .slice(0, 5)
  })

  const recentSessions = computed(() =>
    [...sessions.sessions]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 6),
  )

  // ─── Navigation (select-then-navigate) ───────────────────────────────────────
  const openSession = (id: string) => {
    sessions.selectSession(id)
    void navigateTo('/sessions')
  }
  const openTask = (id: string) => {
    tasks.selectTask(id)
    void navigateTo('/tasks')
  }

  // Compact relative-time ("5m", "3h", "2d") for tile metadata. Falls back to a
  // short clock past a week. Locale-agnostic — units come from i18n keys.
  const timeAgo = (iso: string): string => {
    const ts = Date.parse(iso)
    if (Number.isNaN(ts)) return ''
    const diff = Date.now() - ts
    const min = Math.floor(diff / 60000)
    if (min < 1) return tr('home.time.now')
    if (min < 60) return tr('home.time.minutes', { n: min })
    const hr = Math.floor(min / 60)
    if (hr < 24) return tr('home.time.hours', { n: hr })
    const day = Math.floor(hr / 24)
    if (day < 7) return tr('home.time.days', { n: day })
    return formatTime(iso).split(' ')[1] ?? ''
  }

  return {
    sessions,
    git,
    workspace,
    tr,
    awaitingSessions,
    awaitingTasks,
    attentionCount,
    attentionTo,
    streamingSessions,
    runningTasks,
    runningCount,
    runningTo,
    dirtyCount,
    topAgents,
    recentCommits,
    recentSessions,
    openSession,
    openTask,
    timeAgo,
  }
}
