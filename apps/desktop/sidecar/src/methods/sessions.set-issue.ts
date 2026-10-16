import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { BoardError } from '../boards/store.js'
import { MESSAGE_ID_RE } from '../sessions/ids.js'
import { setSessionIssueByUser } from '../boards/session-issue.js'

// Gắn / gỡ / bỏ theo dõi issue của một phiên (docs/features/session-issue-tracking.md).
// Đường ghi RIÊNG thay vì patch của sessions.upsert: gỡ phải XOÁ HẲN key, và
// renderer giữ bản cũ của phiên không được vô tình ghi đè link sidecar vừa tạo
// ở lượt đầu.
//
// Payload là L1 (IPC từ UI): id phiên siết charset như mọi RPC sessions.*; id
// issue siết theo MESSAGE_ID_RE (`bi-<hex>`) — nó chỉ đi vào tra cứu trong JSON
// của board, không vào đường dẫn.
const SESSION_ID_RE = /^[a-z0-9-]+$/

const Params = z
  .object({
    sessionId: z.string().min(1).max(64).regex(SESSION_ID_RE),
    // string = gắn vào issue có sẵn; null = gỡ link. Vắng khi `untrack`.
    issueId: z.string().max(64).regex(MESSAGE_ID_RE).nullable().optional(),
    // true = bỏ theo dõi: gỡ link + không tự sinh issue lại (xoá issue nếu chỉ là
    // issue tự sinh chưa ai đụng). false (kèm issueId null) = theo dõi lại.
    untrack: z.boolean().optional(),
  })
  .refine((p) => p.untrack === true || p.issueId !== undefined, {
    message: 'Pass issueId (string or null) or untrack: true.',
  })

register('sessions.setIssue', async (raw) => {
  const params = Params.parse(raw)
  try {
    const res = await setSessionIssueByUser(params.sessionId, {
      ...(params.issueId !== undefined ? { issueId: params.issueId } : {}),
      ...(params.untrack !== undefined ? { untrack: params.untrack } : {}),
    })
    if (!res) throw new RpcError(-32004, 'Session not found')
    return res
  } catch (err) {
    if (err instanceof BoardError) {
      throw new RpcError(err.code === 'unknown-item' ? -32004 : -32602, err.message, { code: err.code })
    }
    throw err
  }
})
