import { useSidecar } from '~/composables/useSidecar'
import { dispatchRunSettings } from '~/composables/useProjectLlmDefaults'
import { useSessionTaskLink } from '~/composables/useSessionTaskLink'
import { tsAfter, type SlackThread } from '~/stores/slack'

// ── Session theo thread Slack (docs/features/slack-threads.md) ───────────────
// "Mở session" + "Đưa vào session" + chấm "có reply mới chưa đưa vào phiên".
//
// Việc tạo phiên / giao khối thread làm Ở SIDECAR (`slack.session.open|push`), không
// ở store renderer: nút có ở cả cửa sổ chính lẫn cửa sổ Slack riêng (`/slack?window=1`),
// mà cửa sổ Slack chỉ nhận event `slack.*` — nó không lái được phiên. Sidecar phát
// `session.created` + `session.inbox-message` cho cửa sổ chính (cửa sổ đó tự giao tin
// khi phiên rảnh), nên ở đây chỉ còn việc ĐƯA NGƯỜI DÙNG tới phiên:
//   • cửa sổ chính  → điều hướng thẳng tới phiên (như "Chat với agent");
//   • cửa sổ Slack  → `sendTrayCommand({ kind: 'session' })`: main bật cửa sổ chính và
//     mở phiên qua đúng đường của tray/pet — không thêm kênh IPC mới. Chọn cách này
//     thay vì popout phiên vì người dùng đang ghim cửa sổ Slack để TRAO ĐỔI; phiên mở ở
//     cửa sổ chính là chỗ họ vẫn làm việc với phiên, ít bất ngờ nhất.
//
// Lỗi (Slack mất kết nối, phiên đã xoá…) được NÉM lại cho chỗ gọi — component tự toast
// bằng chuỗi i18n của nó; composable không tự nuốt. Store `slack` tự làm tươi danh sách
// nhờ `slack.changed` mà sidecar phát sau khi gắn phiên / dời mốc đồng bộ.
//
// Trước MỌI `slack.session.open|push` phải `ensureMainWindow()`: event `session.*` mà
// sidecar phát chỉ tới cửa sổ chính + popout. Gọi từ cửa sổ Slack riêng lúc cửa sổ
// chính đã đóng (macOS) hay đang nạp lại thì khối thread rơi mất — main mở lại cửa sổ
// chính và chờ renderer của nó nghe xong rồi mới cho đi tiếp. Ở cửa sổ chính thì
// resolve ngay; không có shell Electron (pnpm dev trong trình duyệt) thì bỏ qua.

type OpenResult = { sessionId: string; created: boolean }
type PushResult = { pushed: boolean }

// Thread đang có thao tác open/push dở — cấp MODULE để mọi component dùng composable
// (danh sách, header thread, chip) thấy cùng một trạng thái: bấm hai lần (hoặc bấm ở
// hai chỗ) không tạo hai phiên / giao khối hai lần. Sidecar cũng tự xếp hàng theo
// thread; đây là chặn sớm phía UI + cờ để nút hiện trạng thái bận.
const busyThreads = reactive(new Set<string>())

// Phiên Slack không được chạy ở chế độ tự duyệt (`execute`/`bypass`/`accept-edits`):
// nội dung thread là chữ người ngoài viết (L1), sidecar hạ các chế độ này về `ask`
// (slack.session.open + kẹp lại mỗi lượt ở sessions.sendMessage). Hạ luôn ở đây cho
// khớp, để cấu hình phiên hiển thị đúng cái sidecar thật sự dùng.
const UNSAFE_SLACK_MODES = new Set(['execute', 'bypass', 'accept-edits'])

export function useSlackSession() {
  const sc = useSidecar()
  const route = useRoute()
  const { openSession: openInMain } = useSessionTaskLink()

  const inSlackWindow = (): boolean => route.query.window === '1'

  function focusSession(engineId: string): void {
    if (inSlackWindow()) {
      window.awog?.sendTrayCommand?.({ kind: 'session', engineId })
      return
    }
    // `session.created` đã tới trước khi RPC trả về (cùng kênh stdio, phát trước), nên
    // store của cửa sổ này tìm thấy phiên ngay.
    void openInMain(engineId)
  }

  const isBusy = (threadId: string): boolean => busyThreads.has(threadId)

  // Chạy `fn` dưới cờ bận của thread; đang bận ⇒ bỏ qua, không gọi RPC lần hai.
  async function whileBusy(threadId: string, fn: () => Promise<void>): Promise<void> {
    if (busyThreads.has(threadId)) return
    busyThreads.add(threadId)
    try {
      await window.awog?.slack?.ensureMainWindow?.()
      await fn()
    } finally {
      busyThreads.delete(threadId)
    }
  }

  async function openSession(thread: SlackThread): Promise<void> {
    await whileBusy(thread.id, async () => {
      // Cấu hình LLM theo project của thread (llmDefaults → global) — cùng helper mà
      // board / "chat với agent" dùng khi sidecar tạo phiên hộ.
      const settings = dispatchRunSettings(thread.projectId)
      if (UNSAFE_SLACK_MODES.has(settings.mode)) settings.mode = 'ask'
      const res = await sc.request<OpenResult>('slack.session.open', {
        threadId: thread.id,
        settings,
      })
      focusSession(res.sessionId)
    })
  }

  async function pushToSession(thread: SlackThread): Promise<void> {
    await whileBusy(thread.id, async () => {
      await sc.request<PushResult>('slack.session.push', { threadId: thread.id })
    })
  }

  // Phiên đã gắn mà Slack có reply mới hơn mốc đã đưa vào phiên. Chỉ là chấm báo —
  // đưa vào phiên vẫn là việc người dùng bấm (không tự wake).
  function hasNewForSession(thread: SlackThread): boolean {
    return Boolean(thread.sessionId) && tsAfter(thread.lastReplyTs, thread.sessionSyncedTs ?? '0')
  }

  return { openSession, pushToSession, hasNewForSession, isBusy }
}
