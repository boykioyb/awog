import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { setSessionGroup } from '../sessions/store.js'

// Xếp một phiên vào nhóm — mô hình cây kiểu trang Notion: phiên con nằm dưới một
// phiên CHA, và tên nhóm chính là tiêu đề của phiên cha (không có entity "nhóm"
// riêng nào phải đặt tên, đổi tên hay dọn rác khi phiên cha bị xoá).
//
// `parentId: null` = tách khỏi nhóm. Đây là lý do việc này có RPC RIÊNG thay vì đi
// nhờ `sessions.upsert`: tách phải XOÁ HẲN key trên header, mà patch kiểu spread của
// `updateSessionMetadata` không xoá được key (cùng lý do đã viết ở `sessions.setArchived`
// và `infra.setSessionContext`).
//
// Payload là L1 (IPC từ UI): cả hai id đi vào một sink đường dẫn (thư mục phiên) nên
// bị siết đúng charset như `sessions.delete` / `sessions.setArchived`.
const SESSION_ID_RE = /^[a-z0-9-]+$/

// Vai là NHÃN, không phải chỉ thị: nó hiện trên hàng danh sách và đi vào danh bạ
// liên phiên (`list_sessions`), nên nó phải ngắn tới mức không nhét lọt một đoạn
// văn bản chèn lệnh. 60 ký tự đủ cho "Reviewer nhánh feature/aws-infra".
const MAX_ROLE_LEN = 60

const Params = z.object({
  id: z.string().min(1).regex(SESSION_ID_RE),
  // null = tách khỏi nhóm.
  parentId: z.string().min(1).regex(SESSION_ID_RE).nullable(),
  // null = không đổi nhãn (và bị bỏ hẳn khi tách nhóm — xem session-manager.setGroup).
  role: z.string().max(MAX_ROLE_LEN).nullable().optional(),
})

register('sessions.setGroup', async (raw) => {
  const params = Params.parse(raw)
  const result = await setSessionGroup(params.id, params.parentId, params.role ?? null)
  if (result === 'unknown-session') throw new RpcError(-32004, 'Session not found')
  if (result === 'unknown-parent') throw new RpcError(-32004, 'Parent session not found')
  if (result === 'self-parent') throw new RpcError(-32602, 'A session cannot be its own parent')
  // Hai cấp: cha phải là một phiên chưa thuộc nhóm nào.
  if (result === 'nested-parent') {
    throw new RpcError(-32602, 'That session is already inside a group; groups are only two levels')
  }
  // Chu trình: nối vào sẽ tạo một cây không có gốc, và renderer lặp vô hạn khi dựng
  // danh sách. Nói rõ nguyên nhân để UI hiện được câu "phiên kia đang nằm dưới phiên này".
  if (result === 'cycle') throw new RpcError(-32602, 'That parent is already inside this group')
  return { ok: true }
})
