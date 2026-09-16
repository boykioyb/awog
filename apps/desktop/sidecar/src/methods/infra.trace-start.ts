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
// ⚠ NHÁNH LOG TỐN TIỀN. Nó là một `start-query` thật, nên đi đúng luật của Mốc 2 —
// nhưng con số ghi vào nhật ký được TÍNH Ở ĐÂY chứ không nhận từ renderer.
//
// Vì sao: bản đầu nhận `estimatedUsd` do renderer khai, và renderer gửi xuống con
// số ước lượng của câu Insights đang nằm trong editor — một câu KHÁC hẳn câu
// lần-theo vừa chạy. Dòng nhật ký vì thế trả lời sai đúng câu hỏi nó sinh ra để
// trả lời ("lượt đó tốn bao nhiêu"). Cùng bài học với vé duyệt ở Mốc 0: một con số
// do renderer tự khai thì không phải bằng chứng.
//
// Nhánh X-Ray không tính theo GB — nhưng vẫn được ghi nhật ký như mọi lệnh khác vì
// nó đọc nội dung request thật.
//
// Bề mặt của CON NGƯỜI: cú bấm CHÍNH LÀ sự cho phép (`decision: 'approved'`,
// `actor: 'human'`). Agent chưa có tool nào cho L5.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { MAX_LOG_GROUPS, estimateScan, startInsightsQuery } from '../infra/aws/logs.js'
import { lastBytesFor } from '../infra/logs/library.js'
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
  // `notes` đi cùng CẢ nhánh lỗi: một lượt X-Ray vừa hỏng mà người dùng chưa chọn
  // nhóm log nào thì họ nhận đúng hai tin — "chưa chọn nhóm" và "X-Ray không đọc
  // được" — chứ không phải chỉ tin thứ nhất rồi tự hỏi vì sao không có timing.
  if (p.logGroups.length === 0) return { ok: false as const, error: 'NO_LOG_GROUP', notes }

  const limit = p.limit ?? TRACE_ROW_LIMIT
  const query = buildTraceQuery(check.id, limit)

  // Ước lượng bằng ĐÚNG câu vừa dựng. `lastBytesFor` khoá theo chuỗi câu lệnh, mà
  // câu lần-theo mang chính id trong nó, nên lần thứ hai lần theo CÙNG một request
  // mới dùng được số đo thật; id khác thì rơi về trần trên — đúng và an toàn.
  const history = await lastBytesFor(query)
  const estimate = await estimateScan({
    logGroups: p.logGroups,
    ...(history !== undefined ? { historyBytes: history } : {}),
    ...context,
    surface: p.surface,
  })

  const started = await startInsightsQuery({
    logGroups: p.logGroups,
    query,
    startMs: p.startMs,
    endMs: p.endMs,
    limit,
    ...(estimate.ok ? { estimatedUsd: estimate.value.usd } : {}),
    ...context,
    surface: p.surface,
  })
  if (!started.ok) return { ok: false as const, error: started.error, notes }

  return {
    ok: true as const,
    mode: 'logs' as const,
    queryId: started.value.queryId,
    kind: check.kind,
    query,
    // Trần dòng THẬT của lượt này — `trace-status` cần nó để biết khi nào kết quả
    // đã chạm trần. So với hằng số thì một lượt `limit: 50` không bao giờ cảnh báo.
    limit,
    ...(estimate.ok ? { estimate: { bytes: estimate.value.bytes, usd: estimate.value.usd, basis: estimate.value.basis } } : {}),
    notes,
  }
})
