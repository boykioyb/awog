// `infra.resource-action` — hành động ngày-2 và form nhỏ của Explorer (task 3.4, 3.6, 3.7).
//
// ĐÂY LÀ BỀ MẶT GHI. Không có ngoại lệ nào ở file này:
//   · `actionId` phải khớp một hành động ĐÃ KHAI trong spec — id lạ ⇒ từ chối,
//     nên renderer không tự nghĩ ra được một lệnh mới;
//   · argv dựng từ mẫu của spec, placeholder chỉ nhận giá trị đã kiểm độ dài và
//     không bắt đầu bằng `-`;
//   · trường "gõ tên để xác nhận" được kiểm ở `execute.ts`, tức ở SIDECAR — hộp
//     thoại của UI chỉ là gợi ý, không phải hàng rào;
//   · `runGated()` hỏi ma trận quyền và ghi nhật ký như mọi đường khác.
//
// Hành động TẢI VỀ trả thêm `filePath` (đường dẫn trong cache của sidecar) để UI
// mở xem trước bằng `usePreview()` — renderer không đặt được tên file đó.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { runViewAction } from '../infra/resources/execute.js'
import { viewById } from '../infra/resources/registry.js'

const MAX_VALUE_CHARS = 4096

const Context = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
    accountId: z.string().max(64).optional(),
  })
  .default({})

const Params = z.object({
  viewId: z.string().min(1).max(120),
  /** `row:<id>` hoặc `form:<id>` — xem `runViewAction`. */
  actionId: z.string().min(3).max(120),
  row: z.record(z.string().max(MAX_VALUE_CHARS)).default({}),
  values: z.record(z.string().max(MAX_VALUE_CHARS)).default({}),
  context: Context,
  surface: z.enum(INFRA_SURFACES).default('explorer'),
  approvalTicket: z.string().max(100).optional(),
  sessionId: z.string().max(200).optional(),
  messageId: z.string().max(200).optional(),
})

register('infra.resource-action', async (raw) => {
  const p = Params.parse(raw)
  const spec = viewById(p.viewId)
  if (!spec) return { ok: false as const, blocked: false as const, error: 'unknown view', missing: [] }
  return runViewAction({
    spec,
    actionId: p.actionId,
    row: p.row,
    values: p.values,
    context: p.context,
    surface: p.surface,
    ...(p.approvalTicket !== undefined ? { approvalTicket: p.approvalTicket } : {}),
    ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
    ...(p.messageId !== undefined ? { messageId: p.messageId } : {}),
  })
})
