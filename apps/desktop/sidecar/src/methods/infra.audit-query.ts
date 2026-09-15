// `infra.audit-query` — đọc nhật ký hoạt động cho màn Nhật ký (task 3.9).
//
// Bề mặt của CON NGƯỜI. Agent có đường riêng (`audit_query` trong danh mục tool,
// task N4) và đường đó trả về dữ liệu ĐÃ CLAMP — nhưng cả hai đọc cùng một store,
// nên bộ lọc ở đây dùng đúng `InfraAuditFilter` của store chứ không tự định nghĩa
// lại (một định nghĩa bộ lọc thứ hai là hai câu trả lời cho "tuần này tôi chạy gì").
//
// Đi kèm `summary` trong CÙNG một lượt: màn Nhật ký luôn hiện dòng tổng
// ("412 hành động · 38 ghi · 2 phá huỷ · 1 bị từ chối") ngay trên bảng, nên tách
// thành hai RPC là hai lần quét file và một trạng thái lệch giữa bảng và tổng.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import {
  INFRA_COMMAND_CLASSES,
  INFRA_DECISIONS,
  queryInfraAudit,
  summarizeInfraAudit,
  type InfraAuditFilter,
} from '../infra/audit/store.js'

const Params = z.object({
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  actor: z.string().max(200).optional(),
  class: z.enum(INFRA_COMMAND_CLASSES).optional(),
  decision: z.enum(INFRA_DECISIONS).optional(),
  contains: z.string().max(200).optional(),
  limit: z.number().int().positive().max(2000).optional(),
})

register('infra.audit-query', async (raw) => {
  const p = Params.parse(raw)
  const filter: InfraAuditFilter = {
    ...(p.since !== undefined ? { since: p.since } : {}),
    ...(p.until !== undefined ? { until: p.until } : {}),
    ...(p.actor !== undefined ? { actor: p.actor } : {}),
    ...(p.class !== undefined ? { class: p.class } : {}),
    ...(p.decision !== undefined ? { decision: p.decision } : {}),
    ...(p.contains !== undefined ? { contains: p.contains } : {}),
  }
  const [entries, summary] = await Promise.all([
    queryInfraAudit({ ...filter, ...(p.limit !== undefined ? { limit: p.limit } : {}) }),
    summarizeInfraAudit(filter),
  ])
  return { entries, summary }
})
