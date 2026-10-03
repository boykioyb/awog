import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { listSessionSummaries } from '../sessions/store.js'
import { MAX_CHANNEL_TEXT_LEN, postChannelEntry } from '../sessions/channel.js'

// `team.channelPost` — NGƯỜI DÙNG post lên kênh chung của nhóm (Session
// Teams, docs/features/session-teams.md §7): ô nhập kênh trên "team cockpit".
//
// `from` KHÔNG có trong payload — RPC này luôn là "người dùng nói" (`from:
// null, fromTitle: 'user'`), nên không có cách nào giả danh một member để né
// luật re-trigger: entry của user không wake ai trừ khi kind 'chat' mang
// mentions... mà kind ở đây chỉ được phép 'note' (mặc định — ghi chú của người
// dùng, KHÔNG bao giờ wake ai) hoặc 'chat' (vẫn from=null ⇒ không wake; luật
// wake của channel chỉ áp cho post của MEMBER — xem sessions/channel.ts).
const SESSION_ID_RE = /^[a-z0-9-]+$/

const Params = z.object({
  // Phiên GỐC của nhóm — file kênh neo theo id này.
  rootId: z.string().min(1).regex(SESSION_ID_RE),
  text: z.string().min(1).max(MAX_CHANNEL_TEXT_LEN),
  kind: z.enum(['note', 'chat']).optional(),
  // Id phiên cần lôi vào câu chuyện — với entry của user nó chỉ là nhãn trên
  // kênh (wake vẫn không xảy ra: `from` là null).
  mentions: z.array(z.string().regex(SESSION_ID_RE)).max(16).optional(),
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
  })
  return { entry }
})
