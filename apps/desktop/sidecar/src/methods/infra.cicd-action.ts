// `infra.cicd-action` — chạy lại · huỷ · kích hoạt · duyệt bước thủ công (task 4.4).
//
// ĐÂY LÀ BỀ MẶT GHI. Ba hàng rào, không hàng rào nào thay được hàng rào nào:
//   1. `kind` phải là một trong bốn giá trị đã khai — renderer không tự nghĩ ra
//      được một lệnh mới;
//   2. mọi giá trị đi vào argv được TRA LẠI ở sidecar: nguồn AWS tự đọc token
//      duyệt của CodePipeline (`get-pipeline-state`) và tự tìm stage hỏng, còn
//      `ref` của GitHub chỉ chứa id (run id, environment id) đã kiểm là SỐ;
//   3. `runGated()` hỏi ma trận quyền cho nguồn AWS — trên production, một lệnh
//      ghi LUÔN phải có người bấm.
//
// Không có tham số nào nhận `approved: boolean`: vé duyệt do CHÍNH sidecar phát ở
// lượt gọi trước (infosec audit #1), và nó gắn vân tay của đúng lời gọi này.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { CICD_SOURCES, cicdAction } from '../infra/cicd/index.js'

const Context = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
    accountId: z.string().max(64).optional(),
  })
  .default({})

const Params = z.object({
  source: z.enum(CICD_SOURCES),
  kind: z.enum(['rerun', 'cancel', 'dispatch', 'approve']),
  ref: z.record(z.string().max(1024)).default({}),
  failedOnly: z.boolean().optional(),
  workflow: z.string().max(120).optional(),
  gitRef: z.string().max(200).optional(),
  inputs: z
    .array(z.object({ key: z.string().max(64), value: z.string().max(1000) }))
    .max(20)
    .optional(),
  approve: z.boolean().optional(),
  summary: z.string().max(500).optional(),
  context: Context,
  surface: z.enum(INFRA_SURFACES).default('pipeline'),
  approvalTicket: z.string().max(100).optional(),
  sessionId: z.string().max(200).optional(),
  messageId: z.string().max(200).optional(),
})

register('infra.cicd-action', async (raw) => {
  const p = Params.parse(raw)
  const ref = Object.fromEntries(Object.entries(p.ref).slice(0, 16))
  const payload = {
    source: p.source,
    kind: p.kind,
    ref,
    context: p.context,
    surface: p.surface,
  }
  const result = await cicdAction({
    ...payload,
    ...(p.failedOnly !== undefined ? { failedOnly: p.failedOnly } : {}),
    ...(p.workflow !== undefined ? { workflow: p.workflow } : {}),
    ...(p.gitRef !== undefined ? { gitRef: p.gitRef } : {}),
    ...(p.inputs !== undefined ? { inputs: p.inputs } : {}),
    ...(p.approve !== undefined ? { approve: p.approve } : {}),
    ...(p.summary !== undefined ? { summary: p.summary } : {}),
    ...(p.approvalTicket !== undefined ? { ticket: p.approvalTicket } : {}),
    ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
    ...(p.messageId !== undefined ? { messageId: p.messageId } : {}),
  })
  return result
})
