// `infra.resource-detail` — JSON chi tiết của MỘT dòng (task 3.1, phần "chi tiết").
//
// Chạy khi người dùng bấm vào một dòng, không bao giờ tự động: mỗi dòng là một
// lời gọi API thật (`describe-instances --instance-ids …`), nên nạp sẵn 50 dòng
// là 50 lời gọi mà 49 cái không ai đọc.
//
// Dòng được gửi từ renderer nên nó là dữ liệu KHÔNG TIN CẬY: nó chỉ dùng để thay
// `{id}`-style placeholder, và `buildArgs` từ chối mọi giá trị bắt đầu bằng `-`
// (một giá trị như vậy bị CLI đọc thành cờ). Renderer không gửi được cờ.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { runViewDetail } from '../infra/resources/execute.js'
import { viewById } from '../infra/resources/registry.js'

const Context = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
    accountId: z.string().max(64).optional(),
  })
  .default({})

const Params = z.object({
  viewId: z.string().min(1).max(120),
  row: z.record(z.string().max(4096)).default({}),
  context: Context,
  surface: z.enum(INFRA_SURFACES).default('explorer'),
  approvalTicket: z.string().max(100).optional(),
  sessionId: z.string().max(200).optional(),
  messageId: z.string().max(200).optional(),
})

register('infra.resource-detail', async (raw) => {
  const p = Params.parse(raw)
  const spec = viewById(p.viewId)
  if (!spec) return { ok: false as const, blocked: false as const, error: 'unknown view', missing: [] }
  return runViewDetail({
    spec,
    row: p.row,
    context: p.context,
    surface: p.surface,
    ...(p.approvalTicket !== undefined ? { approvalTicket: p.approvalTicket } : {}),
    ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
    ...(p.messageId !== undefined ? { messageId: p.messageId } : {}),
  })
})
