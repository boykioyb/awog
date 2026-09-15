// `infra.logs-query-start` — tạo một truy vấn Insights (Mốc 2 việc 2.1).
//
// ⚠ ĐÂY LÀ LỆNH TỐN TIỀN. Chỉ chạy sau một cú bấm của người dùng, và người dùng
// phải đã NHÌN THẤY ước lượng (`infra.logs-estimate`) trước đó — UI chịu trách
// nhiệm bắt buộc bước đó; ở đây `estimatedUsd` đi thẳng vào dòng nhật ký để câu
// "lần đó tốn bao nhiêu" trả lời được kể cả khi CLI hỏng giữa đường.
//
// Lệnh này KHÔNG nằm trong allowlist `read` của `classify.ts` (nó tạo tài nguyên
// và phát sinh chi phí) nên lớp của nó là `write`. Đường của agent không có method
// này — agent chỉ chạm Insights qua tool `logs_query` (2.9), nơi có popup duyệt.
//
// Bề mặt của CON NGƯỜI.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { MAX_LOG_GROUPS, MAX_ROWS, startInsightsQuery } from '../infra/aws/logs.js'

const Params = z.object({
  logGroups: z.array(z.string().min(1).max(512)).min(1).max(MAX_LOG_GROUPS),
  query: z.string().min(1).max(4096),
  startMs: z.number().int().positive(),
  endMs: z.number().int().positive(),
  limit: z.number().int().positive().max(MAX_ROWS).optional(),
  estimatedUsd: z.number().nonnegative().max(1000).optional(),
  profile: z.string().min(1).max(128).optional(),
  region: z.string().min(1).max(64).optional(),
  surface: z.enum(INFRA_SURFACES).default('logs'),
})

register('infra.logs-query-start', async (raw) => {
  const p = Params.parse(raw)
  const result = await startInsightsQuery({
    logGroups: p.logGroups,
    query: p.query,
    startMs: p.startMs,
    endMs: p.endMs,
    ...(p.limit !== undefined ? { limit: p.limit } : {}),
    ...(p.estimatedUsd !== undefined ? { estimatedUsd: p.estimatedUsd } : {}),
    ...(p.profile !== undefined ? { profile: p.profile } : {}),
    ...(p.region !== undefined ? { region: p.region } : {}),
    surface: p.surface,
  })
  if (!result.ok) return { ok: false as const, error: result.error }
  return { ok: true as const, queryId: result.value.queryId }
})
