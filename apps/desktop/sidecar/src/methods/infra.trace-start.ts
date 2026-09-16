// `infra.trace-start` — bắt đầu lần theo MỘT request (L5).
//
// MỘT METHOD, HAI KẾT CỤC, và đó là chủ ý: người dùng dán một id rồi bấm một nút;
// họ không cần biết trước tài khoản có X-Ray hay không. Sidecar dò, rồi trả về nó
// đã đi đường nào:
//
//   · `mode: 'xray'` — xong NGAY trong lượt này, kèm dòng thời gian có timing thật.
//     Không có truy vấn nào chạy tiếp, không tốn GB quét nào.
//   · `mode: 'logs'` — đã tạo một truy vấn Insights xuyên nhiều nhóm log; UI poll
//     `infra.trace-status`, và huỷ bằng `infra.logs-query-cancel` đã có.
//
// ⚠ NHÁNH LOG TỐN TIỀN. Nó là một `start-query` thật, nên đi đúng luật của Mốc 2:
// UI phải đã hiện ước lượng (`infra.logs-estimate`) trước cú bấm, và `estimatedUsd`
// đi thẳng vào dòng nhật ký. Nhánh X-Ray thì không tính theo GB — nhưng vẫn được
// ghi nhật ký như mọi lệnh khác vì nó đọc nội dung request thật.
//
// Bề mặt của CON NGƯỜI: cú bấm CHÍNH LÀ sự cho phép (`decision: 'approved'`,
// `actor: 'human'`). Agent chưa có tool nào cho L5.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { MAX_LOG_GROUPS, startInsightsQuery } from '../infra/aws/logs.js'
import {
  TRACE_ROW_LIMIT,
  buildTraceQuery,
  classifyTraceId,
  traceFromXray,
  traceOf,
} from '../infra/logs/trace.js'

const Params = z.object({
  id: z.string().min(1).max(200),
  logGroups: z.array(z.string().min(1).max(512)).max(MAX_LOG_GROUPS).default([]),
  startMs: z.number().int().positive(),
  endMs: z.number().int().positive(),
  limit: z.number().int().positive().max(TRACE_ROW_LIMIT).optional(),
  estimatedUsd: z.number().nonnegative().max(1000).optional(),
  profile: z.string().min(1).max(128).optional(),
  region: z.string().min(1).max(64).optional(),
  surface: z.enum(INFRA_SURFACES).default('logs'),
})

register('infra.trace-start', async (raw) => {
  const p = Params.parse(raw)
  const check = classifyTraceId(p.id)
  if (!check.ok) return { ok: false as const, error: check.error }

  const context = {
    ...(p.profile !== undefined ? { profile: p.profile } : {}),
    ...(p.region !== undefined ? { region: p.region } : {}),
  }
  const notes: string[] = []

  // ── Nhánh X-Ray ────────────────────────────────────────────────────────────
  // Chỉ thử khi id ĐÚNG là trace id. Hỏng vì bất kỳ lý do gì (chưa bật X-Ray,
  // thiếu quyền, trace quá 30 ngày) là tín hiệu rơi sang nhánh log — KHÔNG phải
  // một sự cố để ném lên màn hình, vì nhánh sau vẫn trả lời được câu hỏi.
  if (check.kind === 'xray') {
    const xray = await traceFromXray({ id: check.id, ...context, surface: p.surface })
    if (xray.ok) {
      return {
        ok: true as const,
        mode: 'xray' as const,
        trace: traceOf(check.id, check.kind, 'xray', xray.value.hops, xray.value.truncated, []),
      }
    }
    notes.push('infra.trace.note.xrayFallback')
  }

  // ── Nhánh log ──────────────────────────────────────────────────────────────
  // Không có nhóm log thì DỪNG HẲN thay vì quét bừa: Insights không có khái niệm
  // "mọi nhóm", và đoán một danh sách hộ người dùng là đoán cả hoá đơn của họ.
  if (p.logGroups.length === 0) return { ok: false as const, error: 'NO_LOG_GROUP' }

  const query = buildTraceQuery(check.id, p.limit ?? TRACE_ROW_LIMIT)
  const started = await startInsightsQuery({
    logGroups: p.logGroups,
    query,
    startMs: p.startMs,
    endMs: p.endMs,
    limit: p.limit ?? TRACE_ROW_LIMIT,
    ...(p.estimatedUsd !== undefined ? { estimatedUsd: p.estimatedUsd } : {}),
    ...context,
    surface: p.surface,
  })
  if (!started.ok) return { ok: false as const, error: started.error }

  return {
    ok: true as const,
    mode: 'logs' as const,
    queryId: started.value.queryId,
    kind: check.kind,
    query,
    notes,
  }
})
