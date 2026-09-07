import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { setSessionArchived } from '../sessions/store.js'

// Archive / un-archive một phiên — "ẩn khỏi danh sách nhưng KHÔNG xoá"
// (docs/features/session-lifecycle-ops.md). Đây là bậc trung gian còn thiếu giữa
// `pinned` (ghim lên đầu) và `sessions.delete` (xoá vĩnh viễn cả thư mục phiên).
//
// Thao tác này CHỈ đổi metadata của header: transcript trên đĩa, bookmark, snapshot
// Rewind và attachments đều không bị đụng tới — nên nó luôn đảo ngược được bằng
// `{ archived: false }`.
//
// Payload là L1 (IPC từ UI): id đi vào một sink đường dẫn (thư mục phiên) nên bị siết
// đúng charset như `sessions.delete` — id AWOG là slug (`ses-<n>` cũ và
// `YYMMDD-adjective-noun-tail` hiện tại), chữ thường + số + gạch nối.
const SESSION_ID_RE = /^[a-z0-9-]+$/

const Params = z.object({
  id: z.string().min(1).regex(SESSION_ID_RE),
  archived: z.boolean(),
})

register('sessions.setArchived', async (raw) => {
  const params = Params.parse(raw)
  const found = await setSessionArchived(params.id, params.archived)
  if (!found) throw new RpcError(-32004, 'Session not found')
  return { ok: true }
})
