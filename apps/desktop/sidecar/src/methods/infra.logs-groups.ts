// `infra.logs-groups` — liệt kê log group để chọn (Mốc 2 việc 2.1).
//
// Chỉ METADATA: tên, ARN, dung lượng đang lưu, thời hạn giữ. Không dòng log nào
// ở đây — nên nó rẻ, không tốn tiền Insights, và gọi được mỗi lần người dùng mở
// ô chọn. Đây là lý do `describe-log-groups` KHÔNG nằm trong nhóm bị siết
// (`SENSITIVE_READ_OPS`): nó không trả nội dung.
//
// Bề mặt của CON NGƯỜI. Không AgentTool nào gọi method này.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { listLogGroups } from '../infra/aws/logs.js'

const Params = z.object({
  profile: z.string().min(1).max(128).optional(),
  region: z.string().min(1).max(64).optional(),
  surface: z.enum(INFRA_SURFACES).default('logs'),
  prefix: z.string().max(512).optional(),
  pattern: z.string().max(512).optional(),
  limit: z.number().int().positive().max(500).optional(),
  nextToken: z.string().max(8192).optional(),
})

register('infra.logs-groups', async (raw) => {
  const p = Params.parse(raw)
  const result = await listLogGroups({
    ...(p.profile !== undefined ? { profile: p.profile } : {}),
    ...(p.region !== undefined ? { region: p.region } : {}),
    surface: p.surface,
    ...(p.prefix !== undefined ? { prefix: p.prefix } : {}),
    ...(p.pattern !== undefined ? { pattern: p.pattern } : {}),
    ...(p.limit !== undefined ? { limit: p.limit } : {}),
    ...(p.nextToken !== undefined ? { nextToken: p.nextToken } : {}),
  })
  // Lỗi CLI là KẾT QUẢ hợp lệ (quyền thiếu, region sai, hết phiên SSO), không
  // phải sự cố RPC: UI phải hiện được câu của AWS thay vì "Internal error".
  if (!result.ok) return { ok: false as const, error: result.error }
  return { ok: true as const, groups: result.value.groups, nextToken: result.value.nextToken }
})
