import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { buildSnapshot, type MonitorSnapshot } from '../monitor/snapshot.js'
import { resetSampler } from '../monitor/sampler.js'

const Params = z
  .object({
    // 'awog' (mặc định) = cây tiến trình của app; 'machine' = cả máy;
    // 'ssh' = máy ở đầu kia một kết nối SSH đang mở.
    scope: z.enum(['awog', 'machine', 'ssh']).optional(),
    connId: z.string().min(1).max(64).optional(),
  })
  .optional()

// Một nhịp đo của trang Giám sát. CPU là HIỆU giữa nhịp này và nhịp trước, nên
// method có trạng thái: gọi lần đầu (hoặc sau `monitor.reset`) trả `warmingUp`.
// Trạng thái đó key theo NGUỒN, nên máy này và từng kết nối SSH không trộn pid.
register('monitor.sample', async (raw): Promise<MonitorSnapshot> => {
  const params = Params.parse(raw) ?? {}
  // `exactOptionalPropertyTypes`: khoá có mặt với giá trị `undefined` KHÁC với
  // khoá vắng mặt, nên dựng lại object thay vì chuyển thẳng cái zod trả về.
  return buildSnapshot({
    ...(params.scope ? { scope: params.scope } : {}),
    ...(params.connId ? { connId: params.connId } : {}),
  })
})

// UI rời trang rồi quay lại, hoặc đổi phạm vi đo: bỏ mốc cũ đi, vì hiệu CPU trên
// một khoảng nghỉ dài là trung bình của cả khoảng đó chứ không phải "bây giờ".
register('monitor.reset', (): { ok: true } => {
  resetSampler()
  return { ok: true }
})
