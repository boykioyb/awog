// Ghim ngữ cảnh hạ tầng cho MỘT phiên (ADR 0088 §7, task 0.9).
//
// Đây là bề mặt ghi của tầng trên cùng trong chuỗi kế thừa phiên → project → toàn
// app. Phiên đã đóng băng ngữ cảnh lúc tạo (`Session.infra`), nên lời gọi này luôn
// là một hành động CHỦ ĐỘNG của người dùng: "từ giờ phiên này chạy trên tài khoản
// kia". Vì thế nó để lại đúng một dòng nhật ký (`class: 'context-switch'`) — đổi
// tài khoản mà không truy được thì nhật ký lệnh phía sau mất điểm neo.
//
// Payload là L1 (IPC từ UI): schema ở đây là biên validate duy nhất, và cap độ dài
// khớp với `InfraAuditContextSchema` để một giá trị hợp lệ ở đây không bị chính
// nhật ký từ chối.
//
// Ngữ nghĩa từng trường (bám theo `githubAccount`, KHÔNG phát minh cái khác):
//   - vắng mặt → kế thừa tiếp xuống project → toàn app
//   - ''       → cố ý KHÔNG ghim, DỪNG kế thừa
//   - có giá trị → ghim
// Không trường nào được định nghĩa ⇒ bỏ ghim cả cụm (xoá key khỏi header).
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { setSessionInfra } from '../sessions/store.js'
import { recordInfraAction } from '../infra/audit/store.js'
import type { InfraContext } from '../infra/run.js'

// id phiên đi vào một sink đường dẫn (thư mục phiên) — siết đúng charset như
// `sessions.setArchived` / `sessions.delete`.
const SESSION_ID_RE = /^[a-z0-9-]+$/

const ContextSchema = z.object({
  profile: z.string().max(200).optional(),
  region: z.string().max(64).optional(),
  accountId: z.string().max(64).optional(),
  cluster: z.string().max(200).optional(),
  namespace: z.string().max(200).optional(),
  workspace: z.string().max(500).optional(),
})

const Params = z.object({
  sessionId: z.string().min(1).regex(SESSION_ID_RE),
  context: ContextSchema,
})

// zod `.optional()` trả `T | undefined`, không gán được vào field optional dưới
// `exactOptionalPropertyTypes` — dựng lại object, bỏ hẳn key không có mặt.
function toInfraContext(parsed: z.infer<typeof ContextSchema>): InfraContext {
  const ctx: InfraContext = {}
  if (parsed.profile !== undefined) ctx.profile = parsed.profile
  if (parsed.region !== undefined) ctx.region = parsed.region
  if (parsed.accountId !== undefined) ctx.accountId = parsed.accountId
  if (parsed.cluster !== undefined) ctx.cluster = parsed.cluster
  if (parsed.namespace !== undefined) ctx.namespace = parsed.namespace
  if (parsed.workspace !== undefined) ctx.workspace = parsed.workspace
  return ctx
}

register('infra.setSessionContext', async (raw) => {
  const params = Params.parse(raw)
  const context = toInfraContext(params.context)

  const found = await setSessionInfra(params.sessionId, context)
  if (!found) throw new RpcError(-32004, 'Session not found')

  // Ghi SAU khi đã ghi được header: một dòng nhật ký cho lần đổi không xảy ra còn
  // tệ hơn không có dòng nào. `recordInfraAction` cố ý không nuốt lỗi, nên nhật ký
  // hỏng sẽ nổi lên thành lỗi RPC thay vì im lặng biến mất.
  //
  // `actor: 'human'` là hằng, không lấy từ payload: RPC này là bề mặt của NGƯỜI
  // dùng. Agent đổi ngữ cảnh đi qua tool `infra_context` (task 0.12) và tự khai
  // `agent:<tên>` ở đó — nếu để UI tự xưng actor thì trường quan trọng nhất của
  // nhật ký ("ai bảo làm") thành lời khai không kiểm chứng được.
  await recordInfraAction({
    actor: 'human',
    sessionId: params.sessionId,
    surface: 'session',
    tool: 'infra_context',
    argv: [],
    context,
    class: 'context-switch',
    decision: 'approved',
    result: {},
  })

  return { ok: true, context }
})
