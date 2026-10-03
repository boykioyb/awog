import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { emit } from '../transport/stdio.js'
import { setSessionLlmOverride } from '../sessions/store.js'

// Đặt/gỡ override LLM cấp phiên (Session.llmOverride) — bản "đổi account khi
// hết token" của board item → Advanced. Override thắng cả pin của agent spec
// trong send-message vì nó là quyết định trực tiếp + mới nhất của người dùng.
//
// RPC riêng (không đi qua sessions.upsert) vì `override: null` phải XOÁ HẲN
// key trên header — y hệt sessions.setAgent / sessions.setSpawnConfig.
const SESSION_ID_RE = /^[a-z0-9-]+$/

const Params = z.object({
  id: z.string().min(1).regex(SESSION_ID_RE),
  override: z
    .object({
      provider: z.enum(['anthropic', 'openai', 'google']).optional(),
      modelId: z.string().min(1).max(200).optional(),
      accountId: z.string().max(64).optional(),
      level: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
      mode: z.enum(['ask', 'accept-edits', 'plan', 'execute']).optional(),
    })
    .nullable(),
})

register('sessions.setLlmOverride', async (raw) => {
  const params = Params.parse(raw)
  const found = await setSessionLlmOverride(params.id, params.override)
  if (!found) throw new RpcError(-32004, 'Session not found')
  // Broadcast để mọi cửa sổ/popout hội tụ — y hệt `session.spawn-config`:
  // board editor có thể ở cửa sổ KHÁC phiên đang sống, `null` = xoá key.
  emit('session.llm-override', { sessionId: params.id, llmOverride: params.override })
  return { ok: true }
})
