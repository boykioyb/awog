// `infra.budget-list` / `infra.budget-save` — ngân sách AWS Budgets (Mốc 7, việc 7.4).
//
// HAI METHOD VÌ HAI LỚP QUYỀN KHÁC NHAU, không phải vì tiện: đọc đi thẳng, ghi đi qua
// `runGated` và có thể trả về nhánh "bị chặn, cần duyệt" mà UI phải xử. Gộp làm một
// method với cờ `write: true` là giấu sự khác biệt đó khỏi người đọc.
//
// File mỏng có chủ đích: validate ở biên (payload UI là L1) rồi gọi hàm module.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { DEFAULT_THRESHOLDS, listBudgets, saveBudget } from '../infra/cost/budgets.js'

const AccountId = z.string().regex(/^\d{12}$/, 'accountId phải là 12 chữ số')

const Context = z.object({
  profile: z.string().max(200).optional(),
  // `region` CỐ Ý không có mặt: Budgets là dịch vụ toàn cục và module ghim `us-east-1`.
  accountId: AccountId,
})

const ListParams = z.object({
  context: Context,
  surface: z.enum(INFRA_SURFACES).default('cost'),
})

register('infra.budget-list', async (raw) => {
  const p = ListParams.parse(raw)
  const res = await listBudgets({
    accountId: p.context.accountId,
    ...(p.context.profile !== undefined ? { profile: p.context.profile } : {}),
    surface: p.surface,
  })
  if (!res.ok) return { ok: false as const, error: res.error }
  return { ok: true as const, budgets: res.value }
})

const SaveParams = z.object({
  context: Context,
  name: z.string().trim().min(1).max(100),
  limitUsd: z.number().positive().max(1_000_000_000),
  // Ngưỡng là PHẦN TRĂM hạn mức. Trên 100 vẫn hợp lệ (cảnh báo khi đã vượt), nhưng 0
  // thì không: một ngưỡng 0% bắn ngay lúc tạo và thành tiếng ồn.
  thresholds: z.array(z.number().positive().max(1000)).max(5).optional(),
  emails: z.array(z.string().email().max(254)).max(10).optional(),
  update: z.boolean().default(false),
  approvalTicket: z.string().max(400).optional(),
  surface: z.enum(INFRA_SURFACES).default('cost'),
})

register('infra.budget-save', async (raw) => {
  const p = SaveParams.parse(raw)
  const res = await saveBudget({
    accountId: p.context.accountId,
    ...(p.context.profile !== undefined ? { profile: p.context.profile } : {}),
    name: p.name,
    limitUsd: p.limitUsd,
    thresholds: p.thresholds ?? DEFAULT_THRESHOLDS,
    ...(p.emails !== undefined ? { emails: p.emails } : {}),
    update: p.update,
    ...(p.approvalTicket !== undefined ? { approvalTicket: p.approvalTicket } : {}),
    surface: p.surface,
  })
  if (!res.ok) return { ok: false as const, error: res.error }

  // Nhánh bị cổng quyền chặn giữ NGUYÊN hình dạng §2 của hợp đồng mốc 5 — UI đã biết
  // đọc nó (mở hộp duyệt rồi gọi lại kèm `approvalTicket`), nên không chuẩn hoá lại ở đây.
  const gated = res.value
  if (gated.blocked) return { ok: false as const, blocked: true as const, gate: gated }
  return {
    ok: true as const,
    blocked: false as const,
    ranOk: gated.result.ok,
    error: gated.result.ok ? '' : gated.result.stderr.slice(0, 600),
  }
})
