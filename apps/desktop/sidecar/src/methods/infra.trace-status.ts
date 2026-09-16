// `infra.trace-status` — poll truy vấn lần theo request rồi DỰNG dòng thời gian (L5).
//
// VÌ SAO KHÔNG DÙNG THẲNG `infra.logs-query-status`. Method kia trả về DÒNG thô, còn
// màn này cần CHẶNG — gộp theo log group, sắp theo thời gian, đo khoảng cách, đánh
// dấu chặng hỏng. Phép gộp đó là logic nghiệp vụ và nó thuộc về sidecar: để renderer
// tự gộp là mở đường cho hai định nghĩa "một chặng" (một ở màn Logs, một ở chỗ khác)
// rồi hai màn nói hai câu khác nhau về cùng một request.
//
// Vòng poll KHÔNG ghi nhật ký (`getInsightsResults` đã đặt `audit: false` cho lớp
// `read`) — dòng quyết định là `start-query` ở `infra.trace-start`.
//
// Bề mặt của CON NGƯỜI.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { getInsightsResults } from '../infra/aws/logs.js'
import { TRACE_ROW_LIMIT, classifyTraceId, hopsFromRows, traceOf } from '../infra/logs/trace.js'

const Params = z.object({
  queryId: z.string().min(1).max(128),
  /** Id đang lần theo — đi cùng để dòng thời gian tự nói nó thuộc về request nào. */
  id: z.string().min(1).max(200),
  /** Trần dòng của CHÍNH lượt này, do `infra.trace-start` trả về. */
  limit: z.number().int().positive().max(TRACE_ROW_LIMIT).optional(),
  profile: z.string().min(1).max(128).optional(),
  region: z.string().min(1).max(64).optional(),
  surface: z.enum(INFRA_SURFACES).default('logs'),
})

register('infra.trace-status', async (raw) => {
  const p = Params.parse(raw)
  const check = classifyTraceId(p.id)
  if (!check.ok) return { ok: false as const, error: check.error }

  const poll = await getInsightsResults({
    queryId: p.queryId,
    ...(p.profile !== undefined ? { profile: p.profile } : {}),
    ...(p.region !== undefined ? { region: p.region } : {}),
    surface: p.surface,
  })
  if (!poll.ok) return { ok: false as const, error: poll.error }

  // Chỉ dựng chặng khi truy vấn ĐÃ XONG. Kết quả giữa chừng của Insights là một
  // phần ngẫu nhiên của tập khớp, nên dựng sớm sẽ vẽ ra một dòng thời gian thiếu
  // chặng mà nhìn vẫn như đủ — thứ sai nguy hiểm nhất ở màn này.
  const done = poll.value.status === 'Complete'
  const hops = done ? hopsFromRows(poll.value.rows) : []
  // So với trần THẬT của lượt đó, không phải hằng số: `trace-start` cho phép một
  // `limit` nhỏ hơn, và so với 200 thì một lượt `limit: 50` trả về đủ 50 dòng vẫn
  // im lặng — đúng lúc phải nói "có thể còn chặng chưa hiện".
  const truncated = done && poll.value.rows.length >= (p.limit ?? TRACE_ROW_LIMIT)

  return {
    ok: true as const,
    status: poll.value.status,
    bytesScanned: poll.value.bytesScanned,
    recordsMatched: poll.value.recordsMatched,
    trace: done ? traceOf(check.id, check.kind, 'logs', hops, truncated, []) : null,
  }
})
