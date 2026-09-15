// `infra.cicd-log` — log của MỘT bước (task 4.3).
//
// LOG BUILD LÀ DỮ LIỆU L1: `redactString` chạy TRƯỚC khi clamp (xem `githubStepLog`),
// và RPC này không có tham số nào chọn được đường dẫn file. Chỉ GitHub có đường này
// ở v1 — bước của CodeBuild mang `logRef` để UI gieo sang tab Logs đã có.
//
// Đây là lời gọi ĐẮT NHẤT của màn (`gh run view --log` tải cả gói log của job), nên
// nó là RPC RIÊNG, chỉ chạy khi người dùng bấm đúng một bước.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { CICD_SOURCES, cicdStepLog } from '../infra/cicd/index.js'

const Context = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
    accountId: z.string().max(64).optional(),
  })
  .default({})

const Params = z.object({
  source: z.enum(CICD_SOURCES),
  ref: z.record(z.string().max(1024)).default({}),
  /** `jobDatabaseId:stepNumber` (GitHub) — hai số nguyên, không có chữ tự do. */
  stepId: z.string().min(1).max(64),
  context: Context,
  surface: z.enum(INFRA_SURFACES).default('pipeline'),
  approvalTicket: z.string().max(100).optional(),
  sessionId: z.string().max(200).optional(),
  messageId: z.string().max(200).optional(),
})

register('infra.cicd-log', async (raw) => {
  const p = Params.parse(raw)
  const ref = Object.fromEntries(Object.entries(p.ref).slice(0, 16))
  return cicdStepLog({
    source: p.source,
    ref,
    stepId: p.stepId,
    context: p.context,
    surface: p.surface,
    ...(p.approvalTicket !== undefined ? { ticket: p.approvalTicket } : {}),
    ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
    ...(p.messageId !== undefined ? { messageId: p.messageId } : {}),
  })
})
