// Gốc của RUN chứa một phiên — resolver DUY NHẤT cho câu hỏi "phiên này thuộc
// nhóm nào" (Session Teams, docs/features/session-teams.md §1.1):
//
//   member (con)  → `teamRunId` của nó
//   lead (gốc)    → chính nó, nhận diện bằng một trong hai:
//                   a) link spec `teamId` mà `teams.run` ghi ngay khi tạo gốc
//                      (gốc của run VẪN là gốc kể cả khi chưa có member nào —
//                      spawn lười là cố ý, không phải "chưa thành nhóm")
//                   b) ít nhất một phiên khác trỏ `teamRunId` về nó (nhóm
//                      ad-hoc do người dùng xếp qua sessions.setRunMembership)
//   phiên lẻ      → null
//
// Vì sao nhánh `teamId` bắt buộc có: trước đây "là gốc" chỉ được nhận qua (b),
// nên lead mới materialize (chưa spawn member nào) bị coi là phiên lẻ — mất
// hẳn <team> block lẫn team_item_*/team_say/member_diff trên CẢ HAI runtime,
// trong khi chính nó là người phải điều phối. Bốn điểm hỏi cùng gọi hàm này
// (team-context, board/channel/member tools, chat-toolset) để hai runtime
// không lệch semantic.
//
// Đồng bộ trên danh sách summary caller đã có — rẻ, không đọc đĩa. Caller
// muốn con LƯU TRỮ không tính vào nhận diện "có con" thì tự filter `archived`
// trước khi gọi (team-context làm vậy; phía tool giữ con archived vì kênh của
// nhóm vẫn tồn tại).
//
// Đảo nghịch cần giữ: một phiên KHÔNG nằm trong run nào thì KHÔNG được mang
// `teamId` — session-manager.setRunMembership xoá link spec khi member rời
// hẳn nhóm, nếu không phiên đó tự nhận mình là gốc của một run ma.
import type { SessionSummary } from '../types/shared.js'

export function runRootId(summaries: SessionSummary[], sessionId: string): string | null {
  const me = summaries.find((s) => s.id === sessionId)
  if (!me) return null
  if (me.teamRunId) return me.teamRunId
  if (me.teamId) return me.id
  return summaries.some((s) => s.teamRunId === sessionId) ? sessionId : null
}
