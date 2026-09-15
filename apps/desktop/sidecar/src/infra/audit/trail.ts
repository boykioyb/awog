// CloudTrail ghép vào màn Nhật ký (Mốc 7, việc 7.6).
//
// CÂU HỎI MÀ MÀN NÀY TRẢ LỜI: "tài khoản này vừa bị đổi gì, và có phải do tôi làm trong
// AWOG không". Sổ của AWOG (`audit/store.ts`) chỉ biết thứ AWOG chạy; CloudTrail biết
// MỌI thứ — kể cả người khác bấm trong Console, một pipeline CI, hay một khoá bị lộ.
// Chỗ giao nhau của hai sổ mới là thứ đáng xem.
//
// ⚠ PHÉP ĐỐI CHIẾU LÀ SUY ĐOÁN, VÀ NÓ PHẢI TỰ KHAI ĐIỀU ĐÓ.
//
// Không có id chung giữa hai sổ: CloudTrail không biết gì về AWOG, và AWOG không đọc
// được `eventID` trước khi AWS sinh ra nó. Nên phép ghép dựa vào hai thứ:
//   1. TÊN THAO TÁC. AWS CLI đặt tên lệnh bằng cách kebab-hoá tên API, nên
//      `stop-instances` ↔ `StopInstances` là phép biến đổi ngược lại được.
//   2. THỜI GIAN. Một lệnh AWOG chạy lúc `t` thì sự kiện CloudTrail của nó nằm quanh `t`.
// Hai điều kiện cùng đúng ⇒ `origin: 'awog'`; không ⇒ `'external'`.
//
// Chỗ phép đoán này SAI, và nó được ghi ra đây để không ai đọc nhãn như một sự thật:
//   · HAI LƯỢT GIỐNG HỆT NHAU trong cùng cửa sổ (người dùng bấm "Nạp lại" hai lần, hoặc
//     AWOG và một người khác cùng gọi `DescribeInstances`) ⇒ không tách được, và cái
//     của người kia bị gán nhầm là 'awog'.
//   · LỆNH CẤP CAO của CLI không map 1-1: `s3 ls` gọi `ListObjectsV2`, `s3 sync` gọi
//     hàng chục API khác nhau. Chúng sẽ hiện là `external`.
//   · MỘT LỆNH SINH NHIỀU SỰ KIỆN (ví dụ `create-budget` kèm notification) ⇒ chỉ sự kiện
//     trùng tên được nhận, phần còn lại hiện là `external`.
//   · CLOUDTRAIL TRỄ. Sự kiện có thể tới sau 15 phút, nên một lệnh AWOG vừa chạy có thể
//     chưa có mặt ở lượt tra này.
// Vì vậy `origin` đi kèm `matchedAt` (dòng sổ AWOG đã khớp) — người đọc kiểm được, thay
// vì phải tin.
//
// GIỚI HẠN CỦA API, CẢ HAI ĐỀU CỨNG: `lookup-events` chỉ lùi được **90 ngày**, và AWS
// giới hạn **2 request/giây** cho mỗi tài khoản. Nên lượt tra này lấy MỘT trang và nói
// ra khi còn nữa, thay vì tự phân trang tới hết.
import { z } from 'zod'
import { runInfra } from '../run.js'
import { lowerFirstKeys } from '../aws/metrics.js'
import { queryInfraAudit } from './store.js'
import type { InfraSurface } from './store.js'

const TIMEOUT_MS = 60_000

/** Trần cứng của `lookup-events`: bản ghi chỉ lùi được 90 ngày. */
export const TRAIL_MAX_DAYS = 90

/** Số sự kiện mỗi lượt. API cho tối đa 50. */
export const TRAIL_PAGE_SIZE = 50

/**
 * Cửa sổ ghép, tính từ lúc AWOG ghi dòng sổ. Rộng 90 giây vì `at` của AWOG là lúc lệnh
 * KẾT THÚC, còn `eventTime` của CloudTrail là lúc API NHẬN yêu cầu — hai mốc lệch nhau
 * đúng bằng thời gian chạy lệnh, mà một lệnh `aws` có thể mất vài chục giây.
 */
export const MATCH_WINDOW_MS = 90_000

export type TrailOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

export type TrailOrigin = 'awog' | 'external'

export type TrailEvent = {
  id: string
  /** ISO. Lúc AWS NHẬN yêu cầu. */
  at: string
  /** Tên API, ví dụ `StopInstances`. */
  name: string
  /** `ec2.amazonaws.com`. */
  source: string
  /** Ai gọi, theo CloudTrail. Rỗng khi sự kiện không mang danh tính. */
  username: string
  /** Tài nguyên bị chạm, đã rút gọn thành `type name`. */
  resources: string[]
  /** Có phải AWOG gây ra không — SUY ĐOÁN, xem đầu file. */
  origin: TrailOrigin
  /** Dòng sổ AWOG đã khớp (ISO). Vắng mặt ⇒ `origin: 'external'`. */
  matchedAt?: string
  /** CloudTrail báo chính lệnh đó hỏng. */
  errorCode?: string
}

export type TrailReport = {
  events: TrailEvent[]
  /** Còn trang nữa — lượt này CỐ Ý không tự lấy tiếp. */
  hasMore: boolean
  /** Bao nhiêu sự kiện được cho là do AWOG gây ra. */
  awogCount: number
  externalCount: number
}

// ─── Bóc JSON ────────────────────────────────────────────────────────────────

const Resource = z.object({
  resourceType: z.string().optional(),
  resourceName: z.string().optional(),
})

const Event = z.object({
  eventId: z.string().optional(),
  eventName: z.string().optional(),
  eventTime: z.union([z.string(), z.number()]).optional(),
  eventSource: z.string().optional(),
  username: z.string().optional(),
  resources: z.array(Resource).default([]),
  cloudTrailEvent: z.string().optional(),
})

const LookupEvents = z.object({
  events: z.array(Event).default([]),
  nextToken: z.string().optional(),
})

/** `errorCode` chỉ có trong JSON lồng, không ở mức trên. Hỏng thì bỏ qua — nó là phụ. */
function errorCodeOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && 'errorCode' in parsed) {
      const code = (parsed as { errorCode?: unknown }).errorCode
      if (typeof code === 'string' && code !== '') return code
    }
  } catch {
    // Không phải JSON hợp lệ: bỏ qua. Trường này là thông tin thêm, không phải thân bài.
  }
  return undefined
}

/** `eventTime` về dạng ISO. CLI trả epoch giây với `--output json` ở vài phiên bản. */
function eventIso(v: string | number | undefined): string | null {
  if (typeof v === 'number') {
    const d = new Date(v * 1000)
    return Number.isFinite(d.getTime()) ? d.toISOString() : null
  }
  if (typeof v !== 'string' || v === '') return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

// ─── Đối chiếu với sổ AWOG ───────────────────────────────────────────────────

/**
 * `stop-instances` → `StopInstances`.
 *
 * AWS CLI đặt tên lệnh bằng cách kebab-hoá tên API, nên phép ngược lại đúng cho phần lớn
 * lệnh cấp thấp. Nó KHÔNG đúng cho lệnh cấp cao (`s3 ls`, `s3 sync`) — xem đầu file.
 */
export function apiNameFromCliOp(op: string): string {
  return op
    .split('-')
    .filter((p) => p !== '')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}

/**
 * Tên API mà một dòng sổ AWOG có lẽ đã gọi.
 *
 * `argv` của sổ KHÔNG mang tên binary (khuôn của command-log), nên `argv[0]` là service
 * và `argv[1]` là operation. Dòng nào không có đủ hai phần thì không ghép được.
 */
export function apiNameOfAuditArgv(argv: readonly string[]): string | null {
  const op = argv[1]
  if (argv[0] === undefined || op === undefined || op.startsWith('-')) return null
  return apiNameFromCliOp(op)
}

type AuditMark = { at: number; iso: string; api: string }

/**
 * Gán `origin` cho từng sự kiện.
 *
 * MỘT DÒNG SỔ CHỈ KHỚP MỘT LẦN. Không có luật đó thì một lệnh AWOG duy nhất sẽ "nhận"
 * mọi sự kiện cùng tên trong cửa sổ, và một hành động thật của người khác biến mất khỏi
 * cột `external` — đúng chỗ mà màn này tồn tại để chỉ ra.
 */
export function markOrigins(
  events: readonly Omit<TrailEvent, 'origin' | 'matchedAt'>[],
  marks: readonly AuditMark[],
): TrailEvent[] {
  const used = new Set<number>()
  return events.map((e) => {
    const at = Date.parse(e.at)
    let hitIndex = -1
    if (Number.isFinite(at)) {
      hitIndex = marks.findIndex(
        (m, i) => !used.has(i) && m.api === e.name && Math.abs(m.at - at) <= MATCH_WINDOW_MS,
      )
    }
    if (hitIndex === -1) return { ...e, origin: 'external' }
    used.add(hitIndex)
    const mark = marks[hitIndex]
    return {
      ...e,
      origin: 'awog',
      ...(mark ? { matchedAt: mark.iso } : {}),
    }
  })
}

// ─── Lời gọi ─────────────────────────────────────────────────────────────────

export type TrailInput = {
  profile?: string | undefined
  region?: string | undefined
  surface: InfraSurface
  actor?: string | undefined
  /** ISO. Mặc định 24 giờ trước. Quá `TRAIL_MAX_DAYS` sẽ bị trả lỗi có tên. */
  since?: string | undefined
  until?: string | undefined
  /** Lọc theo MỘT tài nguyên — đây là thứ tab "Lịch sử thay đổi" của một tài nguyên dùng. */
  resourceName?: string | undefined
  /** Lọc theo tên API, ví dụ `StopInstances`. */
  eventName?: string | undefined
  now?: number | undefined
}

function cliError(run: { stderr: string; exitCode: number | null }): string {
  const detail = run.stderr.trim() || `aws exited with code ${String(run.exitCode)}`
  return detail.slice(0, 600)
}

/**
 * Tra CloudTrail rồi đối chiếu với sổ AWOG.
 *
 * `--lookup-attributes` chỉ nhận MỘT thuộc tính cho mỗi lượt tra (API của AWS giới hạn
 * vậy), nên khi người gọi đưa cả `resourceName` lẫn `eventName` thì tài nguyên thắng:
 * tab "Lịch sử thay đổi" hỏi về một tài nguyên, và lọc thêm theo tên API làm ở phía ta.
 */
export async function lookupTrail(input: TrailInput): Promise<TrailOutcome<TrailReport>> {
  const now = input.now ?? Date.now()
  const since = input.since ?? new Date(now - 86_400_000).toISOString()
  const until = input.until ?? new Date(now).toISOString()

  const sinceMs = Date.parse(since)
  if (!Number.isFinite(sinceMs)) return { ok: false, error: 'BAD_WINDOW' }
  if (now - sinceMs > TRAIL_MAX_DAYS * 86_400_000) return { ok: false, error: 'WINDOW_TOO_OLD' }

  const args = [
    'cloudtrail',
    'lookup-events',
    '--start-time',
    since,
    '--end-time',
    until,
    '--max-results',
    String(TRAIL_PAGE_SIZE),
    '--output',
    'json',
  ]
  if (input.resourceName) {
    args.push('--lookup-attributes', `AttributeKey=ResourceName,AttributeValue=${input.resourceName}`)
  } else if (input.eventName) {
    args.push('--lookup-attributes', `AttributeKey=EventName,AttributeValue=${input.eventName}`)
  }

  const run = await runInfra({
    tool: 'aws',
    args,
    context: {
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.region ? { region: input.region } : {}),
    },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'trail_lookup',
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
  const parsed = LookupEvents.safeParse(parsedJson)
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }

  const bare = parsed.data.events.flatMap((e) => {
    const at = eventIso(e.eventTime)
    if (at === null || !e.eventName) return []
    const code = errorCodeOf(e.cloudTrailEvent)
    return [
      {
        id: e.eventId ?? `${e.eventName}-${at}`,
        at,
        name: e.eventName,
        source: e.eventSource ?? '',
        username: e.username ?? '',
        resources: e.resources
          .map((r) => [r.resourceType, r.resourceName].filter((x) => x).join(' '))
          .filter((x) => x !== ''),
        ...(code !== undefined ? { errorCode: code } : {}),
      },
    ]
  })

  // Sổ AWOG cho CÙNG cửa sổ, nới hai đầu đúng bằng cửa sổ ghép — một lệnh chạy ngay
  // trước `since` vẫn có thể là nguyên nhân của sự kiện đầu tiên.
  const ledger = await queryInfraAudit({
    since: new Date(sinceMs - MATCH_WINDOW_MS).toISOString(),
    until: new Date(Date.parse(until) + MATCH_WINDOW_MS).toISOString(),
    limit: 2000,
  })
  const marks: AuditMark[] = ledger.flatMap((entry) => {
    const api = apiNameOfAuditArgv(entry.argv)
    const at = Date.parse(entry.at)
    if (api === null || !Number.isFinite(at)) return []
    return [{ at, iso: entry.at, api }]
  })

  const events = markOrigins(bare, marks)
  return {
    ok: true,
    value: {
      events,
      hasMore: parsed.data.nextToken !== undefined,
      awogCount: events.filter((e) => e.origin === 'awog').length,
      externalCount: events.filter((e) => e.origin === 'external').length,
    },
  }
}
