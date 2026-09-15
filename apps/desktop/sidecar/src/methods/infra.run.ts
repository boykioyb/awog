// `infra.run` — chạy một lệnh hạ tầng TỪ BỀ MẶT CỦA NGƯỜI DÙNG, có cổng
// (ADR 0088 §3, §5; task 0.9).
//
// Khác `runInfra()` ở chỗ nào: `infra/run.ts` là cái CHÂN (spawn, chèn ngữ cảnh,
// từ chối cờ ghi đè, ghi nhật ký) và nó nhận sẵn `decision` — nó không tự quyết
// được phép chạy hay không. RPC này là cái ĐẦU: nó hỏi ma trận quyền trước, rồi
// mới gọi chân.
//
// Ba nhánh, đúng ba mức của ma trận:
//   block → KHÔNG spawn. Trả dòng lệnh về để người dùng tự chạy nếu họ muốn, và
//           vẫn để lại một dòng nhật ký — "AWOG đã từ chối lệnh gì" cũng là thứ
//           phải tra lại được.
//   ask   → RPC này chỉ phục vụ lời gọi ĐÃ được người dùng duyệt ở UI, nên nó đòi
//           `approved: true`. Thiếu ⇒ từ chối (kèm cờ `requiresApproval` để UI
//           biết phải mở hộp xác nhận), không phải im lặng chạy.
//   auto  → chạy thẳng; `decision` ghi vào nhật ký phân biệt `auto` (ô ma trận)
//           với `bypass-temp` (van xả tạm thời) — hai thứ này mà lẫn vào nhau thì
//           câu "vì sao lệnh đó chạy mà không ai hỏi tôi" không trả lời được.
//
// `actor: 'human'`: bề mặt gọi RPC này là Explorer/Logs/Settings — tức người
// dùng bấm nút. Agent KHÔNG đi qua đây; nó gọi tool `aws_cli` (task 0.12) và tool
// đó gọi thẳng `runInfra()` với actor `agent:<tên>`.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGated } from '../infra/gated.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import type { InfraGatedResult } from '../infra/gated.js'

// Trần của `args`: đây là L1 (payload IPC). 200 phần tử × 4096 ký tự là thừa sức
// cho mọi lệnh CLI thật, và chặn một payload phình to đi thẳng vào `execFile`.
const MAX_ARGS = 200
const MAX_ARG_CHARS = 4096

const ContextSchema = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
    accountId: z.string().max(64).optional(),
    cluster: z.string().max(200).optional(),
    namespace: z.string().max(200).optional(),
    // 500 là trần của `InfraAuditContextSchema`: nhật ký dùng `.parse()` nên một
    // giá trị dài hơn sẽ làm lượt ghi nhật ký NÉM, tức mất cả lệnh lẫn dấu vết.
    workspace: z.string().max(500).optional(),
  })
  .default({})

const Params = z.object({
  tool: z.enum(['aws', 'terraform', 'kubectl']),
  args: z.array(z.string().max(MAX_ARG_CHARS)).max(MAX_ARGS),
  context: ContextSchema,
  surface: z.enum(INFRA_SURFACES),
  /** Tên tool AWOG cho nhật ký (`infra_view`, `logs_query`…), KHÔNG phải tên binary. */
  toolName: z.string().min(1).max(120),
  /**
   * Vé duyệt một-lần do CHÍNH sidecar phát ở lượt gọi trước (xem infra/approvals.ts).
   * ⚠ Thay cho cờ `approved: boolean` của bản đầu: cờ đó do renderer tự khai, mà
   * payload IPC là L1 — "người dùng đã duyệt" lấy từ chính bên gọi thì không
   * chứng minh được gì (infosec audit #1). Khoá `approved` nếu còn được gửi lên
   * sẽ bị zod lược bỏ và KHÔNG có tác dụng nào.
   */
  approvalTicket: z.string().max(100).optional(),
  /**
   * Trần phiên tự siết (ADR 0088 §5b). Chỉ siết được: `decide()` lấy cái chặt hơn
   * giữa ma trận và giá trị này, nên một payload UI không nới quyền được bằng nó.
   */
  sessionFloor: z.enum(['auto', 'ask', 'block']).optional(),
  sessionId: z.string().max(200).optional(),
  messageId: z.string().max(200).optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
})

register('infra.run', async (raw): Promise<InfraGatedResult> => {
  const p = Params.parse(raw)
  // Toàn bộ luật của cổng (classify → decide → vé duyệt → runInfra) nằm ở
  // `infra/gated.ts`: RPC này chỉ còn là đường vào của bề mặt người dùng, để nó và
  // `infra.kube` không thể lệch luật nhau.
  return runGated({
    tool: p.tool,
    args: p.args,
    context: p.context,
    surface: p.surface,
    toolName: p.toolName,
    ...(p.approvalTicket !== undefined ? { approvalTicket: p.approvalTicket } : {}),
    ...(p.sessionFloor !== undefined ? { sessionFloor: p.sessionFloor } : {}),
    ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
    ...(p.messageId !== undefined ? { messageId: p.messageId } : {}),
    ...(p.timeoutMs !== undefined ? { timeoutMs: p.timeoutMs } : {}),
  })
})
