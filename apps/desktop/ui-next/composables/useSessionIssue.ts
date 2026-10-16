import type { Session } from '~/composables/useSessionsData'
import type { BoardItem, BoardItemStatus } from '~/stores/board'
import { RECAP_ON_STATUSES } from '~/composables/useIssueStatus'

// Issue của MỘT phiên (docs/features/session-issue-tracking.md): phiên có project là
// một người thực thi issue trên board. Composable này gom mọi thao tác của người
// dùng lên issue đó — đổi status (kèm ghi chú khi tạm dừng/bị chặn), recap, mở trên
// board, bỏ/theo dõi lại — để chip header và các bề mặt khác dùng chung một luật.
export function useSessionIssue(session: () => Session) {
  const board = useBoardStore()
  const sessions = useSessionsStore()
  const settings = useSettingsStore()
  const { t } = useI18n()
  const toast = useToast()
  const { prompt } = useTextPrompt()
  const { confirm } = useConfirm()

  const projectId = computed(() => session().project)
  const item = computed<BoardItem | undefined>(() => {
    const s = session()
    return s.issueId && s.project
      ? board.itemsFor(s.project).find((i) => i.id === s.issueId)
      : undefined
  })
  const recapping = computed(
    () => !!item.value && !!board.recapping[`${item.value.projectId}:${item.value.id}`],
  )
  // Phiên có project, chưa bỏ theo dõi, nhưng chưa có issue: lượt gửi tiếp theo sẽ
  // sinh issue. Phiên team/board có board riêng của nó nên không tính.
  const trackable = computed(() => {
    const s = session()
    return !!s.project && !s.teamId && !s.teamRunId && s.origin !== 'board'
  })

  // Board nạp lười: phiên mở ra mà board của project chưa ở cache thì nạp một lần.
  watch(
    () => [session().issueId, projectId.value] as const,
    ([id, pid]) => {
      if (id && pid && !item.value) void board.listBoard(pid)
    },
    { immediate: true },
  )

  function fail(titleKey: string, err: unknown): void {
    toast.add({ title: t(titleKey), description: sidecarErrorText(err), color: 'error' })
  }

  async function recap(opts: { quiet?: boolean } = {}): Promise<void> {
    const it = item.value
    if (!it) return
    try {
      await board.recapItem(it.projectId, it.id, settings.resolveAuthoringLlm())
    } catch (err) {
      // Recap tự động (sau khi đổi status) hỏng thì im — người dùng không bấm gì.
      if (opts.quiet) console.warn('[issue] auto recap failed', err)
      else fail('sessions.issue.recapFailed', err)
    }
  }

  // Đổi status từ tay người dùng. Tạm dừng / bị chặn hỏi một dòng ghi chú (bỏ trống
  // được) — đó chính là thứ quên sau vài ngày. Vào pending/blocked/done thì recap
  // tự chạy nền để lần quay lại có ngay bản tóm.
  async function setStatus(status: BoardItemStatus): Promise<void> {
    const it = item.value
    if (!it || it.status === status) return
    let note: string | null = null
    if (status === 'pending' || status === 'blocked') {
      note = await prompt({
        title: t(
          status === 'pending' ? 'sessions.issue.notePending' : 'sessions.issue.noteBlocked',
        ),
        submitLabel: t('sessions.issue.noteSubmit'),
      })
      // null = người dùng đóng hộp thoại ⇒ huỷ cả lần đổi status.
      if (note === null) return
    }
    const saved = await board.applyStatus(it, status)
    if (!saved) {
      fail('sessions.issue.statusFailed', new Error(it.id))
      return
    }
    if (note?.trim()) await board.commentItem(it.projectId, it.id, note.trim())
    if (RECAP_ON_STATUSES.has(status)) void recap({ quiet: true })
  }

  function openOnBoard(): void {
    const it = item.value
    if (!it) return
    void navigateTo({ path: '/board', query: { item: it.id, project: it.projectId } })
  }

  async function untrack(): Promise<void> {
    const ok = await confirm({
      title: t('sessions.issue.untrackConfirmTitle'),
      description: t('sessions.issue.untrackConfirmDesc'),
      confirmLabel: t('sessions.issue.untrack'),
    })
    if (!ok) return
    try {
      await sessions.setIssue(session().id, { untrack: true })
    } catch (err) {
      fail('sessions.issue.statusFailed', err)
    }
  }

  async function track(): Promise<void> {
    try {
      await sessions.setIssue(session().id, { issueId: null, untrack: false })
    } catch (err) {
      fail('sessions.issue.statusFailed', err)
    }
  }

  return { item, recapping, trackable, recap, setStatus, openOnBoard, untrack, track }
}
