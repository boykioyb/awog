// `infra.resource-list` — nạp một trang của một view Explorer (task 3.1).
//
// Bề mặt của CON NGƯỜI (task 3.10 tách đường agent ở `infra-tools.ts`). Mọi lời
// gọi đi qua `runViewList()` → `runGated()` → ma trận quyền → nhật ký.
//
// Trả về `blocked` kèm `approvalTicket` khi ma trận nói "hỏi": UI mở hộp xác nhận
// rồi gọi lại ĐÚNG payload đó kèm vé. Vé gắn vân tay của lời gọi nên không dùng
// lại được cho lệnh khác.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { runViewList } from '../infra/resources/execute.js'
import { viewById } from '../infra/resources/registry.js'

/** Trần của form/giá trị placeholder. Dài hơn thì CLI cũng không dùng được. */
const MAX_VALUE_CHARS = 1024
const MAX_VALUE_KEYS = 40

const Context = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
    accountId: z.string().max(64).optional(),
  })
  .default({})

const Params = z.object({
  viewId: z.string().min(1).max(120),
  values: z.record(z.string().max(MAX_VALUE_CHARS)).default({}),
  token: z.string().max(8192).optional(),
  context: Context,
  surface: z.enum(INFRA_SURFACES).default('explorer'),
  approvalTicket: z.string().max(100).optional(),
  sessionId: z.string().max(200).optional(),
  messageId: z.string().max(200).optional(),
})

register('infra.resource-list', async (raw) => {
  const p = Params.parse(raw)
  const spec = viewById(p.viewId)
  if (!spec) return { ok: false as const, blocked: false as const, error: 'unknown view', missing: [] }
  const values = Object.fromEntries(Object.entries(p.values).slice(0, MAX_VALUE_KEYS))
  return runViewList({
    spec,
    values,
    ...(p.token !== undefined ? { token: p.token } : {}),
    context: p.context,
    surface: p.surface,
    ...(p.approvalTicket !== undefined ? { approvalTicket: p.approvalTicket } : {}),
    ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
    ...(p.messageId !== undefined ? { messageId: p.messageId } : {}),
  })
})
