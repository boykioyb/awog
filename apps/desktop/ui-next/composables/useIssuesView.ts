import type { BoardItem, BoardItemStatus } from '~/stores/board'
import type { Session } from '~/composables/useSessionsData'
import type { MenuItem } from '~/composables/useContextMenu'

// Controller của khung "Issues" trong Explorer Workbench (docs/features/session-issue-tracking.md):
// trả lời câu "việc nào đang làm / tạm dừng / bị chặn / chờ review" mà không phải mở
// /board. Nhóm theo status, issue in_progress để lâu không động tới bị đánh dấu.
//
// Phạm vi: project của tab đang mở, hoặc mọi project (công tắc nhớ trong localStorage
// — tiện ích cho từng người xem, không phải dữ liệu).

// Thứ tự nhóm = thứ tự cần chú ý: thứ đang chạy và thứ đang kẹt lên đầu, việc chưa
// động tới xuống cuối. done chỉ giữ 7 ngày gần nhất; cancelled không hiện.
const GROUP_ORDER: readonly BoardItemStatus[] = [
  'in_progress',
  'blocked',
  'pending',
  'in_review',
  'changes',
  'todo',
  'backlog',
  'done',
]
const DONE_WINDOW_MS = 7 * 24 * 3600 * 1000
// in_progress mà quá ngần này không đổi gì ⇒ nhiều khả năng đã bỏ dở.
export const STALE_AFTER_MS = 3 * 24 * 3600 * 1000

const STORAGE_SCOPE = 'awog.workbench.issues.allProjects'

function readScope(): boolean {
  try {
    return localStorage.getItem(STORAGE_SCOPE) === '1'
  } catch {
    return false
  }
}

export type IssueGroup = { status: BoardItemStatus; items: BoardItem[] }

export function useIssuesView() {
  const board = useBoardStore()
  const sessions = useSessionsStore()
  const projectsStore = useProjectsStore()
  const settings = useSettingsStore()
  const toast = useToast()
  const { t } = useI18n()
  const { openSession } = useSessionTaskLink()

  const query = ref('')
  const allProjects = ref(readScope())
  watch(allProjects, (v) => {
    try {
      localStorage.setItem(STORAGE_SCOPE, v ? '1' : '0')
    } catch {
      // Storage bị chặn: công tắc chỉ sống trong phiên làm việc này.
    }
  })
  const collapsed = ref<Set<BoardItemStatus>>(new Set(['backlog', 'done']))

  const activeProject = computed(() => sessions.activeTab)
  const scopeProjects = computed(() =>
    allProjects.value || !activeProject.value
      ? projectsStore.projects.map((p) => p.id)
      : [activeProject.value],
  )

  async function reload(): Promise<void> {
    if (!projectsStore.loaded) await projectsStore.hydrate()
    await Promise.all(scopeProjects.value.map((pid) => board.listBoard(pid)))
  }
  watch(scopeProjects, () => void reload(), { immediate: true })

  const now = ref(Date.now())
  // Nhãn "để lâu" tự cập nhật mà không cần event — một nhịp mỗi phút là đủ.
  const timer = setInterval(() => (now.value = Date.now()), 60_000)
  onScopeDispose(() => clearInterval(timer))

  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

  const groups = computed<IssueGroup[]>(() => {
    const q = norm(query.value.trim())
    const items = scopeProjects.value.flatMap((pid) => board.itemsFor(pid))
    return GROUP_ORDER.map((status) => ({
      status,
      items: items
        .filter((i) => i.status === status)
        .filter((i) => status !== 'done' || now.value - Date.parse(i.updatedAt) < DONE_WINDOW_MS)
        .filter((i) => !q || norm(i.title).includes(q) || i.id.includes(q))
        .sort((a, b) => activityOf(b) - activityOf(a)),
    })).filter((g) => g.items.length > 0)
  })

  // Hoạt động gần nhất của issue = mới nhất giữa lần ghi board và lần các phiên làm
  // nó hoạt động — chat liên tục trong phiên không ghi gì xuống board, nên chỉ đọc
  // `updatedAt` của item sẽ báo nhầm "chưa động" cho việc làm mỗi ngày.
  const lastActivity = computed(() => {
    const out = new Map<string, number>()
    for (const s of sessions.sessions) {
      if (!s.issueId || !s.updatedAt) continue
      const ts = Date.parse(s.updatedAt)
      if (ts > (out.get(s.issueId) ?? 0)) out.set(s.issueId, ts)
    }
    return out
  })
  const activityOf = (it: BoardItem): number =>
    Math.max(Date.parse(it.updatedAt) || 0, lastActivity.value.get(it.id) ?? 0)

  function isStale(it: BoardItem): boolean {
    return it.status === 'in_progress' && now.value - activityOf(it) > STALE_AFTER_MS
  }
  function ageDays(it: BoardItem): number {
    return Math.floor((now.value - activityOf(it)) / (24 * 3600 * 1000))
  }

  function toggleGroup(st: BoardItemStatus): void {
    const next = new Set(collapsed.value)
    if (next.has(st)) next.delete(st)
    else next.add(st)
    collapsed.value = next
  }

  const projectName = (id: string): string => projectsStore.projectById(id)?.name ?? id

  // Phiên gần nhất đã làm issue — chỗ nối việc tự nhiên nhất khi bấm vào issue.
  function latestSession(it: BoardItem): Session | undefined {
    return sessions.sessions
      .filter((s) => !!s.engineId && (s.issueId === it.id || s.engineId === it.assigneeSessionId))
      .sort((a, b) => ((a.updatedAt ?? '') < (b.updatedAt ?? '') ? 1 : -1))[0]
  }

  function openOnBoard(it: BoardItem): void {
    void navigateTo({ path: '/board', query: { item: it.id, project: it.projectId } })
  }

  function continueNew(it: BoardItem): void {
    sessions.createForIssue(it.id, it.projectId, it.title)
  }

  // Bấm vào issue: có phiên ⇒ mở phiên đó (chip issue trên header có recap + status);
  // chưa có phiên nào ⇒ mở trên board.
  async function openIssue(it: BoardItem): Promise<void> {
    const s = latestSession(it)
    if (s?.engineId) await openSession(s.engineId)
    else openOnBoard(it)
  }

  async function recap(it: BoardItem): Promise<void> {
    try {
      await board.recapItem(it.projectId, it.id, settings.resolveAuthoringLlm())
    } catch (err) {
      toast.add({
        title: t('sessions.issue.recapFailed'),
        description: sidecarErrorText(err),
        color: 'error',
      })
    }
  }

  const ctx = useContextMenu<BoardItem>()
  const menuItems = computed<MenuItem[]>(() => {
    const it = ctx.target.value
    if (!it) return []
    return [
      ...(latestSession(it)
        ? [{ id: 'session', label: t('wb.issues.openSession'), icon: 'sessions' }]
        : []),
      { id: 'new', label: t('sessions.issue.continueNew'), icon: 'plus' },
      { id: 'recap', label: t('sessions.issue.recapRun'), icon: 'sparkles' },
      { separator: true },
      { id: 'board', label: t('sessions.issue.openBoard'), icon: 'board' },
    ]
  })
  function onMenuSelect(id: string): void {
    const it = ctx.target.value
    ctx.close()
    if (!it) return
    if (id === 'session') void openIssue(it)
    else if (id === 'new') continueNew(it)
    else if (id === 'recap') void recap(it)
    else if (id === 'board') openOnBoard(it)
  }

  return {
    query,
    allProjects,
    collapsed,
    groups,
    isStale,
    ageDays,
    toggleGroup,
    projectName,
    openIssue,
    ctx,
    menuItems,
    onMenuSelect,
    reload,
  }
}
