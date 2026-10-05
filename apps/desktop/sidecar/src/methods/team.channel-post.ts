import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { listSessionSummaries } from '../sessions/store.js'
import { MAX_CHANNEL_TEXT_LEN, postChannelEntry } from '../sessions/channel.js'

// `team.channelPost` — NGƯỜI DÙNG post lên kênh chung của nhóm (Session
// Teams, docs/features/session-teams.md §7): ô nhập kênh trên "team cockpit"
// / tab Discuss của board item.
//
// `from` KHÔNG có trong payload — RPC này luôn là "người dùng nói" (`from:
// null, fromTitle: 'user'`), nên không có cách nào giả danh một member để né
// luật re-trigger. Luật wake cho tin của user (xem sessions/channel.ts):
// kind 'chat' kèm `mentions` ⇒ wake đúng những phiên được tag (comm turn —
// trả lời nhanh, kẹp model rẻ); broadcast không mention và kind 'note' (ghi
// chú) không lôi ai vào câu chuyện.
const SESSION_ID_RE = /^[a-z0-9-]+$/

const Params = z.object({
  // Phiên GỐC của nhóm — file kênh neo theo id này.
  rootId: z.string().min(1).regex(SESSION_ID_RE),
  text: z.string().min(1).max(MAX_CHANNEL_TEXT_LEN),
  kind: z.enum(['note', 'chat']).optional(),
  // Id phiên cần lôi vào câu chuyện — post 'chat' mang mentions sẽ wake đúng
  // những phiên đó qua hộp thư.
  mentions: z.array(z.string().regex(SESSION_ID_RE)).max(16).optional(),
  // Board item mà post nói về — UI "Discuss" của item lọc theo tag này.
  itemId: z.string().regex(SESSION_ID_RE).max(64).optional(),
})

register('team.channelPost', async (raw) => {
  const params = Params.parse(raw)
  const root = (await listSessionSummaries()).find((s) => s.id === params.rootId)
  if (!root) throw new RpcError(-32004, 'Session not found')
  const entry = await postChannelEntry(params.rootId, {
    from: null,
    fromTitle: 'user',
    kind: params.kind ?? 'note',
    text: params.text,
    ...(params.mentions ? { mentions: params.mentions } : {}),
    ...(params.itemId ? { itemId: params.itemId } : {}),
  })
  return { entry }
})
