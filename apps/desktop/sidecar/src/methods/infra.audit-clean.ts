// `infra.audit-clean` — dọn nhật ký (task 3.9). CHỈ con người, và luôn để lại dấu.
//
// HAI HÀNG RÀO Ở ĐÂY, CẢ HAI ĐỀU Ở SIDECAR chứ không ở hộp thoại:
//
//   1. `expectRemoved` — số dòng mà hộp xác nhận ĐÃ NÊU với người dùng. Sidecar
//      đếm lại ngay trước khi xoá; lệch ⇒ TỪ CHỐI. Không có hàng rào này, một
//      nhật ký vừa được ghi thêm giữa lúc mở hộp thoại và lúc bấm nút sẽ âm thầm
//      xoá nhiều hơn con số người dùng đã đọc — và "dọn đúng cái tôi thấy" là cả
//      điểm của hộp thoại đó.
//
//   2. `typed` cho chế độ dọn TẤT CẢ. Xoá theo bộ lọc chỉ cần `expectRemoved`;
//      xoá tất cả phải gõ `DELETE ALL` (ASCII, không phụ thuộc locale — một từ
//      tiếng Việt có dấu vừa dễ gõ sai vừa khó kiểm chính xác).
//
// KHÔNG có tool nào của agent map tới RPC này. Nếu agent dọn được nhật ký thì nhật
// ký không còn là bằng chứng — đó là lý do `cleanInfraAudit` không xuất hiện trong
// bất kỳ danh mục tool nào.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import {
  INFRA_COMMAND_CLASSES,
  INFRA_DECISIONS,
  cleanInfraAudit,
  summarizeInfraAudit,
  type InfraAuditFilter,
} from '../infra/audit/store.js'

const ALL_TOKEN = 'DELETE ALL'

const Params = z.object({
  mode: z.enum(['filtered', 'all']),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  actor: z.string().max(200).optional(),
  class: z.enum(INFRA_COMMAND_CLASSES).optional(),
  decision: z.enum(INFRA_DECISIONS).optional(),
  contains: z.string().max(200).optional(),
  /** Số dòng hộp xác nhận đã nêu. Lệch ⇒ từ chối, không xoá gì. */
  expectRemoved: z.number().int().nonnegative(),
  typed: z.string().max(64).default(''),
})

register('infra.audit-clean', async (raw) => {
  const p = Params.parse(raw)
  if (p.mode === 'all' && p.typed.trim().toUpperCase() !== ALL_TOKEN) {
    return { ok: false as const, reason: 'confirm' as const }
  }
  const filter: InfraAuditFilter =
    p.mode === 'all'
      ? {}
      : {
          ...(p.since !== undefined ? { since: p.since } : {}),
          ...(p.until !== undefined ? { until: p.until } : {}),
          ...(p.actor !== undefined ? { actor: p.actor } : {}),
          ...(p.class !== undefined ? { class: p.class } : {}),
          ...(p.decision !== undefined ? { decision: p.decision } : {}),
          ...(p.contains !== undefined ? { contains: p.contains } : {}),
        }
  const before = await summarizeInfraAudit(filter)
  if (before.total !== p.expectRemoved) {
    return { ok: false as const, reason: 'changed' as const, total: before.total }
  }
  const { removed } = await cleanInfraAudit(filter)
  return { ok: true as const, removed }
})
