import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useSessionsStore } from '~/stores/sessions'
import { useSidecar } from '~/composables/useSidecar'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useConfirm } from '~/composables/useConfirm'
import { STATUS_COLOR, isBoardSession, type Session } from '~/composables/useSessionsData'
import {
  contextTokensFromUsage,
  estimateContextTokens,
  formatTokenCount,
  measuredContextTokens,
} from '~/utils/context-window'
import { isRunStatus } from '~/composables/useSessionSwitcher'
import { useContextMenu, type MenuItem } from '~/composables/useContextMenu'

// Page-controller của SessionStrip.vue — tab = phiên của project đang mở
// (sessions.activeTab). × = archive (không mất phiên, restore ở popover ▾);
// + = phiên mới; ▾ = popover quản lý: list sort theo ctx, clear/đóng từng
// phiên, section "Đã đóng" restore/xoá vĩnh viễn, footer Σ ctx + Clear.
export function useSessionStrip() {
  const sessions = useSessionsStore()
  const sc = useSidecar()
  const { t } = useI18n()
  const toast = useToast()
  const { confirm } = useConfirm()
  const ctx = useContextMenu<Session>()

  // Tab = phiên của project đang mở, trừ phiên đã archive (vào popover ▾) và
  // phiên "của board" (vòng đời ở Teams/board — cùng bộ lọc với SessionList).
  // Ghim lên đầu, phần còn lại giữ thứ tự store (mới nhất trước) — `sort` của JS ổn
  // định nên thứ tự trong mỗi nhóm không đổi. Trước đây Workbench bỏ qua bước này
  // (danh sách /sessions cũ tự sort ở SessionList) nên "Ghim" đổi cờ mà không thấy gì.
  const tabs = computed<Session[]>(() =>
    sessions.tabSessions
      .filter((s) => !sessions.isArchived(s.id) && !isBoardSession(s))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)),
  )
  // Cap số tab render: project có thể có hàng trăm phiên (panwall=207). Tab đang
  // active + các phiên mới nhất được ưu tiên; phần còn lại chỉ vào menu ▾.
  const MAX_TABS = 25
  const visibleTabs = computed<Session[]>(() => {
    const list = tabs.value
    if (list.length <= MAX_TABS) return list
    const activeId = sessions.activeId
    const activeIdx = list.findIndex((s) => s.id === activeId)
    if (activeIdx < 0 || activeIdx < MAX_TABS) return list.slice(0, MAX_TABS)
    // giữ active + đủ MAX_TABS phiên gần nó
    const start = Math.max(0, activeIdx - MAX_TABS + 1)
    return list.slice(start, start + MAX_TABS)
  })

  // Phiên đã archive CỦA project đang mở — nguồn restore trong popover ▾.
  const archived = computed<Session[]>(() =>
    sessions.tabSessions.filter((s) => sessions.isArchived(s.id)),
  )

  // Lọc popover theo `menuQuery` — project panwall có 209 archived, cuộn không
  // kịp. Query rỗng ⇒ toàn bộ.
  const menuQuery = ref('')
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const matchTitle = (s: Session) =>
    !menuQuery.value || norm(s.title).includes(norm(menuQuery.value))
  const filteredArchived = computed<Session[]>(() => archived.value.filter(matchTitle))

  function create() {
    sessions.create(sessions.activeTab || undefined)
  }

  // × = đóng tab → archive (proto: sessClosed). Phiên chưa có engineId chưa lưu
  // được (sessions.setArchived báo "chưa lưu") → remove thay vì archive. Đóng
  // tab đang active → nhảy sang tab kế đúng khuôn proto (i-1).
  function closeTab(s: Session) {
    const idx = tabs.value.findIndex((x) => x.id === s.id)
    const wasActive = sessions.activeId === s.id
    if (s.engineId) void sessions.setArchived(s.id, true)
    else sessions.remove(s.id)
    if (wasActive) {
      const next = tabs.value.filter((x) => x.id !== s.id)
      const target = next[Math.max(0, idx - 1)] ?? next[0]
      if (target) sessions.setActive(target.id)
    }
  }
  // ── Context menu của một tab phiên — phần "tab" (close / close-others /
  // close-left / close-right / close-all / clear ctx); phần thao tác trên phiên
  // (open, rename, pin, …) nằm ở useSessionActions và SessionsView ghép lên đầu.
  // Đóng = archive (remove nếu phiên chưa có engineId), nên không có "close
  // pinned" riêng — mọi close đều qua `closeTab`.
  const ctxItems = computed<MenuItem[]>(() => {
    const s = ctx.target.value
    if (!s) return []
    const list = tabs.value
    const i = list.findIndex((x) => x.id === s.id)
    const othersCount = list.length - 1
    const rightCount = Math.max(0, list.length - 1 - i)
    const leftCount = Math.max(0, i)
    const sep: MenuItem = { separator: true }
    return [
      { id: 'close', label: t('wb.strip.ctx.close') },
      {
        id: 'close-others',
        label: t('wb.strip.ctx.closeOthers', { n: othersCount }),
        disabled: othersCount === 0,
      },
      {
        id: 'close-right',
        label: t('wb.strip.ctx.closeRight', { n: rightCount }),
        disabled: rightCount === 0,
      },
      {
        id: 'close-left',
        label: t('wb.strip.ctx.closeLeft', { n: leftCount }),
        disabled: leftCount === 0,
      },
      sep,
      {
        id: 'clear-ctx',
        label: t('wb.strip.clearCtx'),
        disabled: isRunStatus(s.status) || ctxTokens(s) === 0,
      },
      sep,
      {
        id: 'close-all',
        label: t('wb.strip.ctx.closeAll', { n: list.length }),
        danger: true,
        disabled: list.length === 0,
      },
    ]
  })

  // `target` mặc định là phiên ctx đang mở; caller đã đóng ctx trước khi dispatch
  // (SessionsView thử useSessionActions trước) thì truyền phiên vào tường minh.
  async function onCtxSelect(id: string, target: Session | null = ctx.target.value) {
    const s = target
    ctx.close()
    if (!s) return
    const list = tabs.value
    const i = list.findIndex((x) => x.id === s.id)
    switch (id) {
      case 'close':
        closeTab(s)
        break
      case 'close-others': {
        for (const x of list.filter((y) => y.id !== s.id)) closeTab(x)
        break
      }
      case 'close-right': {
        for (const x of list.slice(i + 1)) closeTab(x)
        break
      }
      case 'close-left': {
        for (const x of list.slice(0, i)) closeTab(x)
        break
      }
      case 'clear-ctx':
        await clearCtx(s)
        break
      case 'close-all': {
        const ok = await confirm({
          title: t('wb.strip.ctx.closeAllTitle'),
          description: t('wb.strip.ctx.closeAllDesc', { n: list.length }),
          confirmLabel: t('wb.strip.ctx.closeAllConfirm', { n: list.length }),
          kind: 'danger',
        })
        if (!ok) break
        for (const x of [...list]) closeTab(x)
        break
      }
      default:
        break
    }
  }
  // ── Popover quản lý (▾) ────────────────────────────────────────────────────
  const menuOpen = ref(false)
  function toggleMenu() {
    menuOpen.value = !menuOpen.value
    if (menuOpen.value) void sessions.loadArchivedSessions()
  }

  // Sort theo ctx giảm dần như proto (phiên nặng nhất lên đầu).
  const sortedForMenu = computed<Session[]>(() =>
    tabs.value.slice().sort((a, b) => ctxTokens(b) - ctxTokens(a)),
  )
  const filteredTabs = computed<Session[]>(() => sortedForMenu.value.filter(matchTitle))

  function ctxTokens(s: Session): number {
    return (
      measuredContextTokens(s.usage) ||
      contextTokensFromUsage(s.usage) ||
      estimateContextTokens(s.msgs)
    )
  }
  const fmtTokens = formatTokenCount
  function costLabel(s: Session): string {
    return s.usage?.cost != null ? ` · $${s.usage.cost.toFixed(2)}` : ''
  }
  const totalCtx = computed(() => tabs.value.reduce((acc, s) => acc + ctxTokens(s), 0))
  const heaviest = computed(() => sortedForMenu.value[0]?.title ?? '—')
  function barW(s: Session): number {
    return Math.round(Math.min(100, sessions.usagePct(s)))
  }
  function activateRow(id: number) {
    sessions.setActive(id)
    menuOpen.value = false
  }

  // "Clear context" = xoá transcript, giữ phiên: sessions.truncate với
  // keepThroughId null là đường persist chính thức (sessions.rewind gọi đúng RPC
  // này sau khi dọn state). Guard phiên đang chạy — nút đã disable.
  async function clearCtx(s: Session) {
    if (!s.engineId) {
      s.msgs = []
      return
    }
    try {
      await sc.request('sessions.truncate', { sessionId: s.engineId, keepThroughId: null })
      s.msgs = []
      s.usage = undefined
      s.bookmarks = []
      if (s.todos?.length) sessions.setTodos(s.id, [])
    } catch (err) {
      toast.add({ title: err instanceof Error ? err.message : String(err), color: 'error' })
    }
  }

  // Clear footer: xoá transcript MỌI phiên không-chạy của project — hành động
  // nguy hiểm nên qua confirm. Chạy tuần tự để lỗi hiện đúng từng phiên.
  async function clearAll() {
    const targets = tabs.value.filter((s) => !isRunStatus(s.status) && ctxTokens(s) > 0)
    if (!targets.length) return
    const ok = await confirm({
      title: t('wb.strip.clearAllTitle'),
      description: t('wb.strip.clearAllDesc', { n: targets.length }),
      confirmLabel: t('wb.strip.clearAllConfirm', { n: targets.length }),
      kind: 'danger',
    })
    if (!ok) return
    for (const s of targets) await clearCtx(s)
  }

  // Restore: gỡ cờ archive + activate (proto: mở lại là mở luôn).
  async function restore(s: Session) {
    await sessions.setArchived(s.id, false)
    sessions.setActive(s.id)
    menuOpen.value = false
  }

  // Xoá vĩnh viễn một phiên đã archive — confirm vì transcript mất hẳn.
  async function removeForever(s: Session) {
    const ok = await confirm({
      title: t('wb.strip.deleteTitle', { title: s.title }),
      description: t('wb.strip.deleteDesc'),
      confirmLabel: t('wb.strip.deleteConfirm'),
      kind: 'danger',
    })
    if (ok) sessions.remove(s.id)
  }

  // Đóng popover khi bấm ra ngoài (nút ▾ + thân popover mang data-wb-mgr →
  // không đếm là ngoài; mousedown của nút chạm document trước khi click
  // toggles).
  function onDocDown(e: MouseEvent) {
    if (!menuOpen.value) return
    if (!(e.target instanceof Element) || !e.target.closest('[data-wb-mgr]')) menuOpen.value = false
  }
  onMounted(() => window.addEventListener('mousedown', onDocDown))
  onBeforeUnmount(() => window.removeEventListener('mousedown', onDocDown))

  return {
    sessions,
    ctx,
    ctxItems,
    onCtxSelect,
    tabs,
    visibleTabs,
    menuQuery,
    filteredArchived,
    create,
    closeTab,
    menuOpen,
    toggleMenu,
    filteredTabs,
    ctxTokens,
    fmtTokens,
    costLabel,
    totalCtx,
    heaviest,
    barW,
    activateRow,
    clearCtx,
    clearAll,
    restore,
    removeForever,
    STATUS_COLOR,
    isRunStatus,
    t,
  }
}
