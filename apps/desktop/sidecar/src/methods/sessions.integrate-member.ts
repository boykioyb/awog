import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { listSessionSummaries } from '../sessions/store.js'
import { integrateSessionBranch } from '../tasks/worktree.js'
import { upsertBoardItem } from '../boards/store.js'
import { postChannelEntry } from '../sessions/channel.js'
import { log } from '../util/logger.js'

// `sessions.integrateMember` — nút Merge của NGƯỜI DÙNG trên roster của nhóm
// (Session Teams, docs/features/session-teams.md §5): merge branch riêng của
// member về baseRef đã neo trong repo gốc. Cổng merge DUY NHẤT của owner
// `session` — AWOG không bao giờ tự merge, và cũng không bao giờ xoá branch
// sau khi merge (người dùng tự quyết).
//
// Thành công ⇒ (a) item được truyền kèm lật sang `done` + ghi mergedBranch,
// (b) post một note `system` lên channel của nhóm — cả hai best-effort: một
// lỗi board/channel KHÔNG được đánh mất kết quả merge đã xong.
const SESSION_ID_RE = /^[a-z0-9-]+$/

const Params = z.object({
  id: z.string().min(1).regex(SESSION_ID_RE),
  // Board item đang chờ review mà cú merge này đóng — vắng mặt = merge vẫn
  // chạy, chỉ không ghi gì lên board.
  itemId: z.string().min(1).max(64).optional(),
})

register('sessions.integrateMember', async (raw) => {
  const params = Params.parse(raw)
  const session = (await listSessionSummaries()).find((s) => s.id === params.id)
  if (!session) throw new RpcError(-32004, 'Session not found')
  const wt = session.worktree
  if (!wt) {
    // Không có worktree ⇒ không có branch để merge (member trên cây chung).
    // -32602 theo convention "domain refusal" của các method khác.
    throw new RpcError(-32602, 'That member works on the shared tree — there is no branch to merge')
  }

  const result = await integrateSessionBranch({
    repoPath: wt.repoPath,
    worktreePath: wt.worktreePath,
    branch: wt.branch,
    baseRef: wt.baseRef,
  })
  if (!result.merged) {
    // `reason` mang tiền tố loại máy-đọc-được (conflict / base-not-checked-out /
    // worktree-dirty / merge-failed) + giải thích đã sanitize — để cả trong
    // `data` để UI phân nhánh mà không phải parse message.
    throw new RpcError(-32602, `Member branch was not merged: ${result.reason}`, {
      reason: result.reason,
    })
  }

  if (params.itemId && session.projectId) {
    try {
      await upsertBoardItem(session.projectId, {
        id: params.itemId,
        status: 'done',
        mergedBranch: wt.branch,
      })
    } catch (err) {
      // Merge đã thành công — một lỗi ghi board không được phép làm mất nó.
      log.warn('board update after member merge failed', {
        sessionId: session.id,
        itemId: params.itemId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Channel là của NHÓM: chỉ member (có teamRunId) mới có nhóm để báo.
  if (session.teamRunId) {
    try {
      await postChannelEntry(session.teamRunId, {
        from: null,
        fromTitle: 'system',
        kind: 'system',
        text: `merged ${wt.branch}`,
      })
    } catch (err) {
      log.warn('channel note after member merge failed', {
        sessionId: session.id,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { merged: true, commit: result.commit }
})
