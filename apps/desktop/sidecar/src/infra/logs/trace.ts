// Lần theo MỘT request (L5 của `cloudwatch-logs.md` §6) — hai nhánh, một hình dạng.
//
// VÌ SAO TÍNH NĂNG NÀY TỒN TẠI. Vòng lặp thật khi có sự cố kết thúc ở câu *"request
// này đã đi qua đâu, chết ở chặng nào"*. Console trả lời được nhưng bắt mở mỗi log
// group một tab rồi tự ghép thời gian bằng mắt. Ở đây một id → một dòng thời gian.
//
// HAI NHÁNH, CỐ Ý KHÔNG GIỐNG NHAU:
//
//   · X-Ray (`batch-get-traces`) — chỉ chạy khi id ĐÚNG là một X-Ray trace id
//     (`1-<8 hex>-<24 hex>`). Nguồn này có TIMING THẬT của từng chặng (`start_time`
//     → `end_time` của mỗi segment), nên `durationMs` có giá trị.
//   · Log (Insights) — id nào cũng chạy được, kể cả correlation id tự đặt. Nguồn
//     này KHÔNG có timing từng chặng: nó chỉ biết dòng log nào nhắc tới id, nên
//     `durationMs` là `null` và thứ đo được chỉ là KHOẢNG CÁCH giữa các chặng
//     (`gapToNextMs`). Nói ra khác biệt đó là việc của UI — con số ở đây không tự
//     nhận là độ trễ xử lý.
//
// VÌ SAO KHÔNG TRA X-RAY BẰNG MỘT REQUEST ID THƯỜNG. Để đi từ `requestId` sang trace
// id phải gọi `xray get-trace-summaries --filter-expression`, tức quét toàn bộ cửa sổ
// thời gian và trả tiền cho một phép tìm có thể không ra gì. Bản này CHỈ nhận trace
// id cho nhánh X-Ray; mọi id khác đi nhánh log. Giới hạn có chủ đích, ghi ở đây để
// người sau không tưởng là bỏ sót.
//
// TRẦN CỨNG: không giá trị nào ở file này chạm credential, và mọi stdout đã được
// `runInfra` redact TRƯỚC khi rời tiến trình con (invariant #1) — hàm dựng hop dưới
// đây KHÔNG redact lại, nó chỉ sắp xếp thứ đã sạch.

import { z } from 'zod'
import { runInfra } from '../run.js'
import { lambdaLogGroup } from '../graph/log-groups.js'
import type { InfraSurface } from '../audit/store.js'
import type { InsightsRow, LogsOutcome } from '../aws/logs.js'

// ─── Trần ───────────────────────────────────────────────────────────────────

/** Trần độ dài id người dùng dán vào. Dài hơn thế thì không còn là một id. */
const MAX_TRACE_ID = 200

/** Trần số dòng Insights một lượt lần theo lấy về. */
export const TRACE_ROW_LIMIT = 200

/** Trần số dòng GIỮ LẠI trong mỗi hop khi trả lên UI — phần còn lại đếm, không chở. */
export const TRACE_ROWS_PER_HOP = 25

/** Trần số segment X-Ray đọc trong một trace (một trace lỗi có thể rất sâu). */
const MAX_XRAY_SEGMENTS = 200

/** Trần độ sâu subsegment đi vào. Sâu hơn là chi tiết của thư viện, không phải hop. */
const MAX_XRAY_DEPTH = 3

const XRAY_TIMEOUT_MS = 45_000

/**
 * Ký tự cho phép trong một id.
 *
 * ⚠ KHÔNG có `/` và không có ký tự trắng — nhờ vậy `file://`, `fileb://` và mọi
 * đường dẫn không bao giờ lọt vào argv qua ngả này (invariant #2 · bản vá #3 của
 * infosec audit #1). Cũng không có `"` nên id nhét được nguyên vào một chuỗi nháy
 * kép của câu Insights mà không cần escape, và không có ký tự regex nào ngoài `.`
 * và `+` — hai ký tự đó vô hại vì câu lệnh dùng dạng `like "<chuỗi>"` (so khớp
 * CHUỖI CON) chứ không phải `like /<regex>/`.
 */
const TRACE_ID_RE = /^[A-Za-z0-9._:@=+-]{1,200}$/

/** X-Ray trace id: `1-<8 hex thời gian>-<24 hex ngẫu nhiên>`. */
const XRAY_ID_RE = /^1-[0-9a-f]{8}-[0-9a-f]{24}$/

/** Request id của Lambda/API Gateway — UUID v4 dạng chuẩn. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── Kiểu công khai ─────────────────────────────────────────────────────────

/**
 * Loại id người dùng đưa vào. Quyết định NHÁNH nào chạy được, nên nó đi lên tới UI
 * (câu "không có timing từng chặng" chỉ đúng với `request`/`free`).
 */
export type TraceIdKind = 'xray' | 'request' | 'free'

export type TraceIdCheck =
  | { ok: true; kind: TraceIdKind; id: string }
  | { ok: false; error: string }

export type TraceHopStatus = 'ok' | 'error'

/** Một chặng của request. `key` là thứ UI dùng làm khoá danh sách. */
export type TraceHop = {
  key: string
  /** `lambda` · `apigateway` · `ecs` … suy từ tên log group hoặc từ segment X-Ray. */
  service: string
  /** Nhãn đọc được: tên log group, hoặc tên segment. */
  label: string
  /** Có giá trị ⇒ UI mở được màn Logs đúng nhóm này. `null` ở hop X-Ray thuần. */
  logGroup: string | null
  firstAt: number
  lastAt: number
  /** Độ trễ THẬT của chặng — CHỈ nhánh X-Ray. `null` ở nhánh log. */
  durationMs: number | null
  /** Khoảng cách tới chặng sau. `null` ở chặng cuối. */
  gapToNextMs: number | null
  status: TraceHopStatus
  /** Số dòng log (nhánh log) hoặc số segment gộp (nhánh X-Ray). */
  count: number
  /** Dòng log nguyên bản của chặng — đã cắt theo `TRACE_ROWS_PER_HOP`. */
  rows: InsightsRow[]
  rowsTruncated: boolean
  /** Câu ngắn nói thêm (mã HTTP, thông điệp lỗi của segment). Không dịch. */
  note: string | null
}

export type InfraTrace = {
  id: string
  kind: TraceIdKind
  source: 'xray' | 'logs'
  hops: TraceHop[]
  /** Từ mốc đầu tới mốc cuối. `null` khi không đủ hai mốc. */
  totalMs: number | null
  /** Chạm trần số dòng/segment ⇒ còn chặng chưa thấy. */
  truncated: boolean
  /** Khoá i18n — UI dịch. KHÔNG bao giờ là câu tiếng Anh thô của AWS. */
  notes: string[]
}

// ─── Kiểm tra đầu vào (thuần, test được bằng bảng) ──────────────────────────

/**
 * Nhận diện id.
 *
 * Trả về CẢ `kind` chứ không chỉ hợp lệ/không, vì nhánh chạy được phụ thuộc vào nó
 * và UI phải nói trước người dùng sẽ nhận được gì ("id này không có timing từng
 * chặng") thay vì để họ đọc một dòng thời gian thiếu số rồi tự đoán.
 */
export function classifyTraceId(raw: string): TraceIdCheck {
  const id = raw.trim()
  if (id.length === 0) return { ok: false, error: 'EMPTY_TRACE_ID' }
  if (id.length > MAX_TRACE_ID) return { ok: false, error: 'TRACE_ID_TOO_LONG' }
  if (!TRACE_ID_RE.test(id)) return { ok: false, error: 'INVALID_TRACE_ID' }
  if (XRAY_ID_RE.test(id)) return { ok: true, kind: 'xray', id }
  if (UUID_RE.test(id)) return { ok: true, kind: 'request', id }
  return { ok: true, kind: 'free', id }
}

/**
 * Câu Insights tìm mọi dòng có nhắc tới id.
 *
 * `like "<chuỗi>"` — dạng CHUỖI CON, KHÔNG phải `like /<regex>/`: id là dữ liệu L1,
 * và một `.` hay `+` trong đó mà rơi vào ngữ cảnh regex sẽ âm thầm khớp sai (khớp
 * rộng hơn người dùng tưởng) chứ không báo lỗi. `TRACE_ID_RE` đã cấm dấu nháy kép
 * nên chuỗi này không thể bị thoát ra ngoài cặp nháy.
 *
 * `@log` bắt buộc có mặt: nó là thứ DUY NHẤT cho biết dòng này thuộc log group nào
 * khi truy vấn chạy xuyên nhiều group — cũng là thứ `hopsFromRows` gộp theo.
 */
export function buildTraceQuery(id: string, limit = TRACE_ROW_LIMIT): string {
  const rows = Math.min(Math.max(Math.trunc(limit), 1), TRACE_ROW_LIMIT)
  return [
    'fields @timestamp, @log, @logStream, @requestId, @message',
    `| filter @message like "${id}"`,
    '| sort @timestamp asc',
    `| limit ${rows}`,
  ].join(' ')
}

// ─── Nhánh log: dựng hop từ dòng Insights ───────────────────────────────────

/**
 * `@timestamp` của Insights là `YYYY-MM-DD HH:MM:SS.mmm` theo **UTC** nhưng KHÔNG
 * mang hậu tố múi giờ — `Date.parse` sẽ đọc nó thành giờ ĐỊA PHƯƠNG và lệch đúng
 * bằng offset của máy. Đổi dấu cách thành `T` rồi gắn `Z` là chỗ duy nhất sửa việc
 * đó; mọi mốc thời gian trong file này đều đi qua đây.
 */
export function parseInsightsTime(raw: string | undefined): number | null {
  if (!raw) return null
  const value = raw.trim()
  if (value.length === 0) return null
  // Một số câu trả `@timestamp` đã là epoch (khi người dùng tự `fields`).
  if (/^\d{10,16}$/.test(value)) {
    const n = Number(value)
    return Number.isFinite(n) ? (value.length <= 10 ? n * 1000 : n) : null
  }
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Tên log group từ trường `@log`, có dạng `<accountId>:<tên group>`.
 *
 * Tên group chứa `:`? Không — CloudWatch cấm `:` trong tên log group, nên cắt ở dấu
 * hai chấm ĐẦU TIÊN là đúng và không mất ký tự nào của tên.
 */
export function logGroupOfRow(row: InsightsRow): string | null {
  const raw = row['@log']?.trim()
  if (!raw) return null
  const at = raw.indexOf(':')
  const name = at >= 0 ? raw.slice(at + 1) : raw
  return name.length > 0 ? name : null
}

/**
 * Dịch tên log group sang tên dịch vụ — để hop mang cùng từ vựng với graph (G4) và
 * với Explorer. Không khớp khuôn nào ⇒ `logs`, KHÔNG đoán bừa.
 */
export function serviceOfLogGroup(group: string): string {
  if (group.startsWith('/aws/lambda/')) return 'lambda'
  if (group.startsWith('API-Gateway-Execution-Logs') || group.startsWith('/aws/apigateway/')) {
    return 'apigateway'
  }
  if (group.startsWith('/aws/ecs/') || group.startsWith('/ecs/')) return 'ecs'
  if (group.startsWith('/aws/eks/')) return 'eks'
  if (group.startsWith('/aws/rds/')) return 'rds'
  if (group.startsWith('/aws/codebuild/')) return 'codebuild'
  if (group.startsWith('/aws/cloudfront/')) return 'cloudfront'
  return 'logs'
}

/**
 * Dấu hiệu chặng này HỎNG. Danh sách NGẮN và tường minh thay vì một regex "bắt hết":
 * tô đỏ nhầm một chặng khoẻ là đẩy người đang chữa cháy đi sai hướng, mà đó đúng là
 * lúc họ ít có thời gian kiểm lại nhất.
 */
const ERROR_MARKERS = [
  'ERROR',
  'Exception',
  'Traceback',
  'Task timed out',
  'panic:',
  '"level":"error"',
  "'level': 'error'",
]

/**
 * Mã trạng thái 5xx, nhưng CHỈ khi con số dính liền với khoá nói nó là mã trạng
 * thái (`"statusCode": 502`, `status=503`, `"GET / HTTP/1.1" 502`).
 *
 * ⚠ Bản đầu hỏi hai câu RỜI NHAU — "có số 5xx nào không" VÀ "có chữ status/code ở
 * đâu đó không" — nên `{"statusCode":200,"latencyMs":512}` bị tô đỏ: `512` là con
 * số 5xx đứng riêng, còn chữ `status` nằm ở chỗ khác hẳn. Đo được trên bốn chuỗi
 * log JSON thường gặp: cả bốn đều báo lỗi. Đó đúng là thứ chú thích ngay trên
 * `ERROR_MARKERS` thề sẽ không làm — tô đỏ một chặng khoẻ đẩy người đang chữa cháy
 * đi sai hướng, và hai điều kiện rời nhau chính là một regex "bắt hết" trá hình.
 */
const STATUS_5XX = [
  // `status`/`statusCode`/`http_status`/`responseCode` + (`:`/`=`/khoảng trắng) + 5xx
  /\b(?:http[_-]?)?(?:status|response)(?:[_-]?code)?\b["']?\s*[:=]\s*["']?5\d{2}\b/i,
  // Access log kiểu Apache/ALB: `"GET /x HTTP/1.1" 502 1234`
  /HTTP\/\d(?:\.\d)?"?\s+5\d{2}\b/,
]

export function messageLooksFailed(message: string): boolean {
  if (message.length === 0) return false
  for (const marker of ERROR_MARKERS) {
    if (message.includes(marker)) return true
  }
  for (const re of STATUS_5XX) {
    if (re.test(message)) return true
  }
  return false
}

/**
 * Gộp dòng log thành chặng.
 *
 * GỘP THEO LOG GROUP, KHÔNG THEO LẦN GHÉ. Một request quay lại cùng một hàm hai lần
 * cho ra MỘT chặng với `count` = 2 chứ không phải hai chặng. Đó là lựa chọn có chủ
 * đích: dòng thời gian này để trả lời "đi qua những đâu, chết ở đâu", và tách lần
 * ghé sẽ biến một vòng lặp retry 30 lần thành 30 hàng không đọc nổi. Thứ tự các
 * chặng theo mốc THẤY LẦN ĐẦU.
 */
export function hopsFromRows(rows: readonly InsightsRow[]): TraceHop[] {
  const byGroup = new Map<string, TraceHop>()

  for (const row of rows) {
    const group = logGroupOfRow(row) ?? '?'
    const at = parseInsightsTime(row['@timestamp'])
    const failed = messageLooksFailed(row['@message'] ?? '')
    const hop = byGroup.get(group)

    if (!hop) {
      byGroup.set(group, {
        key: group,
        service: serviceOfLogGroup(group),
        label: group,
        logGroup: group === '?' ? null : group,
        firstAt: at ?? 0,
        lastAt: at ?? 0,
        durationMs: null,
        gapToNextMs: null,
        status: failed ? 'error' : 'ok',
        count: 1,
        rows: [row],
        rowsTruncated: false,
        note: null,
      })
      continue
    }

    hop.count += 1
    if (failed) hop.status = 'error'
    if (at !== null) {
      // `firstAt === 0` = chặng mở đầu bằng một dòng không đọc được mốc thời gian;
      // dòng đầu tiên CÓ mốc phải thành mốc đầu, không phải bị so với số 0.
      if (hop.firstAt === 0 || at < hop.firstAt) hop.firstAt = at
      if (at > hop.lastAt) hop.lastAt = at
    }
    if (hop.rows.length < TRACE_ROWS_PER_HOP) hop.rows.push(row)
    else hop.rowsTruncated = true
  }

  const hops = [...byGroup.values()].sort((a, b) => a.firstAt - b.firstAt)
  return withGaps(hops)
}

/**
 * Điền `gapToNextMs` cho một dãy chặng đã sắp theo thời gian.
 *
 * Đo từ mốc CUỐI của chặng này tới mốc đầu của chặng sau — đó mới là "khoảng cách"
 * mà nhãn hứa. ⚠ Bản đầu đo từ mốc ĐẦU tới mốc đầu, mà các lần ghé lại cùng một
 * log group đã bị gộp làm một chặng: một vòng retry 10 giây trong cùng hàm vì thế
 * báo "cách chặng sau 10 s" trong khi cú bàn giao thật chỉ mất 100 ms.
 *
 * Chồng lấn (chặng sau bắt đầu TRƯỚC khi chặng này ghi dòng cuối) ⇒ `null`, không
 * phải một số âm: hai chặng chạy song song thì không có khoảng cách nào để nói, và
 * "−200 ms" đọc ra như một lỗi của app chứ không như một sự thật về hệ thống.
 */
function withGaps(hops: TraceHop[]): TraceHop[] {
  for (let i = 0; i < hops.length - 1; i += 1) {
    const here = hops[i]
    const next = hops[i + 1]
    if (!here || !next) continue
    const from = here.lastAt > 0 ? here.lastAt : here.firstAt
    if (from <= 0 || next.firstAt <= 0) continue
    const gap = next.firstAt - from
    here.gapToNextMs = gap >= 0 ? gap : null
  }
  return hops
}

/** Bọc các chặng thành một `InfraTrace` — dùng chung cho cả hai nhánh. */
export function traceOf(
  id: string,
  kind: TraceIdKind,
  source: 'xray' | 'logs',
  hops: TraceHop[],
  truncated: boolean,
  notes: readonly string[],
): InfraTrace {
  // Từ mốc SỚM NHẤT tới mốc MUỘN NHẤT của cả trace.
  //
  // ⚠ Bản đầu lấy `hops[hops.length - 1].lastAt`, tức chặng có mốc BẮT ĐẦU muộn
  // nhất (mảng sắp theo `firstAt`) — mà chặng kết thúc muộn nhất thường là chặng
  // BAO ngoài: một segment API Gateway mở đầu và đóng sau cùng không bao giờ là
  // phần tử cuối mảng. Hệ quả đo được: tổng ra ngắn hơn chính `durationMs` đang
  // hiện trên một hàng, tức hai con số mâu thuẫn nhau trên cùng màn hình.
  const starts = hops.map((h) => h.firstAt).filter((n) => n > 0)
  const ends = hops.map((h) => h.lastAt).filter((n) => n > 0)
  const totalMs =
    starts.length > 0 && ends.length > 0 ? Math.max(...ends) - Math.min(...starts) : null
  return {
    id,
    kind,
    source,
    hops,
    totalMs,
    truncated,
    notes: [...notes],
  }
}

// ─── Nhánh X-Ray ────────────────────────────────────────────────────────────

const BatchGetTracesSchema = z.object({
  Traces: z
    .array(
      z.object({
        Id: z.string().max(128).optional(),
        Duration: z.number().optional(),
        Segments: z
          .array(z.object({ Id: z.string().max(128).optional(), Document: z.string().optional() }))
          .default([]),
      }),
    )
    .default([]),
  UnprocessedTraceIds: z.array(z.string().max(128)).default([]),
})

/**
 * Segment document của X-Ray — CHỈ khai những trường mà một chặng cần đọc.
 *
 * Kiểu suy TỪ lược đồ (`z.infer`) chứ không khai tay song song: khai hai lần thì
 * `exactOptionalPropertyTypes` bắt lỗi ngay, và tệ hơn là hai bản có thể trôi lệch
 * nhau về sau mà không ai biết.
 */
const SegmentSchema = z.object({
  id: z.unknown().optional(),
  name: z.unknown().optional(),
  origin: z.unknown().optional(),
  namespace: z.unknown().optional(),
  start_time: z.unknown().optional(),
  end_time: z.unknown().optional(),
  error: z.unknown().optional(),
  fault: z.unknown().optional(),
  throttle: z.unknown().optional(),
  http: z.object({ response: z.object({ status: z.unknown().optional() }).optional() }).optional(),
  aws: z
    .object({ function_name: z.unknown().optional(), operation: z.unknown().optional() })
    .optional(),
  subsegments: z.unknown().optional(),
})

export type SegmentDoc = z.infer<typeof SegmentSchema>

/**
 * `origin` của X-Ray là chuỗi kiểu `AWS::Lambda::Function`. Lấy đoạn GIỮA và hạ chữ
 * thường để hop nói cùng từ vựng với graph (`lambda`, `apigateway`, `ecs`…).
 */
export function serviceOfXraySegment(seg: SegmentDoc): string {
  const origin = typeof seg.origin === 'string' ? seg.origin : ''
  const parts = origin.split('::')
  const middle = parts[1]
  if (middle) {
    const key = middle.toLowerCase()
    return key === 'apigateway' ? 'apigateway' : key
  }
  const ns = typeof seg.namespace === 'string' ? seg.namespace : ''
  if (ns === 'aws') return 'aws'
  if (ns === 'remote') return 'remote'
  return 'xray'
}

/** Giây thực của X-Ray (`1757980800.123`) → mili-giây. */
function xraySeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.round(value * 1000)
}

function segmentStatus(seg: SegmentDoc): { status: TraceHopStatus; note: string | null } {
  const status = seg.http?.response?.status
  const httpNote = typeof status === 'number' ? `HTTP ${status}` : null
  if (seg.fault === true) return { status: 'error', note: httpNote ?? 'fault' }
  if (seg.error === true) return { status: 'error', note: httpNote ?? 'error' }
  if (seg.throttle === true) return { status: 'error', note: httpNote ?? 'throttle' }
  if (typeof status === 'number' && status >= 500) return { status: 'error', note: httpNote }
  return { status: 'ok', note: httpNote }
}

/**
 * Một segment (và subsegment của nó) → các chặng.
 *
 * Subsegment đi vào tối đa `MAX_XRAY_DEPTH` cấp: sâu hơn là chi tiết bên trong một
 * thư viện (một lần gọi `dynamodb` sinh cả cây `marshall`/`http`), không phải một
 * chặng của request. Cắt sớm giữ cho dòng thời gian đọc được.
 */
function hopsFromSegment(seg: SegmentDoc, depth: number, out: TraceHop[]): void {
  if (out.length >= MAX_XRAY_SEGMENTS) return
  const start = xraySeconds(seg.start_time)
  const end = xraySeconds(seg.end_time)
  const name = typeof seg.name === 'string' ? seg.name : '?'
  const id = typeof seg.id === 'string' ? seg.id : `${name}:${out.length}`
  const { status, note } = segmentStatus(seg)

  out.push({
    key: id,
    service: serviceOfXraySegment(seg),
    label: name,
    // X-Ray không kể tên log group. Nối tên hàm Lambda sang log group là suy đoán
    // ĐÚNG KHUÔN của AWS, nên nó đi qua CHÍNH hàm mà graph dùng thay vì chép luật
    // sang đây — bản chép tay ở đây từng thiếu phép kiểm `:`/`/` và sinh ra
    // `/aws/lambda/orders/create` cho một segment tên `orders/create`.
    logGroup: serviceOfXraySegment(seg) === 'lambda' && name !== '?' ? lambdaLogGroup(name) : null,
    firstAt: start ?? 0,
    lastAt: end ?? start ?? 0,
    durationMs: start !== null && end !== null ? end - start : null,
    gapToNextMs: null,
    status,
    count: 1,
    rows: [],
    rowsTruncated: false,
    note,
  })

  if (depth >= MAX_XRAY_DEPTH) return
  const subs = seg.subsegments
  if (!Array.isArray(subs)) return
  for (const raw of subs) {
    const parsed = SegmentSchema.safeParse(raw)
    if (parsed.success) hopsFromSegment(parsed.data, depth + 1, out)
  }
}

/**
 * Dựng chặng từ kết quả `batch-get-traces`.
 *
 * Tách khỏi phần gọi CLI để test được bằng bảng: hình dạng JSON của X-Ray là thứ
 * duy nhất đáng test ở nhánh này, còn `runInfra` đã có test riêng.
 */
export function hopsFromXrayJson(stdout: string): { hops: TraceHop[]; truncated: boolean } | null {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  const parsed = BatchGetTracesSchema.safeParse(raw)
  if (!parsed.success) return null

  const out: TraceHop[] = []
  for (const trace of parsed.data.Traces) {
    for (const segment of trace.Segments) {
      if (!segment.Document) continue
      let doc: unknown
      try {
        doc = JSON.parse(segment.Document)
      } catch {
        continue
      }
      const seg = SegmentSchema.safeParse(doc)
      if (seg.success) hopsFromSegment(seg.data, 0, out)
    }
  }
  if (out.length === 0) return { hops: [], truncated: false }
  const sorted = out.sort((a, b) => a.firstAt - b.firstAt)
  return { hops: withGaps(sorted), truncated: out.length >= MAX_XRAY_SEGMENTS }
}

export type TraceXrayInput = {
  id: string
  profile?: string | undefined
  region?: string | undefined
  surface: InfraSurface
  actor?: string | undefined
}

/**
 * Hỏi X-Ray một trace.
 *
 * Trả `ok: false` khi tài khoản KHÔNG bật X-Ray, khi thiếu quyền, hay khi trace đã
 * hết hạn (X-Ray giữ 30 ngày) — bên gọi coi đó là tín hiệu rơi sang nhánh log, chứ
 * KHÔNG phải một sự cố để ném lên người dùng.
 */
export async function traceFromXray(
  input: TraceXrayInput,
): Promise<LogsOutcome<{ hops: TraceHop[]; truncated: boolean }>> {
  const check = classifyTraceId(input.id)
  if (!check.ok) return { ok: false, error: check.error }
  if (check.kind !== 'xray') return { ok: false, error: 'NOT_XRAY_ID' }

  const run = await runInfra({
    tool: 'aws',
    args: ['xray', 'batch-get-traces', '--output', 'json', `--trace-ids=${check.id}`],
    context: {
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.region ? { region: input.region } : {}),
    },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'trace_xray',
    decision: 'approved',
    timeoutMs: XRAY_TIMEOUT_MS,
  })
  if (!run.ok) return { ok: false, error: run.stderr.trim().slice(0, 300) || 'XRAY_FAILED' }

  const built = hopsFromXrayJson(run.stdout)
  if (!built) return { ok: false, error: 'BAD_OUTPUT' }
  if (built.hops.length === 0) return { ok: false, error: 'XRAY_EMPTY' }
  return { ok: true, value: built }
}
