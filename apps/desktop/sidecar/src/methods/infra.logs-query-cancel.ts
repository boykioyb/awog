// `infra.logs-query-cancel` — huỷ một truy vấn Insights đang chạy (Mốc 2 việc 2.1).
//
// Vì sao cần một RPC riêng thay vì "ngừng poll": ngừng hỏi KHÔNG dừng truy vấn ở
// phía AWS — nó vẫn quét và vẫn tính tiền cho tới khi xong. Người dùng bấm Huỷ để
// DỪNG VIỆC TÍNH TIỀN, nên phải gọi `logs stop-query`. Đây là cùng bài học với
// `infra.console-login-cancel` ở Mốc 1 (huỷ mềm ≠ huỷ thật).
//
// `stop-query` không nằm trong allowlist `read` (nó đổi trạng thái tài nguyên)
// nên lớp là `write` — đúng, vì nó chạm vào một truy vấn thật đang chạy.
//
// Bề mặt của CON NGƯỜI.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { stopInsightsQuery } from '../infra/aws/logs.js'

const Params = z.object({
  queryId: z.string().min(1).max(128),
  profile: z.string().min(1).max(128).optional(),
  region: z.string().min(1).max(64).optional(),
  surface: z.enum(INFRA_SURFACES).default('logs'),
})

register('infra.logs-query-cancel', async (raw) => {
  const p = Params.parse(raw)
  const result = await stopInsightsQuery({
    queryId: p.queryId,
    ...(p.profile !== undefined ? { profile: p.profile } : {}),
    ...(p.region !== undefined ? { region: p.region } : {}),
    surface: p.surface,
  })
  // Huỷ một truy vấn đã xong trả lỗi từ AWS. Đó không phải sự cố: người dùng đạt
  // được điều họ muốn (truy vấn không còn chạy). Trả `ok:false` để UI nói được
  // lý do, nhưng không ném.
  if (!result.ok) return { ok: false as const, error: result.error }
  return { ok: true as const, stopped: result.value.stopped }
})
