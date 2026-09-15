// `infra.metrics-query` — nạp số liệu CloudWatch cho màn Giám sát (Mốc 6, 6.2).
//
// ⚠ ĐÂY LÀ LỆNH TỐN TIỀN, VÀ TÍNH THEO SỐ METRIC × SỐ ĐIỂM. Ba hàng rào, hàng rào
// nào cũng nằm ở tầng module chứ không ở đây:
//   1. Nạp theo LÔ — `infra/aws/metrics.ts` chia lô và đây là đường vào duy nhất;
//   2. CACHE — cùng (profile, region, cửa sổ, metric) thì không spawn CLI lần hai;
//   3. KHÔNG TỰ LÀM MỚI — `force: true` chỉ đến từ cú bấm "Nạp lại" của người dùng.
//
// File này MỎNG có chủ đích: validate ở biên (payload UI là L1) rồi gọi hàm module.
// Cổng quyền, chia lô, cache, bóc JSON đều thuộc `infra/aws/metrics.ts` — một bản
// sao của chúng ở đây là chỗ để hai bề mặt lệch nhau.
//
// Bề mặt của CON NGƯỜI (màn Giám sát). Đường của agent nếu có sẽ là một tool riêng
// ở `runtime/tools/`, không phải method này.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { MAX_SERIES_PER_REQUEST, getMetricData } from '../infra/aws/metrics.js'

const Dimension = z.object({
  name: z.string().min(1).max(255),
  value: z.string().min(1).max(1024),
})

const Query = z.object({
  key: z.string().min(1).max(64),
  namespace: z.string().min(1).max(255),
  metricName: z.string().min(1).max(255),
  dimensions: z.array(Dimension).max(30).optional(),
  stat: z.string().min(1).max(16),
  periodSeconds: z.number().int().positive().max(86_400),
  unit: z.string().max(32).optional(),
  label: z.string().max(255).optional(),
})

const Context = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
    accountId: z.string().max(64).optional(),
  })
  .default({})

const Params = z.object({
  context: Context,
  startMs: z.number().int().positive(),
  endMs: z.number().int().positive(),
  queries: z.array(Query).min(1).max(MAX_SERIES_PER_REQUEST),
  /** Bỏ qua cache. Chỉ dùng cho nút "Nạp lại". */
  force: z.boolean().optional(),
  surface: z.enum(INFRA_SURFACES).default('explorer'),
})

register('infra.metrics-query', async (raw) => {
  const p = Params.parse(raw)
  const result = await getMetricData({
    // Chọn trường TƯỜNG MINH (payload UI là L1, không spread nguyên payload).
    queries: p.queries.map((q) => ({
      key: q.key,
      namespace: q.namespace,
      metricName: q.metricName,
      stat: q.stat,
      periodSeconds: q.periodSeconds,
      ...(q.dimensions !== undefined ? { dimensions: q.dimensions } : {}),
      ...(q.unit !== undefined ? { unit: q.unit } : {}),
      ...(q.label !== undefined ? { label: q.label } : {}),
    })),
    startMs: p.startMs,
    endMs: p.endMs,
    ...(p.context.profile !== undefined ? { profile: p.context.profile } : {}),
    ...(p.context.region !== undefined ? { region: p.context.region } : {}),
    surface: p.surface,
    ...(p.force !== undefined ? { force: p.force } : {}),
  })
  if (!result.ok) return { ok: false as const, error: result.error }
  return {
    ok: true as const,
    series: result.value.series,
    fromCache: result.value.fromCache,
    calls: result.value.calls,
  }
})
