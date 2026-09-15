// `infra.logs-query-status` — hỏi trạng thái + kết quả của một truy vấn Insights
// (Mốc 2 việc 2.1·2.2).
//
// UI gọi method này theo nhịp ~1.5s cho tới khi `status` là một trạng thái kết
// thúc. Mỗi lượt là MỘT lời gọi `logs get-query-results` (`read`, miễn phí).
//
// ⚠ Vòng poll KHÔNG ghi nhật ký (`audit: false` trong `logs.ts`) — nó do CHÍNH
// APP sinh, không phải người dùng bấm, và ghi mỗi nhịp một dòng sẽ nhấn chìm
// nhật ký. Dòng quyết định (`start-query`, kèm chi phí ước lượng) vẫn được ghi
// đầy đủ. `runInfra` chỉ cho bỏ ghi với lớp `read`.
//
// Bề mặt của CON NGƯỜI.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { getInsightsResults } from '../infra/aws/logs.js'

const Params = z.object({
  queryId: z.string().min(1).max(128),
  profile: z.string().min(1).max(128).optional(),
  region: z.string().min(1).max(64).optional(),
  surface: z.enum(INFRA_SURFACES).default('logs'),
})

register('infra.logs-query-status', async (raw) => {
  const p = Params.parse(raw)
  const result = await getInsightsResults({
    queryId: p.queryId,
    ...(p.profile !== undefined ? { profile: p.profile } : {}),
    ...(p.region !== undefined ? { region: p.region } : {}),
    surface: p.surface,
  })
  if (!result.ok) return { ok: false as const, error: result.error }
  return { ok: true as const, ...result.value }
})
