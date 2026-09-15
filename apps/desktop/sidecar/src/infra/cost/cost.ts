// Màn Chi phí (Mốc 7, việc 7.1): tháng này · dự báo cuối tháng · so kỳ trước · top tăng.
//
// ⚠ `ce` TÍNH TIỀN THEO LỜI GỌI — $0.01 mỗi request, không phải mỗi GB. Ba hàng rào,
// cùng hình dạng với `aws/metrics.ts` vì cùng một loại nguy hiểm:
//   1. MỘT LƯỢT = BA LỜI GỌI, KHÔNG HƠN. Tháng này theo dịch vụ · tháng trước theo dịch
//      vụ · dự báo. Muốn thêm chiều nào thì phải thêm ở đây, nơi đếm được.
//   2. CACHE THEO NGÀY. `ce` gộp dữ liệu theo NGÀY, nên trong cùng một ngày lịch (UTC)
//      câu trả lời không đổi — TTL theo giờ là trả tiền lại cho cùng một con số. Khoá
//      cache vì thế mang `YYYY-MM-DD`, và sang ngày mới nó tự trượt.
//   3. KHÔNG TỰ CHẠY. Không `onMounted`, không hẹn giờ. `force` chỉ đến từ nút "Nạp lại".
//
// GỌI `runInfra` THẲNG, KHÔNG QUA `runGated`. Cùng lý do đã ghi ở `aws/metrics.ts`:
// `ce` không nằm trong allowlist `read` (nó tốn tiền) nên lớp của nó rơi về `write` —
// chiều AN TOÀN, và ta giữ nguyên. Bề mặt này là bề mặt của CON NGƯỜI: `decision` đã là
// kết quả của một cú bấm, và `cost.estimatedUsd` đi vào nhật ký để câu "lần đó tốn bao
// nhiêu" trả lời được.
//
// GHIM `us-east-1`. Cost Explorer là dịch vụ TOÀN CỤC: endpoint của nó ở `us-east-1` và
// số liệu trả về là của cả tài khoản, không phải của một vùng. Để `--region` trôi theo
// ngữ cảnh người dùng là mời một lỗi endpoint ở mọi vùng khác, mà không đổi lấy gì —
// cùng lý do mẫu "Chi phí" của bảng điều khiển ghim `us-east-1` cho `AWS/Billing`.
import { z } from 'zod'
import { runInfra } from '../run.js'
import { lowerFirstKeys } from '../aws/metrics.js'
import type { InfraSurface } from '../audit/store.js'

/** Endpoint của Cost Explorer. Xem đầu file — đây không phải vùng của người dùng. */
const CE_REGION = 'us-east-1'

/** $0.01 mỗi request `ce`, giá công bố của AWS. Đi vào nhật ký cho từng lời gọi. */
export const CE_USD_PER_REQUEST = 0.01

/** Ba lời gọi mỗi lượt nạp — xem hàng rào 1. */
export const CE_CALLS_PER_LOAD = 3

const QUERY_TIMEOUT_MS = 60_000

/** Bao nhiêu dịch vụ hiện ở bảng "tốn nhất" / "tăng nhiều nhất". */
const TOP_N = 8

/** Dưới ngưỡng này thì một khoản không đáng gọi là "tăng" — nó là nhiễu làm tròn. */
const MIN_DELTA_USD = 0.5

export type CostOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

/** Một dịch vụ trong kỳ. `previousUsd` là cùng dịch vụ đó ở kỳ trước (0 nếu chưa có). */
export type CostService = {
  service: string
  amountUsd: number
  previousUsd: number
  /** `amountUsd - previousUsd`. Dương = tăng. */
  deltaUsd: number
}

export type CostSummary = {
  /** Kỳ đang xem, dạng `YYYY-MM-DD` (đầu tháng → hôm nay, theo UTC). */
  periodStart: string
  periodEnd: string
  previousStart: string
  previousEnd: string
  /** Tổng đã phát sinh trong kỳ. */
  totalUsd: number
  previousTotalUsd: number
  /**
   * Dự báo tới hết tháng, do AWS tính (`ce get-cost-forecast`) — KHÔNG phải phép nội
   * suy của AWOG. `null` khi AWS từ chối dự báo: nó cần đủ lịch sử, và một tài khoản
   * mới mở thì không có. Tự chia trung bình ngày rồi nhân lên ở đây là bịa ra một con
   * số mang dáng dấp dự báo của AWS.
   */
  forecastUsd: number | null
  /** Vì sao không có dự báo — hiện thẳng cho người dùng thay vì để ô trống. */
  forecastError: string | null
  /** Mọi dịch vụ có phát sinh, đã sắp theo tiền giảm dần. */
  services: CostService[]
  /** Tăng nhiều nhất so với kỳ trước, đã lọc nhiễu và sắp giảm dần. */
  topIncreases: CostService[]
  /** Số lời gọi `ce` đã spawn (0 = lấy từ cache). */
  calls: number
  estimatedUsd: number
  /** Ngày UTC của bản cache đang trả về. */
  asOf: string
}

// ─── Bóc JSON ────────────────────────────────────────────────────────────────

const Amount = z.object({ amount: z.string(), unit: z.string().optional() })

const Group = z.object({
  keys: z.array(z.string()),
  metrics: z.record(z.string(), Amount),
})

const ResultByTime = z.object({
  timePeriod: z.object({ start: z.string(), end: z.string() }),
  total: z.record(z.string(), Amount).optional(),
  groups: z.array(Group).optional(),
})

const CostAndUsage = z.object({ resultsByTime: z.array(ResultByTime) })

const Forecast = z.object({ total: Amount })

function num(s: string): number {
  const v = Number.parseFloat(s)
  return Number.isFinite(v) ? v : 0
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * Gộp mọi khoảng thời gian trả về thành một bảng `dịch vụ → tiền`.
 *
 * `ce` trả theo `Groups` khi có `--group-by`, và một dịch vụ xuất hiện ở NHIỀU khoảng
 * khi granularity là DAILY — nên phải cộng dồn chứ không ghi đè. Ta xin MONTHLY nên
 * thường chỉ có một khoảng, nhưng kỳ vắt qua ranh giới tháng thì có hai.
 */
function foldByService(raw: unknown, metric: string): CostOutcome<Map<string, number>> {
  let parsedJson: unknown
  try {
    parsedJson = lowerFirstKeys(JSON.parse(String(raw)))
  } catch {
    return { ok: false, error: 'BAD_OUTPUT' }
  }
  const parsed = CostAndUsage.safeParse(parsedJson)
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }

  const out = new Map<string, number>()
  for (const slice of parsed.data.resultsByTime) {
    for (const g of slice.groups ?? []) {
      const name = g.keys[0] ?? 'unknown'
      const amount = g.metrics[metric]
      if (!amount) continue
      out.set(name, (out.get(name) ?? 0) + num(amount.amount))
    }
  }
  return { ok: true, value: out }
}

// ─── Khoảng thời gian ────────────────────────────────────────────────────────

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Kỳ này (đầu tháng → hôm nay) và kỳ trước (cả tháng trước), theo UTC.
 *
 * `ce` dùng khoảng NỬA MỞ `[start, end)`, nên `end` của kỳ này là NGÀY MAI: lấy hôm nay
 * làm `end` thì chi phí của chính hôm nay bị bỏ ra ngoài, và người dùng thấy một con số
 * thấp hơn hoá đơn mà không hiểu vì sao.
 */
export function costPeriods(now: Date): {
  start: string
  end: string
  prevStart: string
  prevEnd: string
} {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  return {
    start: iso(new Date(Date.UTC(y, m, 1))),
    end: iso(new Date(Date.UTC(y, m, now.getUTCDate() + 1))),
    prevStart: iso(new Date(Date.UTC(y, m - 1, 1))),
    prevEnd: iso(new Date(Date.UTC(y, m, 1))),
  }
}

// ─── Cache theo ngày ─────────────────────────────────────────────────────────

type CacheEntry = { day: string; value: CostSummary }
const cache = new Map<string, CacheEntry>()

function cacheKey(profile: string | undefined, metric: string): string {
  return `${profile ?? ''}::${metric}`
}

/** Chỉ để test dọn giữa hai ca. */
export function clearCostCache(): void {
  cache.clear()
}

// ─── Lời gọi ─────────────────────────────────────────────────────────────────

type CeInput = {
  profile?: string | undefined
  surface: InfraSurface
  actor?: string | undefined
  /**
   * `UnblendedCost` (mặc định) là thứ khớp hoá đơn nhất cho một tài khoản đơn.
   * `AmortizedCost` trải đều phí trả trước của Savings Plan/RI.
   */
  metric?: 'UnblendedCost' | 'AmortizedCost' | undefined
  force?: boolean | undefined
}

function cliError(run: { stderr: string; exitCode: number | null }): string {
  const detail = run.stderr.trim() || `aws exited with code ${String(run.exitCode)}`
  return detail.slice(0, 600)
}

async function runCe(
  args: readonly string[],
  input: CeInput,
  toolName: string,
): Promise<CostOutcome<string>> {
  const run = await runInfra({
    tool: 'aws',
    args,
    context: {
      ...(input.profile ? { profile: input.profile } : {}),
      // Ghim, không trôi theo ngữ cảnh — xem đầu file.
      region: CE_REGION,
    },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName,
    decision: 'approved',
    timeoutMs: QUERY_TIMEOUT_MS,
    cost: { estimatedUsd: CE_USD_PER_REQUEST },
  })
  if (!run.ok) return { ok: false, error: cliError(run) }
  return { ok: true, value: run.stdout }
}

function costAndUsageArgs(start: string, end: string, metric: string): string[] {
  return [
    'ce',
    'get-cost-and-usage',
    '--output',
    'json',
    '--time-period',
    `Start=${start},End=${end}`,
    '--granularity',
    'MONTHLY',
    '--metrics',
    metric,
    '--group-by',
    'Type=DIMENSION,Key=SERVICE',
  ]
}

/**
 * Nạp toàn bộ màn Chi phí.
 *
 * Dự báo được gọi CUỐI và lỗi của nó KHÔNG làm hỏng cả lượt: một tài khoản mới mở
 * không đủ lịch sử để AWS dự báo, mà hai bảng kia thì vẫn đúng và vẫn đáng xem. Trả về
 * `forecastError` để UI nói ra, thay vì hiện một ô trống không giải thích.
 */
export async function getCostSummary(input: CeInput): Promise<CostOutcome<CostSummary>> {
  const metric = input.metric ?? 'UnblendedCost'
  const now = new Date()
  const today = iso(now)
  const key = cacheKey(input.profile, metric)

  if (input.force !== true) {
    const hit = cache.get(key)
    if (hit && hit.day === today) {
      return { ok: true, value: { ...hit.value, calls: 0, estimatedUsd: 0 } }
    }
  }

  const p = costPeriods(now)

  const cur = await runCe(costAndUsageArgs(p.start, p.end, metric), input, 'cost_summary')
  if (!cur.ok) return cur
  const curFold = foldByService(cur.value, metric)
  if (!curFold.ok) return curFold

  const prev = await runCe(costAndUsageArgs(p.prevStart, p.prevEnd, metric), input, 'cost_summary')
  if (!prev.ok) return prev
  const prevFold = foldByService(prev.value, metric)
  if (!prevFold.ok) return prevFold

  const services: CostService[] = [...curFold.value.entries()]
    .map(([service, amountUsd]) => {
      const previousUsd = prevFold.value.get(service) ?? 0
      return {
        service,
        amountUsd: round2(amountUsd),
        previousUsd: round2(previousUsd),
        deltaUsd: round2(amountUsd - previousUsd),
      }
    })
    .filter((s) => s.amountUsd > 0 || s.previousUsd > 0)
    .sort((a, b) => b.amountUsd - a.amountUsd)

  const totalUsd = round2([...curFold.value.values()].reduce((n, v) => n + v, 0))
  const previousTotalUsd = round2([...prevFold.value.values()].reduce((n, v) => n + v, 0))

  const topIncreases = services
    .filter((s) => s.deltaUsd >= MIN_DELTA_USD)
    .sort((a, b) => b.deltaUsd - a.deltaUsd)
    .slice(0, TOP_N)

  // Dự báo: khoảng phải là TƯƠNG LAI. `ce` từ chối một khoảng đã qua, nên `Start` là
  // ngày mai (`p.end` — xem `costPeriods`) chứ không phải đầu tháng.
  const monthEnd = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)))
  let forecastUsd: number | null = null
  let forecastError: string | null = null
  if (p.end < monthEnd) {
    const fc = await runCe(
      [
        'ce',
        'get-cost-forecast',
        '--output',
        'json',
        '--time-period',
        `Start=${p.end},End=${monthEnd}`,
        '--granularity',
        'MONTHLY',
        '--metric',
        metric === 'AmortizedCost' ? 'AMORTIZED_COST' : 'UNBLENDED_COST',
      ],
      input,
      'cost_forecast',
    )
    if (!fc.ok) {
      forecastError = fc.error
    } else {
      try {
        const parsed = Forecast.safeParse(lowerFirstKeys(JSON.parse(fc.value)))
        // Dự báo của AWS là phần CÒN LẠI của tháng ⇒ cộng phần đã phát sinh mới ra
        // "cuối tháng sẽ là bao nhiêu", đúng câu mà nhãn trên UI hứa.
        if (parsed.success) forecastUsd = round2(totalUsd + num(parsed.data.total.amount))
        else forecastError = 'BAD_OUTPUT'
      } catch {
        forecastError = 'BAD_OUTPUT'
      }
    }
  }

  const value: CostSummary = {
    periodStart: p.start,
    periodEnd: p.end,
    previousStart: p.prevStart,
    previousEnd: p.prevEnd,
    totalUsd,
    previousTotalUsd,
    forecastUsd,
    forecastError,
    services: services.slice(0, TOP_N),
    topIncreases,
    calls: forecastError === null && forecastUsd === null ? 2 : CE_CALLS_PER_LOAD,
    estimatedUsd: 0,
    asOf: today,
  }
  value.estimatedUsd = round2(value.calls * CE_USD_PER_REQUEST)

  cache.set(key, { day: today, value })
  return { ok: true, value }
}
