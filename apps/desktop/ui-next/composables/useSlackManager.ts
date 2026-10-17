import {
  computed,
  inject,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  provide,
  ref,
  watch,
  type InjectionKey,
} from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { useToast } from '~/composables/useToast'
import { useConfirm } from '~/composables/useConfirm'
import { useSlackTranslation } from '~/composables/useSlackTranslation'
import { useSlackMessageActions } from '~/composables/useSlackMessageActions'
import { useSlackSession } from '~/composables/useSlackSession'
import { useSlackModal } from '~/composables/useSlackModal'
import { useSlackPolling } from '~/composables/useSlackPolling'
import { SLACK_NO_PROJECT, threadTitle, useSlackTree } from '~/composables/useSlackTree'
import { copyText } from '~/utils/clipboard'
import { describeSlackError, SLACK_AUTH_CODES, slackErrorCode } from '~/utils/slack-errors'
import { slackBridge, tsAfter, useSlackStore, type SlackThread } from '~/stores/slack'

// Controller của Slack threads (docs/features/slack-threads.md). Toàn bộ state + handler
// ở đây; SlackWorkspace chỉ còn template. Component con (danh sách, khung thread, tin
// nhắn) đọc cùng context qua `useSlackCtx()` thay vì truyền prop qua 3 tầng.
//
// Hai chế độ, cùng một nội dung:
//   • `modal`  — trong cửa sổ chính (SlackModal, mount ở AppGlobalHosts). SlackWorkspace
//     chỉ mount khi modal mở ⇒ "đang hiện" = đã mount; đóng modal là gỡ hết, poll dừng.
//   • `window` — cửa sổ Slack riêng (`/slack?window=1`, electron/src/slack-window.ts):
//     ghim luôn-nằm-trên, thread qua `?thread=` / onNavigate, KeepAlive-aware.
//
// Poll (useSlackPolling): nhịp nhanh nạp lại thread đang mở (thấy cả sửa/xoá/reaction
// của người khác — `slack.poll` chỉ dò reply mới), nhịp chậm hỏi các thread còn lại.

export type SlackMode = 'modal' | 'window'

export function threadPermalink(th: SlackThread): string {
  const base = th.teamUrl.endsWith('/') ? th.teamUrl : `${th.teamUrl}/`
  return `${base}archives/${th.channelId}/p${th.threadTs.replace('.', '')}`
}

function createSlackManager(mode: SlackMode) {
  const store = useSlackStore()
  const sc = useSidecar()
  const toast = useToast()
  const { confirm } = useConfirm()
  const { t } = useI18n()
  const route = useRoute()
  const translation = useSlackTranslation()
  const session = useSlackSession()
  const modal = useSlackModal()
  const tree = useSlackTree()

  const isWindow = mode === 'window'
  const hasSlackBridge = computed(() => !!slackBridge())

  const selectedId = ref<string | null>(null)
  const addOpen = ref(false)
  const settingsOpen = ref(false)
  const pinned = ref(false)
  const refreshing = ref(false)

  const fail = (titleKey: string, err: unknown): void => {
    toast.add({ title: t(titleKey), description: describeSlackError(err, t), color: 'error' })
    const { code } = slackErrorCode(err)
    if (code && SLACK_AUTH_CODES.has(code)) void store.fetchStatus().catch(() => undefined)
  }

  // ── Thread đang mở ──────────────────────────────────────────────────────────
  const selected = computed(() =>
    selectedId.value ? store.threadById(selectedId.value) : undefined,
  )
  const detail = computed(() =>
    store.detail && store.detail.thread.id === selectedId.value ? store.detail : null,
  )
  const latestTs = computed(() => detail.value?.messages.at(-1)?.ts ?? null)

  const polling = useSlackPolling({
    onFast: () => void reloadSelected({ quiet: true }),
    onSlow: () => void pollOthers(),
    onVisible: () => {
      void reloadSelected({ quiet: true })
      void markSeenIfViewing()
    },
    canRun: () => store.available,
  })

  async function markSeenIfViewing(): Promise<void> {
    const th = selected.value
    const ts = latestTs.value
    const viewing = polling.active.value && polling.visible.value
    if (!th || !ts || !viewing || !tsAfter(ts, th.lastSeenTs)) return
    try {
      await store.markSeen(th.id, ts)
    } catch {
      // Chấm chưa đọc còn lại tới lần xem sau — không đáng một toast.
    }
  }

  // Dịch các tin đang HIỆN ở dạng bản dịch: cả thread khi "Dịch toàn bộ", hoặc riêng các
  // tin đã bấm 🌐 — sau khi đổi cài đặt dịch, tin lật riêng cũng phải dịch lại.
  async function translateDetail(): Promise<void> {
    const d = detail.value
    const shown = d ? d.messages.filter((m) => !translation.isOriginal(m)) : []
    if (!d || !shown.length) return
    try {
      await translation.ensure(d.thread.id, shown, d.thread.projectId)
    } catch (err) {
      fail('slack.toast.translateFailed', err)
    }
  }

  // Gộp các lần gọi chồng nhau (event + nhịp poll + bấm Refresh) thành tối đa một lượt
  // chạy thêm. `quiet` (nhịp poll): lỗi không toast mỗi 20s, chỉ đọc lại trạng thái
  // nguồn để banner nói — trừ khi trong loạt gộp có một lời gọi KHÔNG quiet.
  let loading: Promise<void> | null = null
  let again = false
  let loud = false
  async function reloadSelected(opts: { quiet?: boolean } = {}): Promise<void> {
    if (!opts.quiet) loud = true
    if (loading) {
      again = true
      return loading
    }
    loading = (async () => {
      do {
        again = false
        const id = selectedId.value
        if (!id) break
        try {
          await store.loadDetail(id)
        } catch (err) {
          if (loud) fail('slack.toast.loadFailed', err)
          else void store.fetchStatus().catch(() => undefined)
          // `continue` chứ không `break`: người dùng có thể đã chọn thread khác trong
          // lúc chờ (`again`) — thread cũ lỗi không được chặn thread mới nạp.
          continue
        }
        void markSeenIfViewing()
        void translateDetail()
      } while (again)
    })()
    try {
      await loading
    } finally {
      loading = null
      loud = false
    }
  }

  async function loadOlder(): Promise<boolean> {
    try {
      return await store.loadOlder()
    } catch (err) {
      fail('slack.toast.loadFailed', err)
      return false
    }
  }

  function select(id: string): void {
    if (selectedId.value === id) return
    selectedId.value = id
    if (!isWindow) modal.threadId.value = id
    translation.resetFlips()
    store.clearDetail()
    void reloadSelected()
  }

  // ── Làm mới + poll ──────────────────────────────────────────────────────────
  async function pollOthers(): Promise<void> {
    const ids = store.threads.filter((x) => x.id !== selectedId.value && !x.error).map((x) => x.id)
    if (!ids.length) return
    try {
      await store.poll({ threadIds: ids })
    } catch {
      // Poll hỏng thường là token hết hạn / mất mạng — banner trạng thái nói việc đó.
      void store.fetchStatus().catch(() => undefined)
    }
  }

  // "Làm mới": đọc lại trạng thái + danh sách, ÉP poll mọi thread (bỏ nhịp giãn của
  // sidecar — người dùng chủ động hỏi), rồi nạp lại thread đang mở.
  async function refreshAll(): Promise<void> {
    refreshing.value = true
    try {
      await Promise.all([store.fetchStatus(), store.fetchThreads()])
      await Promise.all([store.poll({ force: true }), reloadSelected()])
    } catch (err) {
      fail('slack.toast.loadFailed', err)
    } finally {
      refreshing.value = false
    }
  }

  // `slack.changed` đến sau MỌI thao tác ghi (kể cả markSeen của chính bề mặt này và
  // thread.get đồng bộ số reply). Không nạp lại chi tiết mỗi lần — thread.get lại phát
  // event, thành vòng get → changed → get; chỉ nạp khi danh sách (store đã đọc lại) có
  // reply mới hơn bản đang hiện. Sửa/xoá/reaction của người khác do nhịp nhanh lo.
  const offChanged = store.onChanged((ids) => {
    const th = selected.value
    if (!th || !ids.includes(th.id)) return
    const shown = latestTs.value
    if (!shown || tsAfter(th.lastReplyTs, shown)) void reloadSelected({ quiet: true })
  })

  // Đổi cài đặt dịch / bảng thuật ngữ (ở cửa sổ này hay cửa sổ kia): bản dịch đang hiện
  // theo cài đặt cũ ⇒ bỏ rồi dịch lại các tin đang hiện bản dịch. Đổi chỉ `sendLang` cũng
  // đi qua đây — sidecar trả lại từ cache (khoá không đổi) nên không tốn lời gọi model.
  const offSettings = store.onSettingsChanged(() => {
    translation.clearTexts()
    void translateDetail()
  })

  function activate(): void {
    if (!polling.activate()) return
    // Cài đặt dịch (ngôn ngữ đọc/gửi, model riêng) — lỗi thì dùng bản đang có/mặc định.
    void store.fetchSettings().catch(() => undefined)
    void refreshAll()
    if (isWindow)
      void slackBridge()
        ?.isAlwaysOnTop()
        .then((on) => (pinned.value = on))
  }

  // Thread ban đầu: modal nhớ thread lần trước (useSlackModal); cửa sổ riêng nhận qua
  // `?thread=`, các lần sau qua onNavigate (main không nạp lại trang khi chuyển thread).
  const queryThread = typeof route.query.thread === 'string' ? route.query.thread : null
  const initialThread = isWindow ? queryThread : modal.threadId.value
  if (initialThread) select(initialThread)
  const offNavigate = isWindow ? slackBridge()?.onNavigate((id) => select(id)) : undefined
  // Modal đang mở mà có chỗ khác gọi open(threadId) (chip phiên…) ⇒ chuyển sang thread đó.
  if (!isWindow) {
    watch(modal.threadId, (id) => {
      if (id) select(id)
    })
  }

  onMounted(activate)
  // Chỉ có tác dụng với trang cửa sổ riêng (nằm trong KeepAlive của NuxtPage).
  onActivated(activate)
  onDeactivated(polling.deactivate)
  onBeforeUnmount(() => {
    offChanged()
    offSettings()
    offNavigate?.()
  })

  watch(
    () => translation.showOriginal.value,
    (orig) => {
      if (!orig) void translateDetail()
    },
  )

  // ── Thao tác trên thread ────────────────────────────────────────────────────
  async function addThread(url: string, projectId: string | null): Promise<boolean> {
    try {
      const th = await store.addThread(url, projectId)
      addOpen.value = false
      select(th.id)
      return true
    } catch (err) {
      fail('slack.toast.addFailed', err)
      return false
    }
  }

  async function rename(title: string): Promise<void> {
    const th = selected.value
    if (!th) return
    const next = title.trim() || null
    if (next === th.title) return
    try {
      await store.updateThread(th.id, { title: next })
    } catch (err) {
      fail('slack.toast.updateFailed', err)
    }
  }

  const threadProject = computed<string>({
    get: () => selected.value?.projectId ?? SLACK_NO_PROJECT,
    set: (v) => {
      const th = selected.value
      if (!th) return
      store
        .updateThread(th.id, { projectId: v === SLACK_NO_PROJECT ? null : v })
        .catch((err) => fail('slack.toast.updateFailed', err))
    },
  })

  async function removeThread(): Promise<void> {
    const th = selected.value
    if (!th) return
    const ok = await confirm({
      title: t('slack.remove.title'),
      description: t('slack.remove.body', { title: threadTitle(th) }),
      confirmLabel: t('slack.remove.confirm'),
    })
    if (!ok) return
    try {
      await store.removeThread(th.id)
      selectedId.value = null
      if (!isWindow) modal.threadId.value = null
    } catch (err) {
      fail('slack.toast.removeFailed', err)
    }
  }

  async function markRead(): Promise<void> {
    const th = selected.value
    if (!th) return
    try {
      await store.markSeen(th.id, th.lastReplyTs)
    } catch (err) {
      fail('slack.toast.updateFailed', err)
    }
  }

  async function copyLink(): Promise<void> {
    if (!selected.value) return
    const ok = await copyText(threadPermalink(selected.value))
    toast.add({
      title: t(ok ? 'slack.toast.linkCopied' : 'slack.toast.copyFailed'),
      color: ok ? 'success' : 'error',
    })
  }

  // Mở thẳng bằng OS (app Slack desktop bắt link) — cố ý không qua bộ chọn "mở link ở
  // đâu": trình duyệt nhúng của agent không có phiên đăng nhập Slack của người dùng.
  async function openInSlack(): Promise<void> {
    if (!selected.value) return
    try {
      await sc.openExternal(threadPermalink(selected.value))
    } catch (err) {
      fail('slack.toast.openFailed', err)
    }
  }

  // Modal → cửa sổ riêng: mở cửa sổ ở đúng thread đang xem rồi đóng modal (hai bề mặt
  // cùng lúc chỉ làm người dùng phân vân đang trả lời ở đâu).
  async function openWindow(): Promise<void> {
    try {
      await slackBridge()?.openWindow(selectedId.value ?? undefined)
      modal.close()
    } catch (err) {
      fail('slack.toast.openFailed', err)
    }
  }

  async function togglePin(): Promise<void> {
    const bridge = slackBridge()
    if (!bridge) return
    pinned.value = await bridge.setAlwaysOnTop(!pinned.value)
  }

  // ── Session theo thread (useSlackSession do lớp session cung cấp) ────────────
  const newForSession = computed(() =>
    selected.value ? session.hasNewForSession(selected.value) : false,
  )
  const sessionBusy = computed(() => (selected.value ? session.isBusy(selected.value.id) : false))
  const newReplyCount = computed(() => {
    const th = selected.value
    const d = detail.value
    if (!th?.sessionId || !d) return 0
    const since = th.sessionSyncedTs
    return d.messages.filter((m) => !m.isParent && (!since || tsAfter(m.ts, since))).length
  })
  async function openSession(): Promise<void> {
    const th = selected.value
    if (!th) return
    // Trong modal: đóng TRƯỚC rồi mới điều hướng, nếu không modal che mất phiên vừa mở.
    if (!isWindow) modal.close()
    try {
      await session.openSession(th)
    } catch (err) {
      fail('slack.toast.sessionFailed', err)
    }
  }
  // "Đưa vào session" không điều hướng (chỉ giao khối vào phiên) ⇒ modal giữ nguyên.
  async function pushToSession(): Promise<void> {
    if (!selected.value) return
    try {
      await session.pushToSession(selected.value)
    } catch (err) {
      fail('slack.toast.sessionFailed', err)
    }
  }

  const messages = useSlackMessageActions({ detail, reload: reloadSelected, fail })

  // Tiêu đề cửa sổ chỉ đổi ở cửa sổ riêng — modal nằm trong cửa sổ chính.
  if (isWindow) {
    useHead({
      title: computed(() =>
        selected.value ? `Slack: ${threadTitle(selected.value)}` : 'Slack — AWOG',
      ),
    })
  }

  return {
    store,
    translation,
    mode,
    isWindow,
    hasSlackBridge,
    ...tree,
    selectedId,
    selected,
    detail,
    select,
    reloadSelected: (): Promise<void> => reloadSelected(),
    loadOlder,
    addOpen,
    addThread,
    settingsOpen,
    refreshing,
    refreshAll,
    pinned,
    togglePin,
    openWindow,
    closeModal: modal.close,
    rename,
    threadProject,
    removeThread,
    markRead,
    copyLink,
    openInSlack,
    newForSession,
    sessionBusy,
    newReplyCount,
    openSession,
    pushToSession,
    fail,
    ...messages,
  }
}

export type SlackCtx = ReturnType<typeof createSlackManager>

const SLACK_CTX: InjectionKey<SlackCtx> = Symbol('slack-ctx')

/** Gọi MỘT lần ở SlackWorkspace: dựng state, đăng ký vòng đời, cấp context cho con. */
export function useSlackManager(mode: SlackMode): SlackCtx {
  const ctx = createSlackManager(mode)
  provide(SLACK_CTX, ctx)
  return ctx
}

/** Context Slack cho component con. Ngoài cây SlackWorkspace là lỗi lập trình. */
export function useSlackCtx(): SlackCtx {
  const ctx = inject(SLACK_CTX, null)
  if (!ctx) throw new Error('useSlackCtx() called outside SlackWorkspace')
  return ctx
}
