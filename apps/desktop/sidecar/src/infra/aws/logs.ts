// CloudWatch Logs + Logs Insights — Mốc 2 (2.1 · 2.2 · 2.5 · 2.6 · 2.7 · 2.9).
//
// VÌ SAO FILE NÀY TỒN TẠI. `infra.tasks.md` gọi CloudWatch Insights là ưu tiên 1
// của cả họ tính năng: người dùng muốn soi log hằng ngày mà không phải mở Console.
// Nhưng đây cũng là BỀ MẶT NGUY HIỂM NHẤT trong allowlist `read` — log ứng dụng là
// nơi credential/PII hay nằm nhất, và Insights TỐN TIỀN theo GB quét. Hai hệ quả
// đã thành luật cứng ở đây:
//
//   1. KHÔNG BAO GIỜ TỰ CHẠY. Không hàm nào ở đây được gọi từ `onMounted`/`watch`
//      hay "nền cho tiện" — mỗi lời gọi là một cú bấm của người dùng (2.6).
//   2. Ước lượng TRƯỚC, số ĐO được SAU. `estimateScan()` chạy trước khi hỏi
//      `start-query`, và `bytesScanned` thật của lần chạy trước cùng câu lệnh được
//      nhớ lại để lần sau ước lượng bằng SỐ ĐO chứ không bằng phỏng đoán.
//
// Mọi lời gọi CLI đi qua `runInfra()` (cổng duy nhất ra CLI). Hai lệnh `logs`
// KHÔNG nằm trong allowlist `read` của `classify.ts` — `start-query` (tốn tiền) và
// `stop-query` (đổi trạng thái tài nguyên) — nên chúng tự rơi về `write`; đó là
// chiều an toàn. Ba lệnh còn lại (`describe-log-groups`, `get-query-results`,
// `filter-log-events`) là `read`, và trên tài khoản production chúng bị
// `policy.decide()` siết lên `ask` cho ĐƯỜNG CỦA AGENT (xem `SENSITIVE_READ_OPS`
// trong `classify.ts`) vì kết quả của chúng là NỘI DUNG log.
//
// Trần cứng của cả file: KHÔNG giá trị secret nào rời sidecar. Không hàm nào ở
// đây chạm credential; tiến trình con tự resolve từ `~/.aws` theo tên profile.

import { z } from 'zod'
import { runInfra } from '../run.js'
import type { InfraSurface } from '../audit/store.js'

// ─── Trần ───────────────────────────────────────────────────────────────────

/** CloudWatch Logs Insights: $0.005/GB quét (mức công bố của AWS, us-east-1). */
export const INSIGHTS_USD_PER_GB = 0.005

/** Trần số log group mỗi lượt chọn. Một truy vấn Insights nhiều group là hợp lệ,
 *  nhưng `--log-group-names` có trần độ dài argv của hệ điều hành. */
export const MAX_LOG_GROUPS = 25

/** Trần số dòng kết quả mỗi lượt (Insights cho tối đa 10.000). */
export const MAX_ROWS = 1000

/** Trần byte kết quả giữ lại trong một lượt RPC. `runInfra` đã chặn 256 KiB; đây
 *  là hàng rào thứ hai, vì kết quả đi thẳng vào context model ở đường tool. */
export const MAX_RESULT_BYTES = 512 * 1024

/** Trần thời lượng một truy vấn Insights (CloudWatch tự huỷ sau 15 phút). */
const MAX_WINDOW_SECONDS = 30 * 24 * 60 * 60

/** Trần MỘT LƯỢT GỌI `describe-log-groups`. AWS chặn cứng ở 50:
 *  `InvalidParameterException … Member must have value less than or equal to 50`.
 *  Vì vậy trần TỔNG của app phải trải qua NHIỀU lượt, không phải một `--limit 500`. */
const GROUP_PAGE_LIMIT = 50
const DEFAULT_GROUP_LIMIT = GROUP_PAGE_LIMIT
/** Trần TỔNG số group một lượt `listLogGroups` trả về (= `MAX_GROUP_PAGES` × 50). */
const MAX_GROUP_LIMIT = 500
/** Trần số lượt gọi CLI cho một lần nạp danh sách — chặn vòng lặp vô hạn khi một
 *  trang trả về không có group nào mà vẫn còn `nextToken`. */
const MAX_GROUP_PAGES = MAX_GROUP_LIMIT / GROUP_PAGE_LIMIT
const DEFAULT_TAIL_LIMIT = 100
const MAX_TAIL_LIMIT = 1000
/** Trần MỘT LƯỢT `describe-log-streams`. AWS chặn cứng ở 50, giống describe-log-groups.
 *  Một trang (50 stream mới nhất) đủ cho một picker; không nối trang. */
const STREAM_LIMIT = 50
const MAX_QUERY_CHARS = 4096
const MAX_PATTERN_CHARS = 1024

const QUERY_TIMEOUT_MS = 60_000
/** `start-query` chỉ trả `queryId` nên nhanh; nhưng đi qua SSO có thể refresh. */
const START_TIMEOUT_MS = 45_000

/**
 * Tên log group của CloudWatch: chữ, số, `.`, `-`, `_`, `/`, `#`.
 * ⚠ KHÔNG dùng `SSH_ID_RE` hay regex tên profile — đây là không gian tên khác.
 */
const LOG_GROUP_RE = /^[A-Za-z0-9._/#-]{1,512}$/

/** `queryId` do AWS sinh: UUID chữ-số-gạch. */
const QUERY_ID_RE = /^[A-Za-z0-9-]{1,128}$/

// ─── Kiểu công khai ─────────────────────────────────────────────────────────

export type LogGroup = {
  name: string
  arn: string
  /** Byte đang lưu trên CloudWatch — cơ sở của ước lượng GB ở 2.6. */
  storedBytes: number
  retentionDays: number | null
  createdAt: number | null
}

export type LogGroupPage = {
  groups: LogGroup[]
  /** Còn trang sau ⇒ UI phải nói "còn nữa" chứ không cắt im lặng. */
  nextToken: string | null
}

/** Một log STREAM của một group (tầng giữa của CloudWatch: group → stream → event). */
export type LogStream = {
  name: string
  /** Thời điểm event gần nhất — cột sắp xếp (mới nhất trước). */
  lastEventAt: number | null
  storedBytes: number
}

/** Một dòng kết quả Insights: mỗi trường là một cặp `field`/`value` đã đổi sang
 *  chuỗi ngay ở sidecar, để UI không phải đoán kiểu. */
export type InsightsRow = Record<string, string>

export type InsightsStatus =
  | 'Scheduled'
  | 'Running'
  | 'Complete'
  | 'Failed'
  | 'Cancelled'
  | 'Timeout'
  | 'Unknown'

export type InsightsPoll = {
  status: InsightsStatus
  rows: InsightsRow[]
  /** Số byte THẬT đã quét — con số quyết định hoá đơn (2.6). */
  bytesScanned: number
  recordsMatched: number
  recordsScanned: number
  /** Có khi `status === 'Failed'`. */
  error?: string
}

export type ScanEstimate = {
  bytes: number
  usd: number
  /** `history` = số ĐO của lần chạy trước cùng câu lệnh; `stored` = tổng dung
   *  lượng đang lưu (trần trên, luôn ≥ số thật). */
  basis: 'history' | 'stored'
  /** Câu người dùng phải đọc trước khi bấm (đã dịch ở UI theo `basis`). */
  groupCount: number
}

export type LogsOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

// ─── Hình dạng JSON của CLI ─────────────────────────────────────────────────

const DescribeGroupsSchema = z.object({
  logGroups: z
    .array(
      z.object({
        logGroupName: z.string().max(512),
        arn: z.string().max(2048).optional(),
        storedBytes: z.number().nonnegative().optional(),
        retentionInDays: z.number().int().positive().optional(),
        creationTime: z.number().optional(),
      }),
    )
    .default([]),
  nextToken: z.string().max(8192).optional(),
})

const StartQuerySchema = z.object({ queryId: z.string().max(128) })

const GetQueryResultsSchema = z.object({
  status: z.string().max(32).optional(),
  results: z
    .array(z.array(z.object({ field: z.string(), value: z.string() })))
    .default([]),
  statistics: z
    .object({
      bytesScanned: z.number().nonnegative().optional(),
      recordsMatched: z.number().nonnegative().optional(),
      recordsScanned: z.number().nonnegative().optional(),
    })
    .optional(),
})

const FilterEventsSchema = z.object({
  events: z
    .array(
      z.object({
        logStreamName: z.string().max(512).optional(),
        timestamp: z.number().optional(),
        message: z.string().optional(),
        eventId: z.string().max(128).optional(),
      }),
    )
    .default([]),
  nextToken: z.string().max(8192).optional(),
  searchedLogStreams: z.array(z.unknown()).optional(),
})

const DescribeStreamsSchema = z.object({
  logStreams: z
    .array(
      z.object({
        logStreamName: z.string().max(512),
        lastEventTimestamp: z.number().optional(),
        storedBytes: z.number().nonnegative().optional(),
      }),
    )
    .default([]),
  nextToken: z.string().max(8192).optional(),
})

// ─── Kiểm tra đầu vào (thuần, test được bằng bảng) ──────────────────────────

export function isValidLogGroup(name: string): boolean {
  return LOG_GROUP_RE.test(name)
}

export function isValidQueryId(id: string): boolean {
  return QUERY_ID_RE.test(id)
}

/**
 * Tên log STREAM: không gian ký tự rộng hơn log group (chứa `[$LATEST]`, `/`, dấu
 * cách…). CloudWatch chỉ cấm `:` và `*`; ta cấm thêm ký tự điều khiển để không lọt
 * newline vào argv. Kiểm bằng vòng lặp thay vì regex control-char (tránh lint
 * `no-control-regex`).
 */
export function isValidLogStream(name: string): boolean {
  if (name.length < 1 || name.length > 512) return false
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || ch === ':' || ch === '*') return false
  }
  return true
}

/**
 * Câu lệnh Insights có bị coi là "có thể tốn tiền" không. Dùng để UI đổi nhãn nút
 * và để nhật ký ghi đúng lý do; mọi câu đều tốn tiền, nên hàm này trả `true` cho
 * mọi chuỗi không rỗng — nó tồn tại để KHÔNG AI thêm nhánh "câu này miễn phí".
 */
export function queryIsBillable(query: string): boolean {
  return query.trim().length > 0
}

/**
 * `filter-pattern` là chuỗi tự do, có thể bắt đầu bằng `-` (vd `-"INFO"`). Truyền
 * nó như MỘT token `--filter-pattern=<giá trị>` để argparse không bao giờ đọc nó
 * thành cờ. Cùng lý do với `--query-string=` và `--log-group-names=`.
 */
export function flagValue(flag: string, value: string): string {
  return `${flag}=${value}`
}

/** Giá trị epoch giây từ mili-giây, đã kẹp vào trần cửa sổ của CloudWatch. */
export function toEpochSeconds(ms: number): number {
  return Math.floor(ms / 1000)
}

export type WindowCheck = { ok: true; start: number; end: number } | { ok: false; error: string }

/** Cửa sổ thời gian phải nằm trong quá khứ và không dài quá trần. */
export function checkWindow(startMs: number, endMs: number, now = Date.now()): WindowCheck {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { ok: false, error: 'INVALID_WINDOW' }
  }
  if (endMs <= startMs) return { ok: false, error: 'INVALID_WINDOW' }
  if (endMs - startMs > MAX_WINDOW_SECONDS * 1000) return { ok: false, error: 'WINDOW_TOO_LONG' }
  // Cho phép lệch đồng hồ 5 phút, nhưng không cho cửa sổ nằm hẳn ở tương lai.
  if (startMs > now + 5 * 60_000) return { ok: false, error: 'WINDOW_IN_FUTURE' }
  return { ok: true, start: toEpochSeconds(startMs), end: toEpochSeconds(endMs) }
}

export function checkLogGroups(names: readonly string[]): { ok: true } | { ok: false; error: string } {
  if (names.length === 0) return { ok: false, error: 'NO_LOG_GROUP' }
  if (names.length > MAX_LOG_GROUPS) return { ok: false, error: 'TOO_MANY_LOG_GROUPS' }
  for (const n of names) if (!isValidLogGroup(n)) return { ok: false, error: 'INVALID_LOG_GROUP' }
  return { ok: true }
}

export function checkQueryString(query: string): { ok: true } | { ok: false; error: string } {
  const trimmed = query.trim()
  if (trimmed.length === 0) return { ok: false, error: 'EMPTY_QUERY' }
  if (trimmed.length > MAX_QUERY_CHARS) return { ok: false, error: 'QUERY_TOO_LONG' }
  // `file://` biến tham số thành đường đọc file tuỳ ý (invariant #1/#2). Câu lệnh
  // Insights không bao giờ cần nó, và `classify()` cũng đã nâng lớp khi thấy —
  // chặn thêm ở đây để không có đường nào lọt qua dưới dạng "chỉ là câu query".
  if (/fileb?:\/\//i.test(trimmed)) return { ok: false, error: 'QUERY_NOT_ALLOWED' }
  return { ok: true }
}

// ─── Đọc: log group ─────────────────────────────────────────────────────────

export type ListLogGroupsInput = {
  profile?: string | undefined
  region?: string | undefined
  surface: InfraSurface
  /** Ai bảo chạy — `human` (màn Logs) hay `agent:<tên>` (tool `logs_query`). */
  actor?: string | undefined
  /** Lọc phía AWS (`--log-group-name-prefix`) — rẻ và không tốn thêm lượt gọi. */
  prefix?: string | undefined
  /** Lọc phía AWOG (chuỗi con, không phân biệt hoa thường) trên tên trả về. */
  pattern?: string | undefined
  limit?: number | undefined
  nextToken?: string | undefined
}

/** Một group thô của CLI (`describe-log-groups` trả về), trước khi đổi tên trường. */
type RawLogGroup = z.infer<typeof DescribeGroupsSchema>['logGroups'][number]

/**
 * MỘT lượt gọi `describe-log-groups` với `--limit` ≤ 50. Không export: bên ngoài
 * chỉ nên thấy `listLogGroups` đã nối đủ trang, vì gọi thẳng một trang là cách
 * sinh ra chính lỗi `--limit` > 50 mà hàm này tồn tại để chặn.
 */
async function describeGroupPage(
  input: Omit<ListLogGroupsInput, 'limit' | 'nextToken'> & {
    /** Số group của RIÊNG trang này — luôn ≤ `GROUP_PAGE_LIMIT`. */
    limit: number
    nextToken: string | null
  },
): Promise<LogsOutcome<{ groups: RawLogGroup[]; nextToken: string | null }>> {
  const args = [
    'logs',
    'describe-log-groups',
    '--output',
    'json',
    flagValue('--limit', String(input.limit)),
  ]
  if (input.prefix) args.push(flagValue('--log-group-name-prefix', input.prefix))
  if (input.nextToken) args.push(flagValue('--next-token', input.nextToken))

  const run = await runInfra({
    tool: 'aws',
    args,
    context: { ...(input.profile ? { profile: input.profile } : {}), ...(input.region ? { region: input.region } : {}) },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'logs_groups',
    decision: 'approved',
    timeoutMs: QUERY_TIMEOUT_MS,
  })
  if (!run.ok) return { ok: false, error: cliError(run) }

  const parsed = DescribeGroupsSchema.safeParse(parseJson(run.stdout))
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }

  return {
    ok: true,
    value: { groups: parsed.data.logGroups, nextToken: parsed.data.nextToken ?? null },
  }
}

export async function listLogGroups(input: ListLogGroupsInput): Promise<LogsOutcome<LogGroupPage>> {
  if (input.prefix && !LOG_GROUP_RE.test(input.prefix)) {
    return { ok: false, error: 'INVALID_LOG_GROUP' }
  }
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_GROUP_LIMIT, 1), MAX_GROUP_LIMIT)

  // `limit` là TỔNG số group muốn có, nhưng AWS chỉ cho 50 mỗi lượt — nên nó được
  // trải qua nhiều trang. Dừng khi: đủ `limit`, hết `nextToken`, hoặc chạm trần
  // số lượt gọi. Lỗi giữa chừng hỏng CẢ lời gọi: trả về một danh sách cụt mà
  // không nói gì sẽ khiến người dùng tưởng tài khoản chỉ có chừng ấy log group.
  const raw: RawLogGroup[] = []
  let nextToken: string | null = input.nextToken ?? null
  for (let page = 0; page < MAX_GROUP_PAGES && raw.length < limit; page++) {
    const result = await describeGroupPage({
      ...input,
      limit: Math.min(GROUP_PAGE_LIMIT, limit - raw.length),
      nextToken,
    })
    if (!result.ok) return { ok: false, error: result.error }
    raw.push(...result.value.groups)
    nextToken = result.value.nextToken
    if (!nextToken) break
  }

  const needle = input.pattern?.trim().toLowerCase() ?? ''
  // Khử trùng theo TÊN: tên là khoá của picker (`:key="g.name"`), và một tên lặp
  // lại sẽ vỡ danh sách chọn chứ không chỉ xấu về mặt hiển thị.
  const groups = [...new Map(raw.map((g) => [g.logGroupName, g])).values()]
    .map(toLogGroup)
    .filter((g) => (needle ? g.name.toLowerCase().includes(needle) : true))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    ok: true,
    value: { groups, nextToken },
  }
}

function toLogGroup(raw: {
  logGroupName: string
  arn?: string | undefined
  storedBytes?: number | undefined
  retentionInDays?: number | undefined
  creationTime?: number | undefined
}): LogGroup {
  return {
    name: raw.logGroupName,
    arn: raw.arn ?? '',
    storedBytes: raw.storedBytes ?? 0,
    retentionDays: raw.retentionInDays ?? null,
    createdAt: raw.creationTime ?? null,
  }
}

// ─── Đọc: log stream (tầng giữa group → stream → event) ──────────────────────

export type ListLogStreamsInput = {
  logGroup: string
  profile?: string | undefined
  region?: string | undefined
  surface: InfraSurface
  actor?: string | undefined
  limit?: number | undefined
}

/**
 * Liệt kê các log STREAM của một group, MỚI NHẤT trước (`--order-by LastEventTime
 * --descending`). Đọc metadata rẻ như `describe-log-groups`, KHÔNG tính GB quét —
 * nên được phép chạy khi người dùng bấm vào một group. Một trang (≤50) là đủ cho
 * picker; stream cũ hơn hiếm khi cần và người dùng vẫn xem được qua "Tất cả stream".
 */
export async function listLogStreams(
  input: ListLogStreamsInput,
): Promise<LogsOutcome<{ streams: LogStream[]; truncated: boolean }>> {
  if (!isValidLogGroup(input.logGroup)) return { ok: false, error: 'INVALID_LOG_GROUP' }
  const limit = Math.min(Math.max(input.limit ?? STREAM_LIMIT, 1), STREAM_LIMIT)

  const run = await runInfra({
    tool: 'aws',
    args: [
      'logs',
      'describe-log-streams',
      '--output',
      'json',
      flagValue('--log-group-name', input.logGroup),
      // Mới nhất trước. `--order-by LastEventTime` không kết hợp được với
      // `--log-stream-name-prefix`, và ta không lọc tiền tố nên không xung đột.
      '--order-by',
      'LastEventTime',
      '--descending',
      flagValue('--limit', String(limit)),
    ],
    context: { ...(input.profile ? { profile: input.profile } : {}), ...(input.region ? { region: input.region } : {}) },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'logs_streams',
    decision: 'approved',
    timeoutMs: QUERY_TIMEOUT_MS,
  })
  if (!run.ok) return { ok: false, error: cliError(run) }

  const parsed = DescribeStreamsSchema.safeParse(parseJson(run.stdout))
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }
  return {
    ok: true,
    value: {
      streams: parsed.data.logStreams.map((s) => ({
        name: s.logStreamName,
        lastEventAt: s.lastEventTimestamp ?? null,
        storedBytes: s.storedBytes ?? 0,
      })),
      truncated: parsed.data.nextToken !== undefined,
    },
  }
}

// ─── Ước lượng GB quét TRƯỚC khi chạy (2.6) ─────────────────────────────────

export type EstimateInput = {
  logGroups: readonly string[]
  actor?: string | undefined
  /** `bytesScanned` ĐO ĐƯỢC của lần chạy trước cùng câu lệnh, nếu có (từ thư viện
   *  query — `logs/library.ts`). Đây là cơ sở TỐT NHẤT và được ưu tiên. */
  historyBytes?: number | undefined
  profile?: string | undefined
  region?: string | undefined
  surface: InfraSurface
}

/**
 * Ước lượng byte phải quét. Khi biết số đo lịch sử thì dùng nó (chính xác theo
 * nghĩa "cùng câu lệnh, cùng khoảng thời gian sẽ quét chừng ấy"); khi chưa có thì
 * dùng TỔNG dung lượng đang lưu của các group — một TRẦN TRÊN, và UI phải nói rõ
 * điều đó. Sai theo chiều "ước lượng cao hơn thực tế" là chiều an toàn.
 */
export async function estimateScan(input: EstimateInput): Promise<LogsOutcome<ScanEstimate>> {
  const check = checkLogGroups(input.logGroups)
  if (!check.ok) return { ok: false, error: check.error }

  if (input.historyBytes !== undefined && input.historyBytes > 0) {
    return { ok: true, value: estimateFrom(input.historyBytes, 'history', input.logGroups.length) }
  }

  let bytes = 0
  for (const name of input.logGroups) {
    const found = await describeOneGroup(name, input)
    if (!found.ok) return found
    bytes += found.value
  }
  return { ok: true, value: estimateFrom(bytes, 'stored', input.logGroups.length) }
}

function estimateFrom(bytes: number, basis: ScanEstimate['basis'], groupCount: number): ScanEstimate {
  return { bytes, usd: insightsCostUsd(bytes), basis, groupCount }
}

export function insightsCostUsd(bytes: number): number {
  const gb = bytes / 1024 ** 3
  // Làm tròn 4 chữ số thập phân: dưới 1/100 xu là nhiễu, và số quá dài chỉ làm
  // prompt duyệt khó đọc.
  return Math.round(gb * INSIGHTS_USD_PER_GB * 10_000) / 10_000
}

async function describeOneGroup(
  name: string,
  input: {
    profile?: string | undefined
    region?: string | undefined
    surface: InfraSurface
    actor?: string | undefined
  },
): Promise<LogsOutcome<number>> {
  const run = await runInfra({
    tool: 'aws',
    args: [
      'logs',
      'describe-log-groups',
      '--output',
      'json',
      flagValue('--log-group-name-prefix', name),
      flagValue('--limit', '1'),
    ],
    context: { ...(input.profile ? { profile: input.profile } : {}), ...(input.region ? { region: input.region } : {}) },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'logs_estimate',
    decision: 'approved',
    timeoutMs: QUERY_TIMEOUT_MS,
  })
  if (!run.ok) return { ok: false, error: cliError(run) }
  const parsed = DescribeGroupsSchema.safeParse(parseJson(run.stdout))
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }
  const exact = parsed.data.logGroups.find((g) => g.logGroupName === name)
  return { ok: true, value: exact?.storedBytes ?? 0 }
}

// ─── Insights: chạy · hỏi · huỷ ─────────────────────────────────────────────

export type StartQueryInput = {
  logGroups: readonly string[]
  actor?: string | undefined
  query: string
  startMs: number
  endMs: number
  limit?: number | undefined
  profile?: string | undefined
  region?: string | undefined
  surface: InfraSurface
  /** USD đã ước lượng TRƯỚC khi chạy — ghi vào nhật ký để câu "lần đó tốn bao
   *  nhiêu" trả lời được kể cả khi lần chạy sau không trả `bytesScanned`. */
  estimatedUsd?: number | undefined
}

export async function startInsightsQuery(input: StartQueryInput): Promise<LogsOutcome<{ queryId: string }>> {
  const groups = checkLogGroups(input.logGroups)
  if (!groups.ok) return { ok: false, error: groups.error }
  const query = checkQueryString(input.query)
  if (!query.ok) return { ok: false, error: query.error }
  const window = checkWindow(input.startMs, input.endMs)
  if (!window.ok) return { ok: false, error: window.error }

  const limit = Math.min(Math.max(input.limit ?? 100, 1), MAX_ROWS)
  const args = ['logs', 'start-query', '--output', 'json']
  // Một cờ LẶP cho mỗi group: tên group có thể bắt đầu bằng `-` (không thực tế,
  // nhưng) và dạng `=` khoá luôn việc argparse ăn nhầm token tiếp theo.
  for (const g of input.logGroups) args.push(flagValue('--log-group-names', g))
  args.push(flagValue('--start-time', String(window.start)))
  args.push(flagValue('--end-time', String(window.end)))
  args.push(flagValue('--query-string', input.query.trim()))
  args.push(flagValue('--limit', String(limit)))

  const run = await runInfra({
    tool: 'aws',
    args,
    context: { ...(input.profile ? { profile: input.profile } : {}), ...(input.region ? { region: input.region } : {}) },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'logs_query',
    decision: 'approved',
    timeoutMs: START_TIMEOUT_MS,
    ...(input.estimatedUsd !== undefined ? { cost: { estimatedUsd: input.estimatedUsd } } : {}),
  })
  if (!run.ok) return { ok: false, error: cliError(run) }

  const parsed = StartQuerySchema.safeParse(parseJson(run.stdout))
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }
  if (!isValidQueryId(parsed.data.queryId)) return { ok: false, error: 'BAD_OUTPUT' }
  return { ok: true, value: { queryId: parsed.data.queryId } }
}

export type PollInput = {
  queryId: string
  actor?: string | undefined
  profile?: string | undefined
  region?: string | undefined
  surface: InfraSurface
}

/**
 * Hỏi trạng thái + kết quả của một truy vấn đã tạo.
 *
 * `audit: false` — vòng poll do CHÍNH APP sinh (mỗi ~1.5s), không phải người dùng
 * bấm; ghi mỗi lần poll một dòng sẽ biến nhật ký thành tiếng ồn và làm mất chính
 * thứ nó tồn tại để trả lời. Lệnh `start-query` — dòng quyết định "đã làm gì, tốn
 * bao nhiêu" — vẫn được ghi đầy đủ. `runInfra` chỉ chấp nhận bỏ ghi cho lớp
 * `read`, nên không có đường nào giấu một lệnh ghi.
 */
export async function getInsightsResults(input: PollInput): Promise<LogsOutcome<InsightsPoll>> {
  if (!isValidQueryId(input.queryId)) return { ok: false, error: 'INVALID_QUERY_ID' }
  const run = await runInfra({
    tool: 'aws',
    args: ['logs', 'get-query-results', '--output', 'json', flagValue('--query-id', input.queryId)],
    context: { ...(input.profile ? { profile: input.profile } : {}), ...(input.region ? { region: input.region } : {}) },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'logs_query',
    decision: 'approved',
    timeoutMs: QUERY_TIMEOUT_MS,
    audit: false,
  })
  if (!run.ok) return { ok: false, error: cliError(run) }

  const parsed = GetQueryResultsSchema.safeParse(parseJson(run.stdout))
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }
  const stats = parsed.data.statistics
  return {
    ok: true,
    value: {
      status: normaliseStatus(parsed.data.status),
      rows: parsed.data.results.map(toRow),
      bytesScanned: stats?.bytesScanned ?? 0,
      recordsMatched: stats?.recordsMatched ?? 0,
      recordsScanned: stats?.recordsScanned ?? 0,
    },
  }
}

export async function stopInsightsQuery(input: PollInput): Promise<LogsOutcome<{ stopped: true }>> {
  if (!isValidQueryId(input.queryId)) return { ok: false, error: 'INVALID_QUERY_ID' }
  const run = await runInfra({
    tool: 'aws',
    args: ['logs', 'stop-query', '--output', 'json', flagValue('--query-id', input.queryId)],
    context: { ...(input.profile ? { profile: input.profile } : {}), ...(input.region ? { region: input.region } : {}) },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'logs_query',
    decision: 'approved',
    timeoutMs: QUERY_TIMEOUT_MS,
  })
  if (!run.ok) return { ok: false, error: cliError(run) }
  return { ok: true, value: { stopped: true } }
}

/** Trạng thái lạ ⇒ `Unknown`, KHÔNG suy diễn thành `Complete`: một trạng thái mới
 *  của AWS mà bị đọc nhầm thành "xong" sẽ khiến UI hiện 0 dòng như một sự thật. */
function normaliseStatus(raw: string | undefined): InsightsStatus {
  switch (raw) {
    case 'Scheduled':
    case 'Running':
    case 'Complete':
    case 'Failed':
    case 'Cancelled':
    case 'Timeout':
      return raw
    default:
      return 'Unknown'
  }
}

function toRow(cells: readonly { field: string; value: string }[]): InsightsRow {
  const row: InsightsRow = {}
  for (const cell of cells) row[cell.field] = cell.value
  return row
}

// ─── Tail: cửa sổ log gần nhất (`logs_tail_window`, 2.9) ─────────────────────

export type TailInput = {
  logGroups: readonly string[]
  actor?: string | undefined
  startMs: number
  endMs: number
  /** Pattern của `--filter-pattern` (cú pháp CloudWatch metric filter). Rỗng = mọi dòng. */
  filterPattern?: string | undefined
  /** Thu hẹp về MỘT stream (`--log-stream-names`). Bỏ trống = mọi stream của group. */
  logStreamName?: string | undefined
  limit?: number | undefined
  profile?: string | undefined
  region?: string | undefined
  surface: InfraSurface
}

export type TailEvent = {
  timestamp: number
  message: string
  logStreamName: string
  eventId: string
}

export async function tailWindow(input: TailInput): Promise<LogsOutcome<{ events: TailEvent[]; truncated: boolean }>> {
  const groups = checkLogGroups(input.logGroups)
  if (!groups.ok) return { ok: false, error: groups.error }
  const window = checkWindow(input.startMs, input.endMs)
  if (!window.ok) return { ok: false, error: window.error }
  const pattern = input.filterPattern?.trim() ?? ''
  if (pattern.length > MAX_PATTERN_CHARS) return { ok: false, error: 'PATTERN_TOO_LONG' }
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_TAIL_LIMIT, 1), MAX_TAIL_LIMIT)

  // `filter-log-events` chỉ nhận MỘT `--log-group-name` (SỐ ÍT) — khác hẳn
  // `start-query` của Insights vốn dùng `--log-group-names` (số nhiều). Màn tail
  // luôn bấm đúng một nhóm, nên lấy nhóm đầu; nhóm dư (nếu có) bị bỏ qua có chủ ý.
  const group = input.logGroups[0]
  if (!group) return { ok: false, error: 'NO_LOG_GROUP' }
  const stream = input.logStreamName?.trim() ?? ''
  if (stream && !isValidLogStream(stream)) return { ok: false, error: 'INVALID_LOG_STREAM' }
  const args = ['logs', 'filter-log-events', '--output', 'json']
  args.push(flagValue('--log-group-name', group))
  // Thu hẹp về một stream nếu có (tầng group → stream → event). Bỏ trống thì
  // `filter-log-events` gộp mọi stream — chính là lối "Tất cả stream".
  if (stream) args.push(flagValue('--log-stream-names', stream))
  args.push(flagValue('--start-time', String(window.start)))
  args.push(flagValue('--end-time', String(window.end)))
  args.push(flagValue('--limit', String(limit)))
  // Pattern rỗng = mọi dòng, nên KHÔNG truyền cờ khi rỗng (CloudWatch từ chối
  // `--filter-pattern=` rỗng ở một số phiên bản, và "không lọc" là mặc định).
  if (pattern) args.push(flagValue('--filter-pattern', pattern))

  const run = await runInfra({
    tool: 'aws',
    args,
    context: { ...(input.profile ? { profile: input.profile } : {}), ...(input.region ? { region: input.region } : {}) },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'logs_tail_window',
    decision: 'approved',
    timeoutMs: QUERY_TIMEOUT_MS,
  })
  if (!run.ok) return { ok: false, error: cliError(run) }

  const parsed = FilterEventsSchema.safeParse(parseJson(run.stdout))
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }
  return {
    ok: true,
    value: {
      events: parsed.data.events.map((e) => ({
        timestamp: e.timestamp ?? 0,
        message: e.message ?? '',
        logStreamName: e.logStreamName ?? '',
        eventId: e.eventId ?? '',
      })),
      truncated: parsed.data.nextToken !== undefined,
    },
  }
}

// ─── Dùng chung ─────────────────────────────────────────────────────────────

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Thông điệp lỗi CLI đã redact, đã cắt — không bao giờ ném vì "credential hỏng"
 *  là một kết quả hợp lệ mà UI phải hiện được. */
function cliError(run: { stderr: string; exitCode: number | null }): string {
  const detail = run.stderr.trim() || `aws exited with code ${String(run.exitCode)}`
  return detail.slice(0, 600)
}
