// `infra.cost-summary` — màn Chi phí (Mốc 7, việc 7.1).
//
// ⚠ LỆNH TỐN TIỀN: `ce` tính $0.01 mỗi request, và một lượt nạp là BA request. Ba hàng
// rào (theo lô · cache theo NGÀY · không tự chạy) nằm ở `infra/cost/cost.ts`, không ở
// đây — cùng khuôn `infra.metrics.ts`. File này mỏng có chủ đích: validate biên (payload
// UI là L1) rồi gọi hàm module.
//
// Bề mặt của CON NGƯỜI. Đường của agent nếu có sẽ là một tool riêng ở `runtime/tools/`.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { getCostSummary } from '../infra/cost/cost.js'
import { PRICING_AS_OF, PRICING_REGION } from '../infra/cost/pricing.js'
import { PAID_CHECKS, WASTE_CHECKS, runWasteScan } from '../infra/cost/waste.js'
import { buildCleanupDraft } from '../infra/cost/cleanup.js'

const Context = z
  .object({
    profile: z.string().max(200).optional(),
    // `region` CỐ Ý không có mặt: Cost Explorer là dịch vụ toàn cục và module ghim
    // `us-east-1`. Nhận một vùng ở đây là hứa một thứ lời gọi không làm.
    accountId: z.string().max(64).optional(),
  })
  .default({})

const Params = z.object({
  context: Context,
  metric: z.enum(['UnblendedCost', 'AmortizedCost']).optional(),
  /** Bỏ qua cache theo ngày. Chỉ đến từ nút "Nạp lại". */
  force: z.boolean().optional(),
  surface: z.enum(INFRA_SURFACES).default('cost'),
})

register('infra.cost-summary', async (raw) => {
  const p = Params.parse(raw)
  const res = await getCostSummary({
    ...(p.context.profile !== undefined ? { profile: p.context.profile } : {}),
    ...(p.metric !== undefined ? { metric: p.metric } : {}),
    ...(p.force !== undefined ? { force: p.force } : {}),
    surface: p.surface,
  })
  if (!res.ok) return { ok: false as const, error: res.error }
  return { ok: true as const, summary: res.value }
})

// ─── `infra.cost-waste` — dò lãng phí (7.2) ──────────────────────────────────
//
// KHÔNG PHẢI MỌI PHÉP DÒ ĐỀU MIỄN PHÍ. Năm phép chỉ `describe-*` (lớp `read`); hai phép
// `ec2-idle`/`nat-idle` cần `get-metric-data` và TÍNH TIỀN. `checks` mặc định là năm
// phép miễn phí — muốn hai phép kia thì UI phải xin tường minh, sau khi nói giá cho
// người dùng. Ở đây chỉ validate; luật nằm ở `infra/cost/waste.ts`.

const WasteParams = z.object({
  context: z
    .object({
      profile: z.string().max(200).optional(),
      // Dò lãng phí thì `region` CÓ nghĩa (khác `cost-summary`): EIP, EBS, NAT, ALB đều
      // là tài nguyên theo vùng, và một lượt dò chỉ thấy vùng đang ghim.
      region: z.string().max(64).optional(),
      accountId: z.string().max(64).optional(),
    })
    .default({}),
  checks: z.array(z.enum(WASTE_CHECKS)).max(WASTE_CHECKS.length).optional(),
  surface: z.enum(INFRA_SURFACES).default('cost'),
})

register('infra.cost-waste', async (raw) => {
  const p = WasteParams.parse(raw)
  const res = await runWasteScan({
    ...(p.context.profile !== undefined ? { profile: p.context.profile } : {}),
    ...(p.context.region !== undefined ? { region: p.context.region } : {}),
    ...(p.checks !== undefined ? { checks: p.checks } : {}),
    surface: p.surface,
  })
  if (!res.ok) return { ok: false as const, error: res.error }
  return {
    ok: true as const,
    report: res.value,
    // Đi kèm mỗi lượt trả về, vì UI PHẢI nói được ước lượng này lấy giá ở đâu và từ bao
    // giờ. Một con số tiền không có xuất xứ là một con số không kiểm được.
    pricing: { asOf: PRICING_AS_OF, region: PRICING_REGION },
    paidChecks: PAID_CHECKS,
  }
})

// ─── `infra.cost-cleanup-draft` — phát hiện → bản nháp playbook (7.3) ────────
//
// TRẢ VỀ BẢN NHÁP, KHÔNG TỰ LƯU. Lượt này không ghi gì xuống đĩa: UI mở bản nháp trong
// trình soạn playbook để người dùng xem rồi mới Lưu. Hai lý do, cả hai đều cứng:
//   · kế hoạch này chứa lệnh GHI trên tài khoản AWS — không có đường nào để nó xuất hiện
//     trên đĩa mà người dùng chưa từng nhìn thấy nội dung;
//   · đường ghi playbook đã có đúng MỘT cửa (`infra.playbook-save`, đã validate + đã có
//     luật rollback). Mở cửa thứ hai ở đây là hai nơi cùng ghi một loại file.
//
// Hình dạng lệnh AWS dựng Ở SIDECAR chứ không ở renderer: tri thức "trả một EIP thì gọi
// lệnh gì, và quay lui bằng gì" thuộc tầng biết về AWS.

const CleanupFinding = z.object({
  check: z.enum(WASTE_CHECKS),
  resourceId: z.string().min(1).max(512),
  label: z.string().max(512).default(''),
  region: z.string().max(64).default(''),
  monthlyUsd: z.number().nullable().default(null),
  overEstimate: z.boolean().default(false),
  detail: z.record(z.string(), z.string()).default({}),
})

const CleanupParams = z.object({
  findings: z.array(CleanupFinding).min(1).max(100),
  name: z.string().trim().min(1).max(160),
  region: z.string().max(64).default(''),
})

register('infra.cost-cleanup-draft', (raw) => {
  const p = CleanupParams.parse(raw)
  return Promise.resolve({
    ok: true as const,
    draft: buildCleanupDraft(p.findings, { name: p.name, region: p.region }),
  })
})
