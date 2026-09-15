// `infra.audit-export` — dựng nội dung bản xuất nhật ký (task 3.9).
//
// TRẢ VỀ CHUỖI, KHÔNG TỰ GHI FILE. Việc ghi đi qua RPC `fs.writeFile` đã có, tức
// qua `assertInsideWorkspace` + ghi nguyên tử + không tự đè. Một đường ghi riêng
// ở đây chỉ để tiện sẽ là đường ghi thứ hai phải bảo vệ — và nó sẽ là đường duy
// nhất trong họ tính năng không đi qua `assertInsideWorkspace`.
//
// Trần `limit`: bản xuất là để MỞ BẰNG EXCEL hoặc đưa cho người khác, không phải
// để sao lưu. 20.000 dòng đầu là quá đủ cho việc đó, và cái trần khiến payload IPC
// có giới hạn xác định (nhật ký một tháng có thể lớn tuỳ account).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import {
  INFRA_COMMAND_CLASSES,
  INFRA_DECISIONS,
  queryInfraAudit,
  type InfraAuditFilter,
} from '../infra/audit/store.js'
import { exportFilename, renderExport } from '../infra/audit/export.js'

const MAX_EXPORT = 20_000

const Params = z.object({
  format: z.enum(['csv', 'jsonl']),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  actor: z.string().max(200).optional(),
  class: z.enum(INFRA_COMMAND_CLASSES).optional(),
  decision: z.enum(INFRA_DECISIONS).optional(),
  contains: z.string().max(200).optional(),
  limit: z.number().int().positive().max(MAX_EXPORT).default(MAX_EXPORT),
})

register('infra.audit-export', async (raw) => {
  const p = Params.parse(raw)
  const filter: InfraAuditFilter = {
    ...(p.since !== undefined ? { since: p.since } : {}),
    ...(p.until !== undefined ? { until: p.until } : {}),
    ...(p.actor !== undefined ? { actor: p.actor } : {}),
    ...(p.class !== undefined ? { class: p.class } : {}),
    ...(p.decision !== undefined ? { decision: p.decision } : {}),
    ...(p.contains !== undefined ? { contains: p.contains } : {}),
  }
  const entries = await queryInfraAudit({ ...filter, limit: p.limit })
  return {
    ok: true as const,
    filename: exportFilename(p.format),
    count: entries.length,
    text: renderExport(entries, p.format),
  }
})
