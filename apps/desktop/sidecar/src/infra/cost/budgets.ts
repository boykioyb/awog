// Ngân sách AWS Budgets (Mốc 7, việc 7.4): đọc hạn mức + mức đã tiêu, và đặt một ngân
// sách tháng kèm ngưỡng cảnh báo.
//
// ĐỌC VÀ GHI ĐI HAI ĐƯỜNG KHÁC NHAU, CÓ CHỦ ĐÍCH:
//   · `describe-budgets` nằm trong allowlist `read` ⇒ `runInfra` thẳng sau cú bấm.
//   · `create-budget`/`update-budget` KHÔNG nằm trong allowlist ⇒ lớp `write` ⇒ đi qua
//     `runGated`, tức là qua ma trận quyền và hộp duyệt. Ngân sách là cấu hình của TÀI
//     KHOẢN, không phải của AWOG: đặt sai một ngưỡng là làm im một cảnh báo tiền thật.
//
// `--account-id` LÀ BẮT BUỘC VÀ KHÔNG ĐOÁN ĐƯỢC. API Budgets đòi id tài khoản tường
// minh; AWOG có nó trong ngữ cảnh (`context.accountId`, giải qua `account-ids.ts`).
// Thiếu thì trả lỗi có tên thay vì spawn một lệnh chắc chắn hỏng.
//
// KHÔNG TỰ TẠO NGÂN SÁCH. Không có đường nào ở đây chạy mà không có một cú bấm phía
// trên, và lượt ghi còn phải qua hộp duyệt nữa.
import { z } from 'zod'
import { runInfra } from '../run.js'
import { runGated } from '../gated.js'
import { lowerFirstKeys } from '../aws/metrics.js'
import type { InfraGatedResult } from '../gated.js'
import type { InfraSurface } from '../audit/store.js'

const TIMEOUT_MS = 60_000

/** Ngưỡng cảnh báo mặc định (phần trăm hạn mức) khi người dùng không chọn gì khác. */
export const DEFAULT_THRESHOLDS = [80, 100] as const

/** Trần số ngân sách đọc một lượt — API trả tối đa 100 mỗi trang. */
const MAX_BUDGETS = 100

export type BudgetOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

export type Budget = {
  name: string
  /** `COST` · `USAGE` … AWOG chỉ ĐẶT loại `COST`, nhưng ĐỌC được mọi loại đã có. */
  budgetType: string
  /** `MONTHLY` · `QUARTERLY` · `ANNUALLY`. */
  timeUnit: string
  limitUsd: number | null
  /** Đã tiêu trong kỳ hiện tại, theo chính AWS tính. `null` khi AWS chưa trả số. */
  actualUsd: number | null
  /** AWS dự báo cho hết kỳ. `null` khi chưa đủ lịch sử. */
  forecastUsd: number | null
}

// ─── Bóc JSON ────────────────────────────────────────────────────────────────

const Spend = z.object({ amount: z.string(), unit: z.string().optional() })

const BudgetWire = z.object({
  budgetName: z.string(),
  budgetType: z.string().optional(),
  timeUnit: z.string().optional(),
  budgetLimit: Spend.optional(),
  calculatedSpend: z
    .object({ actualSpend: Spend.optional(), forecastedSpend: Spend.optional() })
    .optional(),
})

const DescribeBudgets = z.object({ budgets: z.array(BudgetWire).default([]) })

function amount(s: { amount: string } | undefined): number | null {
  if (!s) return null
  const v = Number.parseFloat(s.amount)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null
}

function cliError(run: { stderr: string; exitCode: number | null }): string {
  const detail = run.stderr.trim() || `aws exited with code ${String(run.exitCode)}`
  return detail.slice(0, 600)
}

// ─── Đọc ─────────────────────────────────────────────────────────────────────

export type BudgetReadInput = {
  accountId: string
  profile?: string | undefined
  surface: InfraSurface
  actor?: string | undefined
}

export async function listBudgets(input: BudgetReadInput): Promise<BudgetOutcome<Budget[]>> {
  if (!input.accountId) return { ok: false, error: 'NO_ACCOUNT_ID' }

  const run = await runInfra({
    tool: 'aws',
    args: [
      'budgets',
      'describe-budgets',
      '--account-id',
      input.accountId,
      '--max-results',
      String(MAX_BUDGETS),
      '--output',
      'json',
    ],
    context: {
      ...(input.profile ? { profile: input.profile } : {}),
      // Budgets là dịch vụ TOÀN CỤC (endpoint `us-east-1`), y như Cost Explorer.
      region: 'us-east-1',
    },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'budget_list',
    decision: 'approved',
    timeoutMs: TIMEOUT_MS,
  })
  if (!run.ok) return { ok: false, error: cliError(run) }

  let parsedJson: unknown
  try {
    parsedJson = lowerFirstKeys(JSON.parse(run.stdout))
  } catch {
    return { ok: false, error: 'BAD_OUTPUT' }
  }
  const parsed = DescribeBudgets.safeParse(parsedJson)
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }

  return {
    ok: true,
    value: parsed.data.budgets.map((b) => ({
      name: b.budgetName,
      budgetType: b.budgetType ?? '',
      timeUnit: b.timeUnit ?? '',
      limitUsd: amount(b.budgetLimit),
      actualUsd: amount(b.calculatedSpend?.actualSpend),
      forecastUsd: amount(b.calculatedSpend?.forecastedSpend),
    })),
  }
}

// ─── Ghi ─────────────────────────────────────────────────────────────────────

/** Tên ngân sách: AWS cấm vài ký tự, và tên đi thẳng vào argv nên phải chặt ở biên. */
const NAME_RE = /^[A-Za-z0-9 ._:-]{1,100}$/

export function isValidBudgetName(name: string): boolean {
  return NAME_RE.test(name)
}

export type BudgetSaveInput = BudgetReadInput & {
  name: string
  limitUsd: number
  /** Phần trăm hạn mức để AWS bắn cảnh báo. Rỗng ⇒ `DEFAULT_THRESHOLDS`. */
  thresholds?: readonly number[] | undefined
  /** Email nhận cảnh báo. Rỗng ⇒ tạo ngân sách KHÔNG có thông báo (xem `buildNotificationsJson`). */
  emails?: readonly string[] | undefined
  /** Ngân sách đã tồn tại ⇒ `update-budget`; chưa ⇒ `create-budget`. */
  update: boolean
  approvalTicket?: string | undefined
}

/**
 * JSON `--budget` của API. `BudgetLimit.Unit` là `USD` cố định: mọi con số trên màn Chi
 * phí đều là USD, và trộn đơn vị ở đây sẽ làm hạn mức không so được với bảng bên cạnh.
 */
export function buildBudgetJson(name: string, limitUsd: number, timeUnit = 'MONTHLY'): string {
  return JSON.stringify({
    BudgetName: name,
    BudgetType: 'COST',
    TimeUnit: timeUnit,
    BudgetLimit: { Amount: limitUsd.toFixed(2), Unit: 'USD' },
  })
}

/**
 * JSON `--notifications-with-subscribers`.
 *
 * KHÔNG CÓ EMAIL THÌ KHÔNG CÓ THÔNG BÁO — và đó là một ngân sách vẫn có ích: nó vẫn
 * hiện hạn mức và mức đã tiêu ở màn này. Bịa ra một địa chỉ để "cho đủ tham số" là gửi
 * cảnh báo tiền của người dùng tới một nơi họ không chọn.
 *
 * `ACTUAL` chứ không `FORECASTED`: dự báo của Budgets nhảy mạnh ở đầu kỳ và sinh cảnh
 * báo giả. Người muốn cảnh báo sớm thì đặt ngưỡng thấp hơn.
 */
export function buildNotificationsJson(
  thresholds: readonly number[],
  emails: readonly string[],
): string | null {
  if (emails.length === 0 || thresholds.length === 0) return null
  return JSON.stringify(
    thresholds.map((t) => ({
      Notification: {
        NotificationType: 'ACTUAL',
        ComparisonOperator: 'GREATER_THAN',
        Threshold: t,
        ThresholdType: 'PERCENTAGE',
      },
      Subscribers: emails.map((address) => ({ SubscriptionType: 'EMAIL', Address: address })),
    })),
  )
}

/**
 * Tạo hoặc sửa một ngân sách. Đi qua `runGated` ⇒ trả về cả nhánh "bị chặn, cần duyệt".
 *
 * `update-budget` KHÔNG nhận `--notifications-with-subscribers`: API tách thông báo ra
 * lệnh riêng (`create-notification`). Nên lượt sửa chỉ đổi HẠN MỨC, và UI phải nói điều
 * đó — im lặng bỏ qua ngưỡng người dùng vừa gõ là tệ hơn không cho gõ.
 */
export async function saveBudget(input: BudgetSaveInput): Promise<BudgetOutcome<InfraGatedResult>> {
  if (!input.accountId) return { ok: false, error: 'NO_ACCOUNT_ID' }
  if (!isValidBudgetName(input.name)) return { ok: false, error: 'BAD_BUDGET_NAME' }
  if (!(input.limitUsd > 0)) return { ok: false, error: 'BAD_BUDGET_LIMIT' }

  const budget = buildBudgetJson(input.name, input.limitUsd)
  const args: string[] = input.update
    ? ['budgets', 'update-budget', '--account-id', input.accountId, '--new-budget', budget]
    : ['budgets', 'create-budget', '--account-id', input.accountId, '--budget', budget]

  if (!input.update) {
    const notifications = buildNotificationsJson(
      input.thresholds ?? DEFAULT_THRESHOLDS,
      input.emails ?? [],
    )
    if (notifications !== null) args.push('--notifications-with-subscribers', notifications)
  }

  const res = await runGated({
    tool: 'aws',
    args,
    context: {
      ...(input.profile ? { profile: input.profile } : {}),
      region: 'us-east-1',
      accountId: input.accountId,
    },
    surface: input.surface,
    toolName: 'budget_save',
    ...(input.actor !== undefined ? { actor: input.actor } : {}),
    ...(input.approvalTicket !== undefined ? { approvalTicket: input.approvalTicket } : {}),
    timeoutMs: TIMEOUT_MS,
  })
  return { ok: true, value: res }
}
