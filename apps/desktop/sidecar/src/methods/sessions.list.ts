import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listSessionSummaries } from '../sessions/store.js'

// Returns lightweight SessionSummary[] from the index (no messages) — ADR 0048.
// The UI lazy-loads a session's transcript via sessions.get when it is opened.
//
// ⚠ ĐỔI HÀNH VI MẶC ĐỊNH (WP2): phiên đã lưu trữ (`Session.archived`) bị LỌC BỎ trừ
// khi gọi với `includeArchived: true`. Lọc nằm ở đây chứ không ở
// `listSessionSummaries()` là có chủ ý — các consumer nội bộ (activity.summary,
// sessions.active-turns) vẫn phải thấy MỌI phiên, nếu không thì chi phí token của một
// phiên đã lưu trữ sẽ biến mất khỏi báo cáo. Ẩn khỏi danh sách là quyết định của bề
// mặt UI, không phải của tầng lưu trữ. Xem docs/features/session-lifecycle-ops.md.
const Params = z.object({
  includeArchived: z.boolean().optional(),
})

register('sessions.list', async (raw) => {
  // Method này vốn không nhận tham số — caller cũ gọi không params vẫn hợp lệ.
  const params = Params.parse(raw ?? {})
  const all = await listSessionSummaries()
  const sessions = params.includeArchived ? all : all.filter((s) => !s.archived)
  return { sessions }
})
