import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import {
  addBoardItemComment,
  BoardError,
  getBoardItem,
  MAX_COMMENT_LEN,
} from '../boards/store.js'
import { MESSAGE_ID_RE } from '../sessions/ids.js'
import { postSessionMessage } from '../sessions/inbox.js'
import { activeSessionIds } from '../sessions/runner.js'
import { listSessionSummaries } from '../sessions/store.js'
import { log } from '../util/logger.js'

// Comment của NGƯỜI DÙNG lên một work-item (docs/features/session-teams.md §7) —
// phần "trao đổi dính vào issue" của board. Đường của model là tool
// `team_item_comment`, gọi thẳng cùng `addBoardItemComment`.
//
// `from` KHÔNG nằm trong payload: RPC này luôn là người dùng (`from: null`),
// giống `sessions.postMessage` — không có cách nào mạo danh một phiên qua đây.
//
// Comment của user cũng WAKE assignee: item thread là kênh trao đổi trực tiếp
// với agent đang giữ việc — nếu không bắn inbox thì agent không bao giờ biết
// có tin mới và không bao giờ trả lời (khác kênh ê-kíp vốn đã có mentions).
const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]*$/

const Params = z.object({
  projectId: z.string().min(3).max(64).regex(PROJECT_ID_RE),
  itemId: z.string().min(1).max(64).regex(MESSAGE_ID_RE),
  text: z.string().min(1).max(MAX_COMMENT_LEN),
})

register('boards.comment', async (raw) => {
  const params = Params.parse(raw)
  try {
    const comment = await addBoardItemComment(params.projectId, params.itemId, {
      from: null,
      fromTitle: 'You',
      text: params.text,
    })
    if (!comment) throw new RpcError(-32004, 'Board item not found')
    // Trả kèm item đã merge — renderer cập nhật cache theo một nhát thay vì
    // phải re-list cả board (thread cần comment hiện ngay).
    const item = await getBoardItem(params.projectId, params.itemId)
    const wake = await wakeCommentAssignee(params.itemId, item, params.text)
    return { comment, item, wake }
  } catch (err) {
    if (err instanceof BoardError) throw new RpcError(-32602, err.message, { code: err.code })
    throw err
  }
})

// Kết quả báo lại cho UI sau khi USER comment — "tương tác thật" cần biết tin
// đã tới ai chưa:
//   'delivered' — assignee sống và RẢNH: tin chạy ngay ở renderer
//   'queued'    — assignee đang trong một lượt: tin xếp sau lượt hiện tại
//   'none'      — item chưa giao / phiên nhận đã đóng: KHÔNG ai được báo
//   'failed'    — inbox nổ lỗi (comment vẫn đã ghi — wake là best-effort)
export type CommentWake = 'delivered' | 'queued' | 'none' | 'failed'

// Bắn inbox cho assignee của item khi USER comment — best-effort trọn vẹn:
// phiên đã xoá/archived hay inbox lỗi đều không được làm hỏng comment đã ghi.
// Giống wakeAssignee của boards.upsert nhưng nội dung là "có tin mới" chứ
// không phải "được giao việc".
async function wakeCommentAssignee(
  itemId: string,
  item: Awaited<ReturnType<typeof getBoardItem>>,
  text: string,
): Promise<CommentWake> {
  const to = item?.assigneeSessionId
  if (!item || !to || to === 'user') return 'none'
  try {
    const summaries = await listSessionSummaries()
    const target = summaries.find((s) => s.id === to)
    if (!target || target.archived) return 'none'
    const preview = text.length > 800 ? `${text.slice(0, 800)}…` : text
    // from: null = người dùng — đúng tác giả, đồng thời tránh self-target khi
    // assignee là root của chính run (from=teamRunId sẽ nổ InboxError).
    //
    // Giọng tin QUYẾT ĐỊNH kiểu agent đáp: phải đọc như một teammate đang chat
    // trong thread, không phải notice hệ thống — đáp bằng NGÔN NGỮ của user,
    // tự nhiên + ngắn, rồi thật sự LÀM điều được yêu cầu và báo lại trong
    // thread (transcript của nó user không nhìn thấy). @tên → chuyển tiếp cho
    // đồng đội qua send_session_message (cùng run được phép).
    await postSessionMessage({
      from: null,
      to,
      text:
        `[board] New comment from the user in the thread of "${item.title}" (${itemId}): "${preview}". ` +
        'That thread is your direct chat with the user about this item — treat it like team chat, not a ticket queue. ' +
        'Reply IN THE THREAD via team_item_comment, in the user\'s language: acknowledge naturally and briefly like a teammate — say what you will do, or ask if something is unclear. ' +
        'Then actually do the work and post progress/results in the thread as you go — the user cannot see your transcript. ' +
        'If the comment addresses a teammate (@name), relay it with send_session_message. Read the thread first via team_item_get if you need context.',
    })
    // Đích đang chạy một lượt ⇒ renderer xếp tin sau lượt đó thay vì chạy ngay —
    // UI cần phân biệt để nói đúng "đang bận, sẽ nhận sau" thay vì im lặng.
    return activeSessionIds().includes(to) ? 'queued' : 'delivered'
  } catch (err) {
    log.warn('boards.comment: assignee wake failed', {
      to,
      err: err instanceof Error ? err.message : String(err),
    })
    return 'failed'
  }
}
