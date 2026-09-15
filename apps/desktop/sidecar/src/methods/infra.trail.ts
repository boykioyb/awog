// `infra.trail-lookup` — CloudTrail ghép vào màn Nhật ký (Mốc 7, việc 7.6).
//
// Bề mặt của CON NGƯỜI: màn Nhật ký và tab "Lịch sử thay đổi" của một tài nguyên.
//
// NHÃN `origin` LÀ SUY ĐOÁN. Phép ghép giữa CloudTrail và sổ AWOG dựa trên tên thao tác
// + thời gian, không có id chung — mọi giới hạn ghi ở đầu `infra/audit/trail.ts`. Lượt
// trả về kèm `matchedAt` cho từng sự kiện `awog` để UI chỉ ra ĐƯỢC dòng sổ đã khớp, thay
// vì bắt người đọc tin một cái nhãn.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { MATCH_WINDOW_MS, TRAIL_MAX_DAYS, lookupTrail } from '../infra/audit/trail.js'

const Params = z.object({
  context: z
    .object({
      profile: z.string().max(200).optional(),
      region: z.string().max(64).optional(),
      accountId: z.string().max(64).optional(),
    })
    .default({}),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  /** Một tài nguyên cụ thể — đây là đường của tab "Lịch sử thay đổi". */
  resourceName: z.string().max(512).optional(),
  eventName: z.string().max(128).optional(),
  surface: z.enum(INFRA_SURFACES).default('audit'),
})

register('infra.trail-lookup', async (raw) => {
  const p = Params.parse(raw)
  const res = await lookupTrail({
    ...(p.context.profile !== undefined ? { profile: p.context.profile } : {}),
    ...(p.context.region !== undefined ? { region: p.context.region } : {}),
    ...(p.since !== undefined ? { since: p.since } : {}),
    ...(p.until !== undefined ? { until: p.until } : {}),
    ...(p.resourceName !== undefined ? { resourceName: p.resourceName } : {}),
    ...(p.eventName !== undefined ? { eventName: p.eventName } : {}),
    surface: p.surface,
  })
  if (!res.ok) return { ok: false as const, error: res.error }
  return {
    ok: true as const,
    report: res.value,
    // Hai giới hạn đi kèm mỗi lượt vì UI phải nói được chúng ra: người dùng hỏi "sao
    // không thấy gì từ tháng trước" và câu trả lời là 90 ngày, không phải một lỗi.
    limits: { maxDays: TRAIL_MAX_DAYS, matchWindowMs: MATCH_WINDOW_MS },
  }
})
