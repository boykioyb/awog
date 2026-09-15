// `infra.logs-estimate` — ước lượng GB quét TRƯỚC khi chạy (Mốc 2 việc 2.6).
//
// Không bao giờ tự chạy: UI chỉ gọi khi người dùng vừa đổi câu lệnh / khoảng thời
// gian / log group, và nút Chạy hiện con số này kèm chi phí.
//
// Hai cơ sở, theo thứ tự ưu tiên:
//   1. `historyBytes` — `bytesScanned` ĐO ĐƯỢC của lần chạy trước cùng câu lệnh
//      (đọc từ thư viện ở `infra.logs-library`). Đây là số thật, không phải đoán.
//   2. Σ `storedBytes` của các group được chọn — một TRẦN TRÊN. UI phải nói rõ
//      "trần trên" chứ không được trình bày nó như số thật.
//
// Bề mặt của CON NGƯỜI. Không AgentTool nào gọi method này: `logs_query` (2.9) có
// đường ước lượng riêng của nó, kèm popup duyệt.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { estimateScan, MAX_LOG_GROUPS } from '../infra/aws/logs.js'
import { lastBytesFor } from '../infra/logs/library.js'

const Params = z.object({
  logGroups: z.array(z.string().min(1).max(512)).min(1).max(MAX_LOG_GROUPS),
  query: z.string().max(4096).optional(),
  profile: z.string().min(1).max(128).optional(),
  region: z.string().min(1).max(64).optional(),
  surface: z.enum(INFRA_SURFACES).default('logs'),
})

register('infra.logs-estimate', async (raw) => {
  const p = Params.parse(raw)

  // Ước lượng theo lịch sử chỉ có nghĩa khi biết CHÍNH XÁC câu lệnh. Câu rỗng thì
  // bỏ qua tầng này và rơi về trần trên — vẫn đúng, chỉ kém chính xác hơn.
  const historyBytes =
    p.query !== undefined && p.query.trim().length > 0 ? await lastBytesFor(p.query.trim()) : undefined

  const result = await estimateScan({
    logGroups: p.logGroups,
    ...(historyBytes !== undefined ? { historyBytes } : {}),
    ...(p.profile !== undefined ? { profile: p.profile } : {}),
    ...(p.region !== undefined ? { region: p.region } : {}),
    surface: p.surface,
  })
  if (!result.ok) return { ok: false as const, error: result.error }
  return { ok: true as const, ...result.value }
})
