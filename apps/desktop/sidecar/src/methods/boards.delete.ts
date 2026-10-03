import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { deleteBoardItem, listBoardItems } from '../boards/store.js'
import { listSessionSummaries } from '../sessions/store.js'
import { deleteSessionCascade } from '../sessions/delete-cascade.js'
import { log } from '../util/logger.js'
import { MESSAGE_ID_RE } from '../sessions/ids.js'

// Xoá một work-item khỏi board của project (docs/features/session-teams.md §7).
// Xoá là của NGƯỜI DÙNG qua UI — không có tool `team_item_delete` cho model:
// agent cần "bỏ" một việc thì chuyển nó sang `cancelled`... là của user, nên
// agent chỉ đề xuất; xoá hẳn luôn là click của người dùng.
//
// Cả hai id đều đi vào sink đường dẫn / khoá JSON nên siết charset tại biên.
const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]*$/

const Params = z.object({
  projectId: z.string().min(3).max(64).regex(PROJECT_ID_RE),
  itemId: z.string().min(1).max(64).regex(MESSAGE_ID_RE),
})

register('boards.delete', async (raw) => {
  const params = Params.parse(raw)
  const item = await deleteBoardItem(params.projectId, params.itemId)
  if (!item) throw new RpcError(-32004, 'Board item not found')
  // Cascade: phiên đang được giao item chết theo item — không để assignee chạy
  // mồ côi đốt token cho việc không còn tồn tại. Assignee là GỐC một team run
  // (item giao 'team:…') thì member của run đi theo; phiên nào còn được item
  // KHÁC tham chiếu (member run tái dùng qua materializeMember) thì sống.
  // Best-effort từng phiên: xoá item luôn thành công dù cascade vấp (CLI còn
  // sống chặn xoá, v.v.) — session sót lại thành mồ côi cũ, không blocker.
  if (item.assigneeSessionId) {
    const sid = item.assigneeSessionId
    const [summaries, remaining] = await Promise.all([
      listSessionSummaries(),
      listBoardItems(params.projectId),
    ])
    const stillReferenced = new Set(
      remaining.map((i) => i.assigneeSessionId).filter((x): x is string => !!x),
    )
    const targets = [
      sid,
      ...summaries.filter((s) => s.teamRunId === sid).map((s) => s.id),
    ]
    for (const id of targets) {
      if (stillReferenced.has(id)) continue
      try {
        await deleteSessionCascade(id)
      } catch (err) {
        log.warn('boards.delete: session cascade failed', {
          itemId: params.itemId,
          sessionId: id,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
  return { ok: true }
})
