import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { setSessionAgent } from '../sessions/store.js'

// Gắn / gỡ agent AWOG (AGENT.md) cho một phiên VỚI TƯ CÁCH member/lead của nhóm
// — bản "vai có thật" của nhãn `teamRole` (docs/features/session-teams.md §3).
// Agent được `resolveAgentContext` resolve phía sidecar mỗi lượt để áp
// systemPrompt/model/provider/tools của nó lên phiên.
//
// `agent: null` = gỡ binding. Đây là lý do việc này có RPC RIÊNG thay vì đi nhờ
// `sessions.upsert` / `updateSessionMetadata`: gỡ phải XOÁ HẲN key `agent`
// trên header, mà patch kiểu spread không xoá được key — y hệt `sessions.setGroup`
// (tách nhóm), `sessions.setArchived` và `sessions.setSpawnConfig`.
//
// Payload là L1 (IPC từ UI): id phiên đi vào một sink đường dẫn (thư mục phiên)
// nên bị siết đúng charset như `sessions.setGroup` / `sessions.delete`. Agent id
// KHÔNG đi vào đường dẫn phiên — nó chỉ ghi vào header — nên chỉ cần trần độ dài
// (id của AGENT.md do người dùng đặt, charset đã được agents.upsert siết riêng).
const SESSION_ID_RE = /^[a-z0-9-]+$/

const Params = z.object({
  id: z.string().min(1).regex(SESSION_ID_RE),
  // null = gỡ binding. Object = SessionAgentRef: `source`/`projectId` phân biệt
  // agent global (~/.claude/agents) vs agent của project (<project>/.claude/agents)
  // khi cùng một id tồn tại ở cả hai tier.
  agent: z
    .object({
      id: z.string().min(1).max(200),
      source: z.enum(['global', 'project']).optional(),
      projectId: z.string().optional(),
    })
    .nullable(),
})

register('sessions.setAgent', async (raw) => {
  const params = Params.parse(raw)
  const found = await setSessionAgent(params.id, params.agent)
  if (!found) throw new RpcError(-32004, 'Session not found')
  return { ok: true }
})
