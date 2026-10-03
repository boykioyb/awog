import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { listSessionSummaries } from '../sessions/store.js'
import { readChannelTail } from '../sessions/channel.js'

// `team.channelList` — đọc tail của kênh chung một nhóm (Session Teams,
// docs/features/session-teams.md §7): nguồn dữ liệu cho feed kênh trên
// "team cockpit" của UI. Channel sống theo GROUP (~/.awog/groups/<rootId>/
// channel.jsonl) chứ không theo project.
//
// `rootId` là L1 (IPC từ UI) và đi vào sink đường dẫn gián tiếp qua store
// (sanitizeChild chỉ chặn '/', '\\', '..') nên siết cùng charset phiên của
// sessions.delete / sessions.setGroup.
const SESSION_ID_RE = /^[a-z0-9-]+$/

const Params = z.object({
  // Phiên GỐC của nhóm — file kênh neo theo id này.
  rootId: z.string().min(1).regex(SESSION_ID_RE),
  // Trần ký tự của tail trả về (đếm theo text của entry, xấp xỉ trần prompt).
  limit: z.number().int().positive().max(40_000).optional(),
})

register('team.channelList', async (raw) => {
  const params = Params.parse(raw)
  const root = (await listSessionSummaries()).find((s) => s.id === params.rootId)
  if (!root) throw new RpcError(-32004, 'Session not found')
  return { entries: await readChannelTail(params.rootId, params.limit) }
})
