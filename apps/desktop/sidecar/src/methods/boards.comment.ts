import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import {
  addBoardItemComment,
  BoardError,
  getBoardItem,
  MAX_COMMENT_LEN,
  upsertBoardItem,
} from '../boards/store.js'
import {
  loadMentionRosters,
  materializeAssigneeRef,
  mentionHandles,
  resolveMentionTarget,
} from '../boards/mentions.js'
import { MESSAGE_ID_RE } from '../sessions/ids.js'
import { postSessionMessage } from '../sessions/inbox.js'
import { activeSessionIds } from '../sessions/runner.js'
import { listSessionSummaries } from '../sessions/store.js'
import { log } from '../util/logger.js'
import type { Agent, BoardItem, TeamSpec } from '../types/shared.js'

// Comment của NGƯỜI DÙNG lên một work-item (docs/features/session-teams.md §7) —
// phần "trao đổi dính vào issue" của board. Đường của model là tool
// `team_item_comment`, gọi thẳng cùng `addBoardItemComment`.
//
// `from` KHÔNG nằm trong payload: RPC này luôn là người dùng (`from: null`),
// giống `sessions.postMessage` — không có cách nào mạo danh một phiên qua đây.
//
// Comment của user PHẢI tới được người nhận — "chat nhận việc" trên thread:
//   • item có assignee sống            → ping assignee (đường cũ);
//   • item còn `assigneeRef` đỗ        → materialize spec (agents.run/teams.run/
//                                        sessions.materializeMember), gán
//                                        sessionId rồi ping — ref là lời gán
//                                        của chính người dùng, comment phải
//                                        đánh thức được nó;
//   • item trống assignee + có @handle  → resolve handle (phiên sống → bench
//                                        member → agent spec → team spec),
//                                        đích đầu nhận item + được ping;
//   • @handle còn lại (kể cả item đã có  → được ping để tham gia thread —
//    chủ)                               không cướp assignee;
//   • không ai khớp                     → 'none', UI báo "chưa ai được báo".
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
    let item = await getBoardItem(params.projectId, params.itemId)
    const wakes: CommentWake[] = []
    // Biên nhận giao tin cho MỖI đích — ghi lại thành một vạch system trong
    // thread. Không có nó thì comment "đã lưu nhưng không ai được báo" chỉ
    // biết ở banner mờ; user cần THẤY tin đã tới ai và người đó đang bận hay
    // rảnh — đó là "nhận việc" mức thấp nhất mà hệ thống chứng minh được,
    // không phụ thuộc model có chịu gọi team_item_comment hay không.
    const receipts: { title: string; wake: CommentWake }[] = []
    const pinged = new Set<string>()
    let summaries = await listSessionSummaries()
    const handles = mentionHandles(params.text)
    // Roster spec chỉ nạp khi comment thật sự cần resolve (mention hoặc không
    // có đường wake nào khác) — một listAgents+listTeams đọc file, đừng trả cho
    // mọi comment "ok anh".
    let rosters: Promise<{ agents: Agent[]; teams: TeamSpec[] }> | null = null
    const getRosters = () => (rosters ??= loadMentionRosters(params.projectId))

    // Refresh bản đồ phiên sau khi spawn — handle trùng title của phiên vừa
    // sinh phải thấy nó "sống" thay vì spawn thêm một bản nữa.
    const refreshSummaries = async () => {
      summaries = await listSessionSummaries()
    }

    const assignee = item?.assigneeSessionId
    if (item && assignee && assignee !== 'user') {
      // ── Đường 1: assignee sống — ping giống trước đây.
      const r = await pingAssignee(assignee, item, params.text)
      wakes.push(r.wake)
      receipts.push(r)
      pinged.add(assignee)
    } else if (item && !assignee) {
      // ── Đường 2: item trống chủ — ref đỗ của chính user thắng mọi @mention
      // trong text (ref là lời gán khi tạo; mention trong câu chỉ là lời gọi
      // thêm). Ref hỏng/không có thì mention ĐẦU TIÊN resolve được nhận việc.
      let target = await materializeAssigneeRef(item)
      if (!target && handles.length) {
        const r = await getRosters()
        for (const h of handles) {
          target = await resolveMentionTarget(h, {
            item,
            summaries,
            ...r,
            assigning: true,
          })
          if (target) break
        }
      }
      if (target) {
        // Gán sessionId + vết "ai giao cho ai" trong thread (cùng giọng
        // transition của boards.upsert/board-tools). Ghi board hỏng thì vẫn
        // ping phiên đã spawn — nó tồn tại và nghe được, chỉ là chưa thành
        // chủ trên giấy; rơi về giọng "được gọi vào thread".
        let assigned = false
        try {
          item = await upsertBoardItem(params.projectId, {
            id: item.id,
            assigneeSessionId: target.sessionId,
            assigneeRef: null,
          })
          await addBoardItemComment(params.projectId, params.itemId, {
            from: null,
            fromTitle: 'system',
            text: `assigned to "${target.title}"`,
          })
          item = (await getBoardItem(params.projectId, params.itemId)) ?? item
          assigned = true
        } catch (err) {
          log.warn('boards.comment: auto-assign write failed', {
            itemId: params.itemId,
            to: target.sessionId,
            err: err instanceof Error ? err.message : String(err),
          })
        }
        const r = assigned
          ? await pingAssigned(target.sessionId, item, params.text, target.title)
          : await pingMentioned(target.sessionId, item, params.text, target.title)
        wakes.push(r.wake)
        receipts.push(r)
        pinged.add(target.sessionId)
        if (target.spawned) await refreshSummaries()
      }
    }
    // assignee === 'user': item là của chính người dùng — không ping chủ,
    // nhưng @mention vẫn resolve bình thường bên dưới (không cướp việc).

    // ── Đường 3: mọi @handle khác trong text — kể cả khi item đã có chủ. Đích
    // trùng một phiên đã ping bị bỏ qua (assignee đã nghe thấy rồi).
    if (item && handles.length) {
      const r = await getRosters()
      for (const h of handles) {
        const target = await resolveMentionTarget(h, {
          item,
          summaries,
          ...r,
          assigning: false,
        })
        if (!target || pinged.has(target.sessionId)) continue
        const res = await pingMentioned(target.sessionId, item, params.text, target.title)
        wakes.push(res.wake)
        receipts.push(res)
        pinged.add(target.sessionId)
        if (target.spawned) await refreshSummaries()
      }
    }

    // Vạch biên nhận trong thread — "nhận việc" mức thấp nhất mà hệ thống
    // chứng minh được: đích đã nhận, đang bận (xếp sau lượt hiện tại), hay
    // không chuyển được. Best-effort — ghi hỏng không làm mất ping đã đi.
    if (item && receipts.length) {
      try {
        await addBoardItemComment(params.projectId, params.itemId, {
          from: null,
          fromTitle: 'system',
          text: receipts.map(receiptText).join(' · '),
        })
        item = (await getBoardItem(params.projectId, params.itemId)) ?? item
      } catch (err) {
        log.warn('boards.comment: receipt comment failed', {
          itemId: params.itemId,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return { comment, item, wake: mergedWake(wakes) }
  } catch (err) {
    if (err instanceof BoardError) throw new RpcError(-32602, err.message, { code: err.code })
    throw err
  }
})

// Kết quả báo lại cho UI sau khi USER comment — "tương tác thật" cần biết tin
// đã tới ai chưa:
//   'delivered' — ít nhất một đích RẢNH: tin chạy ngay ở renderer
//   'queued'    — mọi đích được ping đều đang trong một lượt: xếp sau
//   'failed'    — có ping nhưng inbox nổ lỗi hết (comment vẫn đã ghi)
//   'none'      — không ai được báo (item trống chủ, không ref, không mention)
export type CommentWake = 'delivered' | 'queued' | 'none' | 'failed'

// Tổng hợp nhiều ping: một đích nhận được ngay là đủ để nói "delivered"; còn
// lại lấy trạng thái tốt nhất theo thứ tự queued → failed → none.
function mergedWake(wakes: CommentWake[]): CommentWake {
  if (wakes.includes('delivered')) return 'delivered'
  if (wakes.includes('queued')) return 'queued'
  if (wakes.includes('failed')) return 'failed'
  return 'none'
}

const previewOf = (text: string): string => (text.length > 800 ? `${text.slice(0, 800)}…` : text)

// Một đoạn của vạch biên nhận — cùng giọng system-comment tiếng Anh gọn của
// các transition khác ("assigned to …", "Turn failed; returned to todo").
function receiptText(r: { title: string; wake: CommentWake }): string {
  switch (r.wake) {
    case 'delivered':
      return `delivered to "${r.title}"`
    case 'queued':
      return `"${r.title}" is mid-turn — will read after it finishes`
    case 'failed':
      return `"${r.title}" could not be reached`
    case 'none':
      return `"${r.title}" is no longer active`
  }
}

type PingResult = { wake: CommentWake; title: string }

// Đích đang chạy một lượt ⇒ renderer xếp tin sau lượt đó thay vì chạy ngay —
// UI cần phân biệt để nói đúng "đang bận, sẽ nhận sau" thay vì im lặng.
const classify = (to: string): CommentWake =>
  activeSessionIds().includes(to) ? 'queued' : 'delivered'

async function safePing(to: string, text: string): Promise<CommentWake> {
  try {
    // from: null = người dùng — đúng tác giả, đồng thời tránh self-target khi
    // đích trùng root của chính run đang gọi (from=teamRunId sẽ nổ InboxError).
    await postSessionMessage({ from: null, to, text })
    return classify(to)
  } catch (err) {
    log.warn('boards.comment: wake failed', {
      to,
      err: err instanceof Error ? err.message : String(err),
    })
    return 'failed'
  }
}

// Assignee sống + comment mới — đường cũ. Giọng tin QUYẾT ĐỊNH kiểu agent đáp:
// đọc như một teammate đang chat trong thread, không phải notice hệ thống;
// trao đổi đơn giản thì trả lời ngay, đừng suy nghĩ sâu (user kỳ vọng phản hồi
// nhanh); còn việc thật thì nói sẽ làm → LÀM → báo lại trong thread (transcript
// của nó user không nhìn thấy). @tên → chuyển tiếp cho đồng đội qua
// send_session_message (cùng run được phép).
async function pingAssignee(to: string, item: BoardItem, text: string): Promise<PingResult> {
  const summaries = await listSessionSummaries()
  const target = summaries.find((s) => s.id === to)
  if (!target || target.archived) return { wake: 'none', title: target?.title ?? to }
  const wake = await safePing(
    to,
    `[board] New comment from the user in the thread of "${item.title}" (${item.id}): "${previewOf(text)}". ` +
      'That thread is your direct chat with the user about this item — treat it like team chat, not a ticket queue. ' +
      "Reply IN THE THREAD via team_item_comment FIRST — before doing any other work — in the user's language: if it is a simple exchange, answer right away and briefly — don't over-think. " +
      'If it needs work, acknowledge like a teammate, do it, and post progress/results in the thread as you go — the user cannot see your transcript. ' +
      'If the comment addresses a teammate (@name), relay it with send_session_message. Read the thread first via team_item_get if you need context.',
  )
  return { wake, title: target.title ?? to }
}

// Item vừa được gán cho đích QUA comment này (ref đỗ materialize, hoặc @mention
// đầu tiên) — tin đóng luôn vai lời giao việc: nói rõ item đã về tay họ, dẫn
// team_item_get/comment/update đúng protocol.
async function pingAssigned(
  to: string,
  item: BoardItem,
  text: string,
  title: string,
): Promise<PingResult> {
  const wake = await safePing(
    to,
    `[board] "${item.title}" (${item.id}) is now assigned to you — the user just commented in its thread: "${previewOf(text)}". ` +
      'Your FIRST action must be team_item_comment acknowledging this in the thread — before any other work, any exploration, any planning: the user is watching that thread and cannot see your transcript. ' +
      "Keep it short and in the user's language. Only then call team_item_get for the full brief, move to in_progress when you start, and narrate progress on the thread as you go.",
  )
  return { wake, title }
}

// Được @mention nhưng KHÔNG phải chủ item — mời tham gia thread; nếu lời gọi
// thực chất là giao việc thì tự nhận qua team_item_update (assignee cũ được giữ
// nguyên ở phía sidecar, agent tự quyết phần chuyển giao).
async function pingMentioned(
  to: string,
  item: BoardItem,
  text: string,
  title: string,
): Promise<PingResult> {
  const wake = await safePing(
    to,
    `[board] The user mentioned you in the thread of "${item.title}" (${item.id}): "${previewOf(text)}". ` +
      "Open it via team_item_get and reply IN THE THREAD via team_item_comment in the user's language — briefly if it is a simple exchange. " +
      'If they asked you to take the item, assign it to yourself via team_item_update and start.',
  )
  return { wake, title }
}
