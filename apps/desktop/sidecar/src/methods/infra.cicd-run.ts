// `infra.cicd-run` — chi tiết MỘT lần chạy: bước · artifact · PR · tên biến môi
// trường (task 4.3/4.4).
//
// `ref` là con trỏ dòng do UI giữ và gửi lại. Nó KHÔNG phải đường dẫn và không
// phải argv: `cicd/index.ts` tra nó ra ngữ cảnh thật (project path, pipeline name,
// build id) rồi để tầng nguồn ghép argv. Cổng quyền vẫn là `runGated()` cho mọi
// nguồn AWS — nên nguồn nào bị siết thì câu trả lời là `blocked` + VÉ, đúng khuôn
// của Explorer (`useConfirm kind: 'infra'`).

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { CICD_SOURCES, cicdRunDetail } from '../infra/cicd/index.js'

const Context = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
    accountId: z.string().max(64).optional(),
  })
  .default({})

/** Trần số khoá + độ dài giá trị: `ref` là dữ liệu L1, không được phình vô hạn. */
const MAX_REF_KEYS = 16
const MAX_REF_VALUE = 1024

const Params = z.object({
  source: z.enum(CICD_SOURCES),
  ref: z.record(z.string().max(MAX_REF_VALUE)).default({}),
  context: Context,
  surface: z.enum(INFRA_SURFACES).default('pipeline'),
  approvalTicket: z.string().max(100).optional(),
  sessionId: z.string().max(200).optional(),
  messageId: z.string().max(200).optional(),
})

register('infra.cicd-run', async (raw) => {
  const p = Params.parse(raw)
  const ref = Object.fromEntries(Object.entries(p.ref).slice(0, MAX_REF_KEYS))
  return cicdRunDetail({
    source: p.source,
    ref,
    context: p.context,
    surface: p.surface,
    ...(p.approvalTicket !== undefined ? { ticket: p.approvalTicket } : {}),
    ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
    ...(p.messageId !== undefined ? { messageId: p.messageId } : {}),
  })
})
