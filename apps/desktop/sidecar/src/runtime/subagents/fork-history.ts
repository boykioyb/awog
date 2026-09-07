// Cắt lịch sử phiên cha cho `subagent_type: "fork"` (ADR 0083 §d).
//
// Fork là chỗ DUY NHẤT một subagent có thể thổi bay ngân sách context theo đúng
// thiết kế: nó chép hội thoại của cha sang một lượt hoàn toàn mới, nên một phiên
// dài fork ba lần là trả tiền cho cùng một transcript bốn lần. Vì vậy trần nằm
// ngay trong đường dựng context, không phải một lời khuyên trong prompt.
//
// Cắt từ CUỐI: fork tồn tại để "làm tiếp thứ ta vừa bàn", nên phần mới nhất mới
// là phần có giá. Đơn vị đo là ký tự (≈4 ký tự/token — cùng heuristic UI đang
// dùng cho gauge context) vì ở đây chưa có tokenizer nào để hỏi.

import type { SessionMessage } from '../../types/shared.js'

// Trần mặc định ≈ 15k token. Đủ để mang theo vài lượt gần nhất, còn xa mức làm
// hỏng một cửa sổ 200k.
export const FORK_HISTORY_CHAR_BUDGET = 60_000

export function trimForkHistory(
  history: SessionMessage[],
  budget = FORK_HISTORY_CHAR_BUDGET,
): SessionMessage[] {
  const kept: SessionMessage[] = []
  let used = 0
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i]
    if (!m) continue
    // Luôn giữ ít nhất một message: fork với context rỗng chỉ là một subagent
    // general-purpose đội tên khác.
    if (kept.length > 0 && used + m.text.length > budget) break
    kept.unshift(m)
    used += m.text.length
  }
  return kept
}
