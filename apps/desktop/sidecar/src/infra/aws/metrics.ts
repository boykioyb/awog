// CloudWatch metrics — Mốc 6 (6.1 · 6.2).
//
// VÌ SAO FILE NÀY TỒN TẠI. `infra-monitoring-reports.md` §"Bảo mật & chi phí" đặt
// đúng một luật cứng cho số liệu: `get-metric-data` TÍNH TIỀN THEO SỐ METRIC × SỐ
// ĐIỂM, nên phải "nạp theo lô, cache, KHÔNG tự làm mới". Ba tính chất đó là ba
// quyết định trong file này, không phải ba lời khuyên:
//
//   1. THEO LÔ. Một lời gọi `get-metric-data` mang được nhiều metric qua
//      `--metric-data-queries` (một mảng JSON của các MetricDataQuery). Gọi N lần
//      cho N metric cùng trả về cùng số điểm nhưng N lần tính tiền API, nên mọi
//      đường vào đi qua `getMetricData()` và bị CHIA LÔ ở đây — call site không có
//      cách nào gọi lẻ từng metric.
//   2. CACHE. Lớp đệm theo (profile, region, cửa sổ, metric query). Cache ở tầng
//      SERIES chứ không phải tầng lời gọi, nên thêm một metric vào biểu đồ không
//      làm mất phần đã nạp của ba metric kia.
//   3. KHÔNG TỰ LÀM MỚI. Không hàm nào ở đây tự chạy theo nhịp. `force: true` chỉ
//      có nghĩa khi NGƯỜI DÙNG bấm "Nạp lại" (nút đó xoá cache cho đúng cửa sổ
//      đang xem rồi nạp lại). Một `watch` tự gọi `force` là vượt mặt chính luật này.
//
// Trần cứng: KHÔNG giá trị secret nào rời sidecar. `get-metric-data` chỉ trả số;
// credential do tiến trình con tự resolve từ `~/.aws` theo tên profile, y như
// `logs.ts`.
//
// ⚠ Cửa sổ thời gian dùng lại `checkWindow()` của `logs.ts`: đó là CÙNG một tri
// thức về CloudWatch (một cửa sổ nằm trong quá khứ, không dài quá 30 ngày), nên
// bản sao thứ hai ở đây sẽ là chỗ để hai màn lệch nhau.

import { z } from 'zod'
import { runInfra } from '../run.js'
import { checkWindow, flagValue } from './logs.js'
import type { InfraSurface } from '../audit/store.js'

// ─── Trần ───────────────────────────────────────────────────────────────────

/** Số metric TỐI ĐA của một lượt RPC. Màn Giám sát cần 4 biểu đồ; trần này rộng
 *  gấp nhiều lần nhu cầu thật nhưng vẫn chặn một payload IPC bịa ra 5000 metric. */
export const MAX_SERIES_PER_REQUEST = 24

/**
 * Số metric trong MỘT lời gọi CLI.
 *
 * `get-metric-data` cho tới 500 metric một request, nhưng mảng JSON đi vào argv
 * của tiến trình con, mà argv có trần của hệ điều hành (ARG_MAX, trên macOS
 * ~1 MB trừ env). Một MetricDataQuery có dimensions đầy đủ chiếm vài trăm byte,
 * nên 12 là mức an toàn rộng rãi mà vẫn giữ số lời gọi CLI thấp (24 metric ⇒ 2
 * lời gọi thay vì 24).
 */
export const MAX_METRICS_PER_CALL = 12

/** Số entry giữ trong cache. Mỗi entry là một series đã bóc; 64 đủ cho nhiều
 *  cửa sổ × nhiều biểu đồ mà vẫn chặn rò bộ nhớ của một phiên dài. */
const CACHE_MAX_ENTRIES = 64

/**
 * TTL của cache. Chọn 10 phút vì nó NGẮN HƠN nhịp mà một cửa sổ "1 giờ" đổi
 * nghĩa (mỗi phút trôi đi là một điểm mới ở đuôi), mà vẫn đủ dài để người dùng
 * đổi tab qua lại / mở lại màn không phải trả tiền lần hai. Hết TTL ⇒ lần gọi
 * kế tiếp đi CLI lại; KHÔNG có hẹn giờ nào tự nạp.
 */
const CACHE_TTL_MS = 10 * 60_000

const QUERY_TIMEOUT_MS = 60_000

// ─── Kiểu công khai ─────────────────────────────────────────────────────────

export type MetricDimension = { name: string; value: string }

/** Một metric cần vẽ. `key` do NGƯỜI GỌI đặt để ghép series trả về với biểu đồ
 *  của nó — AWS yêu cầu `Id` riêng nên khoá của ta không đi thẳng vào argv. */
export type MetricQuery = {
  key: string
  namespace: string
  metricName: string
  dimensions?: readonly MetricDimension[] | undefined
  /** `Average` · `Sum` · `p95` … Xem `isValidStat`. */
  stat: string
  periodSeconds: number
  unit?: string | undefined
  /** Nhãn hiện ở cuối đường. Không có thì UI tự đặt theo vị trí. */
  label?: string | undefined
}

export type MetricPoint = { t: number; v: number }

export type MetricSeries = {
  key: string
  label: string
  stat: string
  periodSeconds: number
  points: MetricPoint[]
}

export type MetricsOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

export type GetMetricDataInput = {
  queries: readonly MetricQuery[]
  startMs: number
  endMs: number
  profile?: string | undefined
  region?: string | undefined
  surface: InfraSurface
  /** Ai bảo chạy — `human` (màn Giám sát) hay `agent:<tên>`. */
  actor?: string | undefined
  /** Bỏ qua cache. CHỈ dùng cho cú bấm "Nạp lại" của người dùng. */
  force?: boolean | undefined
}

export type GetMetricDataValue = {
  series: MetricSeries[]
  /** Bao nhiêu series đến từ cache — UI/log nói được "lần này không tốn tiền". */
  fromCache: number
  /** Bao nhiêu lời gọi CLI đã thật sự spawn. */
  calls: number
}

// ─── Hình dạng JSON của CLI ─────────────────────────────────────────────────

/**
 * Hạ chữ đầu của MỌI khoá trong một cây JSON, đệ quy.
 *
 * VÌ SAO CẦN. Hai họ CloudWatch không nói cùng một thứ tiếng trên dây:
 *   · **CloudWatch Logs** là service giao thức `json` — tên trường trong model đã
 *     là `logGroupName`, nên `logs.ts` đọc đúng chữ đó.
 *   · **CloudWatch (metrics)** là giao thức `query` — member name của service model
 *     viết HOA CHỮ ĐẦU (`MetricDataResults`, `Timestamps`, `AlarmName`), và CLI in
 *     nguyên dạng đó ra `--output json`.
 * Chuẩn hoá MỘT LẦN ở biên (đây là dữ liệu L1 của tiến trình con) rồi để mọi
 * schema zod đọc một kiểu chữ duy nhất. Không làm vậy thì mỗi schema phải khai
 * hai lần, và một lần AWS đổi kiểu là màn Giám sát trắng trơn với `BAD_OUTPUT`
 * không nói được gì. Hàm này là no-op với khoá đã ở dạng thường.
 */
export function lowerFirstKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(lowerFirstKeys)
  if (typeof v !== 'object' || v === null) return v
  const out: Record<string, unknown> = {}
  for (const [k, value] of Object.entries(v)) {
    out[k.charAt(0).toLowerCase() + k.slice(1)] = lowerFirstKeys(value)
  }
  return out
}

const MetricDataResponse = z.object({
  metricDataResults: z
    .array(
      z.object({
        id: z.string().max(255),
        label: z.string().max(1024).optional(),
        // Điểm thiếu của CloudWatch serialise thành `null`, không bị bỏ khỏi mảng
        // — nên phải nhận `null` rồi lọc, không được đòi `number` thuần.
        timestamps: z.array(z.string().max(64)).default([]),
        values: z.array(z.number().nullable()).default([]),
        statusCode: z.string().max(64).optional(),
      }),
    )
    .default([]),
  messages: z
    .array(z.object({ code: z.string().max(128).optional(), value: z.string().max(2048).optional() }))
    .default([]),
})

// ─── Kiểm tra đầu vào (thuần, test bằng bảng) ───────────────────────────────

const NAMESPACE_RE = /^[A-Za-z0-9/_.-]{1,255}$/
const METRIC_NAME_RE = /^[A-Za-z0-9/_.:%-]{1,255}$/
const DIMENSION_NAME_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,254}$/
/** Giá trị dimension là tên tài nguyên của AWS: ARN, `/app/name/id`, `my-fn`.
 *  Khoảng trắng hợp lệ; ký tự điều khiển thì không bao giờ. */
const DIMENSION_VALUE_RE = /^[^\u0000-\u001f\u007f]{1,1024}$/
const QUERY_KEY_RE = /^[A-Za-z0-9._:-]{1,64}$/
const STAT_RE = /^(SampleCount|Average|Sum|Minimum|Maximum|IQM|p\d{1,2}(\.\d{1,2})?)$/
const UNIT_RE = /^[A-Za-z]{1,32}$/

/**
 * Chu kỳ hợp lệ. CloudWatch chỉ nhận 1/5/10/30 giây hoặc bội của 60 — gửi một
 * chu kỳ lạ KHÔNG hỏng cả lời gọi mà chỉ trả về rỗng, tức biểu đồ trắng trơn
 * không kèm lời giải thích. Chặn ở biên để UI nhận được câu trả lời nói thật.
 */
export function isValidPeriod(seconds: number): boolean {
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > 86_400) return false
  if (seconds < 60) return seconds === 1 || seconds === 5 || seconds === 10 || seconds === 30
  return seconds % 60 === 0
}

export function isValidStat(stat: string): boolean {
  return STAT_RE.test(stat)
}

export function isValidMetricName(name: string): boolean {
  return METRIC_NAME_RE.test(name)
}

export function isValidNamespace(ns: string): boolean {
  return NAMESPACE_RE.test(ns)
}

export function isValidDimension(d: MetricDimension): boolean {
  return DIMENSION_NAME_RE.test(d.name) && DIMENSION_VALUE_RE.test(d.value)
}

export function isValidQueryKey(key: string): boolean {
  return QUERY_KEY_RE.test(key)
}

/** Trả `null` khi hợp lệ, ngược lại là mã lỗi để UI dịch được. */
export function validateQuery(q: MetricQuery): string | null {
  if (!isValidQueryKey(q.key)) return 'BAD_QUERY_KEY'
  if (!isValidNamespace(q.namespace)) return 'BAD_NAMESPACE'
  if (!isValidMetricName(q.metricName)) return 'BAD_METRIC_NAME'
  if (!isValidStat(q.stat)) return 'BAD_STAT'
  if (!isValidPeriod(q.periodSeconds)) return 'BAD_PERIOD'
  if (q.unit !== undefined && !UNIT_RE.test(q.unit)) return 'BAD_UNIT'
  if (q.dimensions !== undefined && q.dimensions.length > 30) return 'TOO_MANY_DIMENSIONS'
  for (const d of q.dimensions ?? []) if (!isValidDimension(d)) return 'BAD_DIMENSION'
  return null
}

// ─── Dựng payload (thuần, test bằng bảng) ───────────────────────────────────

/**
 * Một `MetricDataQuery` của AWS. Tên trường viết HOA chữ đầu vì đó là hợp đồng
 * của API (CLI nhận đúng dạng này trong JSON), không phải quy ước của ta.
 */
export type AwsMetricDataQuery = {
  Id: string
  ReturnData: true
  Label?: string
  MetricStat: {
    Metric: { Namespace: string; MetricName: string; Dimensions?: { Name: string; Value: string }[] }
    Period: number
    Stat: string
    Unit?: string
  }
}

/**
 * Id của AWS: bắt đầu bằng chữ thường, chỉ chữ-số-gạch dưới, ngắn. Đánh theo VỊ
 * TRÍ trong lô nên nó không phụ thuộc `key` do người gọi đặt — `key` có thể chứa
 * `.`/`:` mà AWS từ chối.
 */
export function awsQueryId(index: number): string {
  return `m${String(index)}`
}

export function buildMetricDataQueries(queries: readonly MetricQuery[]): AwsMetricDataQuery[] {
  return queries.map((q, i) => {
    const metric: AwsMetricDataQuery['MetricStat']['Metric'] = {
      Namespace: q.namespace,
      MetricName: q.metricName,
      ...(q.dimensions !== undefined && q.dimensions.length > 0
        ? { Dimensions: q.dimensions.map((d) => ({ Name: d.name, Value: d.value })) }
        : {}),
    }
    return {
      Id: awsQueryId(i),
      ReturnData: true as const,
      ...(q.label !== undefined ? { Label: q.label } : {}),
      MetricStat: {
        Metric: metric,
        Period: q.periodSeconds,
        Stat: q.stat,
        ...(q.unit !== undefined ? { Unit: q.unit } : {}),
      },
    }
  })
}

/** Chia lô giữ nguyên thứ tự. `size <= 0` bị kẹp về 1 thay vì ném — trần là hằng
 *  số của module, một lời gọi sai không đáng làm hỏng cả màn. */
export function chunkQueries<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size))
  const out: T[][] = []
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step))
  return out
}

// ─── Bóc kết quả (thuần) ────────────────────────────────────────────────────

/**
 * JSON của `get-metric-data` ⇒ series theo `key` của người gọi.
 *
 * `idToKey` là bảng dịch `m0`/`m1` ⇒ `key` của đúng lô đã gửi. Một `id` không có
 * trong bảng bị BỎ chứ không đoán: gán nó cho metric nào cũng là gán số của
 * metric khác lên biểu đồ.
 */
export function parseMetricData(
  stdout: string,
  idToKey: ReadonlyMap<string, string>,
): MetricsOutcome<MetricDataResult[]> {
  let raw: unknown
  try {
    raw = lowerFirstKeys(JSON.parse(stdout))
  } catch {
    return { ok: false, error: 'BAD_OUTPUT' }
  }
  const parsed = MetricDataResponse.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }

  const out: MetricDataResult[] = []
  for (const r of parsed.data.metricDataResults) {
    const key = idToKey.get(r.id)
    if (key === undefined) continue
    const points: MetricPoint[] = []
    const n = Math.min(r.timestamps.length, r.values.length)
    for (let i = 0; i < n; i++) {
      const v = r.values[i]
      if (v === null || v === undefined || !Number.isFinite(v)) continue
      const t = Date.parse(r.timestamps[i] ?? '')
      if (!Number.isFinite(t)) continue
      points.push({ t, v })
    }
    points.sort((a, b) => a.t - b.t)
    out.push({ key, label: r.label ?? '', points, full: r.statusCode !== 'PartialData' })
  }
  return { ok: true, value: out }
}

export type MetricDataResult = {
  key: string
  label: string
  points: MetricPoint[]
  /** `false` = AWS nói `PartialData` hoặc thiếu; UI phải nói ra chứ không vẽ im. */
  full: boolean
}

// ─── Cache ──────────────────────────────────────────────────────────────────

type CacheEntry = { at: number; series: MetricSeries }
const cache = new Map<string, CacheEntry>()

/**
 * Khoá cache: profile + region + cửa sổ + toàn bộ nội dung truy vấn. Cửa sổ nằm
 * TRONG khoá (không phải chỉ khoảng dài) vì hai cửa sổ khác nhau cho hai tập điểm
 * khác nhau — dùng chung cache cho chúng là vẽ số của khoảng này lên khoảng kia.
 */
export function metricCacheKey(
  scope: { profile: string; region: string },
  startEpoch: number,
  endEpoch: number,
  q: MetricQuery,
): string {
  const dims = (q.dimensions ?? []).map((d) => [d.name, d.value] as const)
  const sorted = [...dims].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]))
  return JSON.stringify([
    scope.profile,
    scope.region,
    startEpoch,
    endEpoch,
    q.namespace,
    q.metricName,
    sorted,
    q.stat,
    q.periodSeconds,
    q.unit ?? '',
  ])
}

/** Xoá sạch cache (đổi ngữ cảnh AWS, hoặc nút "Nạp lại"). */
export function clearMetricCache(): void {
  cache.clear()
}

export function metricCacheSize(): number {
  return cache.size
}

function pruneCache(now: number): void {
  for (const [k, v] of cache) if (now - v.at >= CACHE_TTL_MS) cache.delete(k)
  // Xoá theo thứ tự CHÈN (Map giữ thứ tự đó) — entry cũ nhất ra trước.
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done === true) break
    cache.delete(oldest.value)
  }
}

// ─── Nạp (đường duy nhất ra CLI) ────────────────────────────────────────────

/**
 * Nạp số liệu cho nhiều metric trong ÍT lời gọi nhất có thể.
 *
 * Luồng: cửa sổ + từng query được kiểm ở biên (một query hỏng làm hỏng cả lượt —
 * trả về biểu đồ vẽ thiếu metric mà không nói gì là nói dối về dữ liệu) → phần
 * đã có trong cache được lấy ra → phần còn thiếu chia lô → mỗi lô một lời gọi
 * `get-metric-data` → ghi cache → ghép lại ĐÚNG THỨ TỰ người gọi đưa vào.
 */
export async function getMetricData(
  input: GetMetricDataInput,
): Promise<MetricsOutcome<GetMetricDataValue>> {
  const { queries } = input
  if (queries.length === 0) return { ok: true, value: { series: [], fromCache: 0, calls: 0 } }
  if (queries.length > MAX_SERIES_PER_REQUEST) return { ok: false, error: 'TOO_MANY_SERIES' }

  const win = checkWindow(input.startMs, input.endMs)
  if (!win.ok) return { ok: false, error: win.error }

  for (const q of queries) {
    const bad = validateQuery(q)
    if (bad !== null) return { ok: false, error: bad }
  }

  const scope = { profile: input.profile ?? '', region: input.region ?? '' }
  const now = Date.now()
  const found = new Map<string, MetricSeries>()
  const missing: MetricQuery[] = []

  for (const q of queries) {
    const hit = input.force === true ? undefined : cache.get(metricCacheKey(scope, win.start, win.end, q))
    if (hit !== undefined && now - hit.at < CACHE_TTL_MS) found.set(q.key, hit.series)
    else missing.push(q)
  }

  let calls = 0
  for (const chunk of chunkQueries(missing, MAX_METRICS_PER_CALL)) {
    const outcome = await fetchChunk(chunk, win.start, win.end, input)
    if (!outcome.ok) return outcome
    calls += 1
    for (const series of outcome.value) found.set(series.key, series)
  }

  for (const q of missing) {
    const series = found.get(q.key)
    if (series === undefined) continue
    cache.set(metricCacheKey(scope, win.start, win.end, q), { at: now, series })
  }
  if (missing.length > 0) pruneCache(now)

  // Thứ tự trả về = thứ tự người gọi đưa vào, để UI không phải tự sắp lại.
  const series: MetricSeries[] = []
  for (const q of queries) {
    const hit = found.get(q.key)
    if (hit !== undefined) series.push(hit)
  }
  return { ok: true, value: { series, fromCache: queries.length - missing.length, calls } }
}

async function fetchChunk(
  chunk: readonly MetricQuery[],
  start: number,
  end: number,
  input: GetMetricDataInput,
): Promise<MetricsOutcome<MetricSeries[]>> {
  const payload = buildMetricDataQueries(chunk)
  const idToKey = new Map(chunk.map((q, i) => [awsQueryId(i), q.key] as const))

  // `get-metric-data` KHÔNG nằm trong allowlist `read` của `classify.ts` (nó tính
  // tiền theo metric × điểm), nên lớp của nó rơi về `write`. Đó là chiều AN TOÀN
  // và ta giữ nguyên: lời gọi này luôn đứng sau một cú bấm của người dùng, và ma
  // trận quyền không phải chỗ để một màn chỉ-đọc tự nới cho chính nó. `runInfra`
  // được gọi thẳng (không `runGated`) đúng như `logs.ts` làm với vòng Insights:
  // bề mặt CON NGƯỜI, `decision` đã là kết quả của cú bấm.
  const run = await runInfra({
    tool: 'aws',
    args: [
      'cloudwatch',
      'get-metric-data',
      '--output',
      'json',
      flagValue('--start-time', String(start)),
      flagValue('--end-time', String(end)),
      flagValue('--metric-data-queries', JSON.stringify(payload)),
    ],
    context: {
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.region ? { region: input.region } : {}),
    },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'metrics_query',
    decision: 'approved',
    timeoutMs: QUERY_TIMEOUT_MS,
  })
  if (!run.ok) return { ok: false, error: cliError(run) }

  const parsed = parseMetricData(run.stdout, idToKey)
  if (!parsed.ok) return parsed

  // Giữ ĐÚNG thứ tự lô, và giữ cả series rỗng: một metric chưa từng có điểm nào
  // là "thiếu dữ liệu" (một trạng thái có nghĩa), khác hẳn "metric không tồn tại".
  return {
    ok: true,
    value: chunk.map((q) => {
      const hit = parsed.value.find((r) => r.key === q.key)
      return {
        key: q.key,
        label: hit?.label || (q.label ?? q.metricName),
        stat: q.stat,
        periodSeconds: q.periodSeconds,
        points: hit?.points ?? [],
      }
    }),
  }
}

/** Thông điệp lỗi CLI đã redact, đã cắt — không bao giờ ném, vì "credential hỏng"
 *  là một kết quả hợp lệ mà UI phải hiện được. */
function cliError(run: { stderr: string; exitCode: number | null }): string {
  const detail = run.stderr.trim() || `aws exited with code ${String(run.exitCode)}`
  return detail.slice(0, 600)
}
