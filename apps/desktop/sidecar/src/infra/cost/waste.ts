// Dò lãng phí (Mốc 7, việc 7.2): bảy phép dò CHỈ ĐỌC, mỗi phát hiện kèm ước tính tiền.
//
// MỖI PHÁT HIỆN PHẢI NÓI ĐƯỢC BA THỨ, nếu không nó là tiếng ồn: cái gì (`resourceId`),
// vì sao nó là lãng phí (`reasonKey` — một khoá i18n, không phải câu chữ tiếng Anh nhét
// vào sidecar), và bao nhiêu tiền một tháng (`monthlyUsd`). Con số đến từ bảng giá TĨNH
// ở `pricing.ts` và luôn là ƯỚC LƯỢNG — xem đầu file đó.
//
// `monthlyUsd: null` LÀ MỘT CÂU TRẢ LỜI HỢP LỆ. Instance type không có trong bảng giá
// thì phát hiện vẫn được báo, chỉ không kèm tiền. Đoán bừa một con số còn tệ hơn im
// lặng về nó.
//
// HAI HẠNG PHÉP DÒ, VÀ CHÚNG KHÔNG CÙNG GIÁ:
//   · MIỄN PHÍ — chỉ `describe-*`, lớp `read`, chạy tự động sau cú bấm.
//   · TRẢ TIỀN — cần `cloudwatch get-metric-data` để biết tài nguyên có đang được dùng
//     hay không (instance idle · NAT idle). Chúng chỉ chạy khi người gọi XIN, và lượt
//     xin đó đi qua `getMetricData` nên vẫn được chia lô + cache như màn Giám sát.
// Trộn hai hạng làm một là để một cú bấm "dò lãng phí" âm thầm tốn tiền metric.
//
// KHÔNG PHÁT HIỆN NÀO TỰ SỬA. Module này chỉ ĐỌC. Việc 7.3 biến các phát hiện đã chọn
// thành một playbook — và playbook thì đi qua cửa duyệt như mọi lệnh ghi khác.
import { z } from 'zod'
import { runInfra } from '../run.js'
import { getMetricData, lowerFirstKeys } from '../aws/metrics.js'
import {
  EIP_IDLE_USD_PER_HOUR,
  LB_USD_PER_HOUR,
  LOGS_STORAGE_USD_PER_GB_MONTH,
  NAT_USD_PER_HOUR,
  SNAPSHOT_USD_PER_GB_MONTH,
  ebsMonthlyUsd,
  ec2MonthlyUsd,
  monthlyFromHourly,
} from './pricing.js'
import type { InfraSurface } from '../audit/store.js'

/** Tuổi tối thiểu để một snapshot bị coi là "cũ". */
export const SNAPSHOT_STALE_DAYS = 90

/** Trần số dòng mỗi lệnh liệt kê — một tài khoản lớn không được làm nghẽn màn hình. */
const MAX_ITEMS = 400

/** Cửa sổ đo mức dùng cho hai phép dò trả tiền. 14 ngày đủ phủ một chu kỳ công việc. */
const IDLE_WINDOW_DAYS = 14

/** CPU trung bình dưới ngưỡng này trong cả cửa sổ ⇒ coi là idle. */
export const IDLE_CPU_PERCENT = 3

/** Tổng byte NAT chuyển dưới ngưỡng này trong cả cửa sổ ⇒ coi là idle (≈ 1 MB). */
export const IDLE_NAT_BYTES = 1_048_576

/** Trần số tài nguyên gửi đi đo metric một lượt — mỗi cái là một metric tính tiền. */
const MAX_METRIC_TARGETS = 20

const RUN_TIMEOUT_MS = 60_000

export type WasteOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

/** Mã của một phép dò. Cũng là khoá i18n gốc ở UI (`infra.waste.check.<id>`). */
export const WASTE_CHECKS = [
  'eip-idle',
  'ebs-unattached',
  'snapshot-stale',
  'logs-no-retention',
  'lb-no-targets',
  'ec2-idle',
  'nat-idle',
] as const
export type WasteCheck = (typeof WASTE_CHECKS)[number]

/** Hai phép dò cần metric ⇒ TỐN TIỀN ⇒ chỉ chạy khi người gọi xin tường minh. */
export const PAID_CHECKS: readonly WasteCheck[] = ['ec2-idle', 'nat-idle']

export type WasteFinding = {
  check: WasteCheck
  /** Id thật của tài nguyên — cũng là thứ playbook dọn dẹp (7.3) sẽ nhắc tới. */
  resourceId: string
  /** Tên người đọc được; rơi về `resourceId` khi tài nguyên không có tên. */
  label: string
  region: string
  /**
   * Ước tính tiền một tháng. `null` = biết đây là lãng phí nhưng KHÔNG biết giá (xem
   * `pricing.ts`). UI phải hiện "—", không hiện 0.
   */
  monthlyUsd: number | null
  /**
   * Ước tính này có nguy cơ CAO HƠN thực tế không. Đúng với snapshot: giá tính theo
   * phần tăng thêm, còn ta chỉ biết kích thước volume gốc.
   */
  overEstimate: boolean
  /** Vài trường ngắn cho bảng (trạng thái, kích thước, ngày tạo…). Đã qua redact của `runInfra`. */
  detail: Record<string, string>
}

export type WasteReport = {
  findings: WasteFinding[]
  /** Phép dò đã chạy xong. */
  ran: WasteCheck[]
  /** Phép dò hỏng, kèm lý do — KHÔNG nuốt: một phép dò câm làm người đọc tưởng đã sạch. */
  failed: { check: WasteCheck; error: string }[]
  /** Tổng tiền của những phát hiện CÓ giá. Phát hiện `null` không được đếm là 0. */
  totalMonthlyUsd: number
  /** Có phát hiện nào không biết giá không — UI phải nói "và N khoản chưa định giá". */
  unpricedCount: number
  region: string
}

// ─── Lược đồ JSON của CLI ────────────────────────────────────────────────────

const Tag = z.object({ key: z.string(), value: z.string() })
const Tags = z.array(Tag).optional()

const Addresses = z.object({
  addresses: z
    .array(
      z.object({
        publicIp: z.string().optional(),
        allocationId: z.string().optional(),
        associationId: z.string().optional(),
        tags: Tags,
      }),
    )
    .default([]),
})

const Volumes = z.object({
  volumes: z
    .array(
      z.object({
        volumeId: z.string(),
        size: z.number().optional(),
        volumeType: z.string().optional(),
        state: z.string().optional(),
        createTime: z.string().optional(),
        tags: Tags,
      }),
    )
    .default([]),
})

const Snapshots = z.object({
  snapshots: z
    .array(
      z.object({
        snapshotId: z.string(),
        volumeSize: z.number().optional(),
        startTime: z.string().optional(),
        description: z.string().optional(),
        tags: Tags,
      }),
    )
    .default([]),
})

const LogGroups = z.object({
  logGroups: z
    .array(
      z.object({
        logGroupName: z.string(),
        retentionInDays: z.number().optional(),
        storedBytes: z.number().optional(),
      }),
    )
    .default([]),
})

const LoadBalancers = z.object({
  loadBalancers: z
    .array(
      z.object({
        loadBalancerArn: z.string(),
        loadBalancerName: z.string().optional(),
        type: z.string().optional(),
        state: z.object({ code: z.string().optional() }).optional(),
      }),
    )
    .default([]),
})

const TargetGroups = z.object({
  targetGroups: z
    .array(
      z.object({
        targetGroupArn: z.string(),
        targetGroupName: z.string().optional(),
        loadBalancerArns: z.array(z.string()).default([]),
      }),
    )
    .default([]),
})

const TargetHealth = z.object({
  targetHealthDescriptions: z
    .array(z.object({ target: z.object({ id: z.string() }).optional() }))
    .default([]),
})

const Instances = z.object({
  reservations: z
    .array(
      z.object({
        instances: z
          .array(
            z.object({
              instanceId: z.string(),
              instanceType: z.string().optional(),
              state: z.object({ name: z.string().optional() }).optional(),
              launchTime: z.string().optional(),
              tags: Tags,
            }),
          )
          .default([]),
      }),
    )
    .default([]),
})

const NatGateways = z.object({
  natGateways: z
    .array(
      z.object({
        natGatewayId: z.string(),
        state: z.string().optional(),
        vpcId: z.string().optional(),
        tags: Tags,
      }),
    )
    .default([]),
})

// ─── Tiện ích ────────────────────────────────────────────────────────────────

type ScanInput = {
  profile?: string | undefined
  region?: string | undefined
  surface: InfraSurface
  actor?: string | undefined
}

function cliError(run: { stderr: string; exitCode: number | null }): string {
  const detail = run.stderr.trim() || `aws exited with code ${String(run.exitCode)}`
  return detail.slice(0, 600)
}

function nameTag(tags: readonly { key: string; value: string }[] | undefined): string | null {
  return tags?.find((t) => t.key === 'Name')?.value ?? null
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function daysSince(iso: string | undefined, now: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.floor((now - t) / 86_400_000)
}

/** Một lệnh liệt kê. Lớp `read` ⇒ chạy thẳng; `runInfra` vẫn ghi nhật ký như mọi lệnh. */
async function list(
  args: readonly string[],
  input: ScanInput,
  toolName: string,
): Promise<WasteOutcome<unknown>> {
  const run = await runInfra({
    tool: 'aws',
    args: [...args, '--output', 'json'],
    context: {
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.region ? { region: input.region } : {}),
    },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName,
    decision: 'approved',
    timeoutMs: RUN_TIMEOUT_MS,
  })
  if (!run.ok) return { ok: false, error: cliError(run) }
  try {
    return { ok: true, value: lowerFirstKeys(JSON.parse(run.stdout)) }
  } catch {
    return { ok: false, error: 'BAD_OUTPUT' }
  }
}

// ─── Năm phép dò MIỄN PHÍ ────────────────────────────────────────────────────

async function checkEipIdle(input: ScanInput): Promise<WasteOutcome<WasteFinding[]>> {
  const res = await list(['ec2', 'describe-addresses'], input, 'waste_scan')
  if (!res.ok) return res
  const parsed = Addresses.safeParse(res.value)
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }

  const monthlyUsd = monthlyFromHourly(EIP_IDLE_USD_PER_HOUR)
  return {
    ok: true,
    value: parsed.data.addresses
      // Không có `associationId` = không gắn vào đâu. IP ĐANG gắn cũng bị tính tiền từ
      // 2024, nhưng đó không phải lãng phí — nó đang phục vụ một thứ đang chạy.
      .filter((a) => a.associationId === undefined)
      .slice(0, MAX_ITEMS)
      .map((a) => {
        const id = a.allocationId ?? a.publicIp ?? 'unknown'
        return {
          check: 'eip-idle' as const,
          resourceId: id,
          label: nameTag(a.tags) ?? a.publicIp ?? id,
          region: input.region ?? '',
          monthlyUsd,
          overEstimate: false,
          detail: { ip: a.publicIp ?? '' },
        }
      }),
  }
}

async function checkEbsUnattached(input: ScanInput): Promise<WasteOutcome<WasteFinding[]>> {
  const res = await list(
    ['ec2', 'describe-volumes', '--filters', 'Name=status,Values=available'],
    input,
    'waste_scan',
  )
  if (!res.ok) return res
  const parsed = Volumes.safeParse(res.value)
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }

  return {
    ok: true,
    value: parsed.data.volumes.slice(0, MAX_ITEMS).map((v) => {
      const size = v.size ?? 0
      const type = v.volumeType ?? 'gp3'
      return {
        check: 'ebs-unattached' as const,
        resourceId: v.volumeId,
        label: nameTag(v.tags) ?? v.volumeId,
        region: input.region ?? '',
        monthlyUsd: size > 0 ? ebsMonthlyUsd(type, size) : null,
        overEstimate: false,
        detail: { size: `${String(size)} GiB`, type, created: v.createTime ?? '' },
      }
    }),
  }
}

async function checkSnapshotStale(
  input: ScanInput,
  now: number,
): Promise<WasteOutcome<WasteFinding[]>> {
  // `--owner-ids self` BẮT BUỘC: không có nó thì lệnh liệt kê mọi snapshot công khai
  // trên AWS — hàng trăm nghìn dòng, và không cái nào là của người dùng.
  const res = await list(
    ['ec2', 'describe-snapshots', '--owner-ids', 'self'],
    input,
    'waste_scan',
  )
  if (!res.ok) return res
  const parsed = Snapshots.safeParse(res.value)
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }

  const out: WasteFinding[] = []
  for (const s of parsed.data.snapshots) {
    const age = daysSince(s.startTime, now)
    if (age === null || age < SNAPSHOT_STALE_DAYS) continue
    const size = s.volumeSize ?? 0
    out.push({
      check: 'snapshot-stale',
      resourceId: s.snapshotId,
      label: nameTag(s.tags) ?? s.description ?? s.snapshotId,
      region: input.region ?? '',
      // Giá snapshot tính theo phần TĂNG THÊM so với snapshot trước, mà CLI chỉ cho
      // biết kích thước volume gốc ⇒ con số này là TRẦN TRÊN, không phải số thật.
      monthlyUsd: size > 0 ? round2(SNAPSHOT_USD_PER_GB_MONTH * size) : null,
      overEstimate: true,
      detail: { age: `${String(age)}d`, size: `${String(size)} GiB` },
    })
    if (out.length >= MAX_ITEMS) break
  }
  return { ok: true, value: out }
}

async function checkLogsNoRetention(input: ScanInput): Promise<WasteOutcome<WasteFinding[]>> {
  const res = await list(['logs', 'describe-log-groups'], input, 'waste_scan')
  if (!res.ok) return res
  const parsed = LogGroups.safeParse(res.value)
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }

  return {
    ok: true,
    value: parsed.data.logGroups
      // Thiếu `retentionInDays` = "Never expire". Đây là phát hiện mà tiền của nó TĂNG
      // MÃI — con số dưới đây là tiền của phần đang lưu HÔM NAY.
      .filter((g) => g.retentionInDays === undefined)
      .slice(0, MAX_ITEMS)
      .map((g) => {
        const gb = (g.storedBytes ?? 0) / 1024 ** 3
        return {
          check: 'logs-no-retention' as const,
          resourceId: g.logGroupName,
          label: g.logGroupName,
          region: input.region ?? '',
          monthlyUsd: gb > 0 ? round2(gb * LOGS_STORAGE_USD_PER_GB_MONTH) : null,
          overEstimate: false,
          detail: { stored: `${gb.toFixed(2)} GiB` },
        }
      }),
  }
}

async function checkLbNoTargets(input: ScanInput): Promise<WasteOutcome<WasteFinding[]>> {
  const lbRes = await list(['elbv2', 'describe-load-balancers'], input, 'waste_scan')
  if (!lbRes.ok) return lbRes
  const lbs = LoadBalancers.safeParse(lbRes.value)
  if (!lbs.success) return { ok: false, error: 'BAD_OUTPUT' }
  if (lbs.data.loadBalancers.length === 0) return { ok: true, value: [] }

  const tgRes = await list(['elbv2', 'describe-target-groups'], input, 'waste_scan')
  if (!tgRes.ok) return tgRes
  const tgs = TargetGroups.safeParse(tgRes.value)
  if (!tgs.success) return { ok: false, error: 'BAD_OUTPUT' }

  // Đếm đích ĐANG ĐĂNG KÝ cho mỗi LB. Một lời gọi cho mỗi target group là đắt về số
  // tiến trình, nên chỉ hỏi những group CÓ gắn vào một LB.
  const registered = new Map<string, number>()
  for (const tg of tgs.data.targetGroups.slice(0, MAX_ITEMS)) {
    if (tg.loadBalancerArns.length === 0) continue
    const health = await list(
      ['elbv2', 'describe-target-health', '--target-group-arn', tg.targetGroupArn],
      input,
      'waste_scan',
    )
    if (!health.ok) continue
    const parsed = TargetHealth.safeParse(health.value)
    const n = parsed.success ? parsed.data.targetHealthDescriptions.length : 0
    for (const arn of tg.loadBalancerArns) registered.set(arn, (registered.get(arn) ?? 0) + n)
  }

  const monthlyUsd = monthlyFromHourly(LB_USD_PER_HOUR)
  return {
    ok: true,
    value: lbs.data.loadBalancers
      .filter((lb) => (registered.get(lb.loadBalancerArn) ?? 0) === 0)
      .map((lb) => ({
        check: 'lb-no-targets' as const,
        resourceId: lb.loadBalancerArn,
        label: lb.loadBalancerName ?? lb.loadBalancerArn,
        region: input.region ?? '',
        monthlyUsd,
        overEstimate: false,
        detail: { type: lb.type ?? '', state: lb.state?.code ?? '' },
      })),
  }
}

// ─── Hai phép dò TRẢ TIỀN ────────────────────────────────────────────────────

function idleWindow(now: number): { startMs: number; endMs: number } {
  return { startMs: now - IDLE_WINDOW_DAYS * 86_400_000, endMs: now }
}

async function checkEc2Idle(
  input: ScanInput,
  now: number,
): Promise<WasteOutcome<WasteFinding[]>> {
  const res = await list(
    ['ec2', 'describe-instances', '--filters', 'Name=instance-state-name,Values=running'],
    input,
    'waste_scan',
  )
  if (!res.ok) return res
  const parsed = Instances.safeParse(res.value)
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }

  const running = parsed.data.reservations
    .flatMap((r) => r.instances)
    .slice(0, MAX_METRIC_TARGETS)
  if (running.length === 0) return { ok: true, value: [] }

  const win = idleWindow(now)
  const metrics = await getMetricData({
    queries: running.map((i) => ({
      key: i.instanceId,
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      dimensions: [{ name: 'InstanceId', value: i.instanceId }],
      stat: 'Average',
      // Một điểm mỗi ngày: đủ để nói "máy này im suốt hai tuần", và rẻ hơn hai bậc
      // độ lớn so với period 5 phút — `get-metric-data` tính theo metric × ĐIỂM.
      periodSeconds: 86_400,
    })),
    startMs: win.startMs,
    endMs: win.endMs,
    ...(input.profile ? { profile: input.profile } : {}),
    ...(input.region ? { region: input.region } : {}),
    surface: input.surface,
  })
  if (!metrics.ok) return { ok: false, error: metrics.error }

  const out: WasteFinding[] = []
  for (const inst of running) {
    const series = metrics.value.series.find((s) => s.key === inst.instanceId)
    // KHÔNG có điểm nào ⇒ bỏ qua, KHÔNG báo idle. Metric rỗng nghĩa là "không đo
    // được" (máy vừa bật, hoặc thiếu quyền) — báo nó là idle sẽ khuyên người dùng
    // tắt một máy mà ta không biết gì về nó.
    if (!series || series.points.length === 0) continue
    const avg = series.points.reduce((n, p) => n + p.v, 0) / series.points.length
    if (avg >= IDLE_CPU_PERCENT) continue
    out.push({
      check: 'ec2-idle',
      resourceId: inst.instanceId,
      label: nameTag(inst.tags) ?? inst.instanceId,
      region: input.region ?? '',
      monthlyUsd: inst.instanceType ? ec2MonthlyUsd(inst.instanceType) : null,
      overEstimate: false,
      detail: {
        type: inst.instanceType ?? '',
        cpu: `${avg.toFixed(2)}%`,
        window: `${String(IDLE_WINDOW_DAYS)}d`,
      },
    })
  }
  return { ok: true, value: out }
}

async function checkNatIdle(input: ScanInput, now: number): Promise<WasteOutcome<WasteFinding[]>> {
  const res = await list(['ec2', 'describe-nat-gateways'], input, 'waste_scan')
  if (!res.ok) return res
  const parsed = NatGateways.safeParse(res.value)
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }

  const live = parsed.data.natGateways
    .filter((n) => n.state === 'available')
    .slice(0, MAX_METRIC_TARGETS)
  if (live.length === 0) return { ok: true, value: [] }

  const win = idleWindow(now)
  const metrics = await getMetricData({
    queries: live.map((n) => ({
      key: n.natGatewayId,
      namespace: 'AWS/NATGateway',
      metricName: 'BytesOutToDestination',
      dimensions: [{ name: 'NatGatewayId', value: n.natGatewayId }],
      stat: 'Sum',
      periodSeconds: 86_400,
    })),
    startMs: win.startMs,
    endMs: win.endMs,
    ...(input.profile ? { profile: input.profile } : {}),
    ...(input.region ? { region: input.region } : {}),
    surface: input.surface,
  })
  if (!metrics.ok) return { ok: false, error: metrics.error }

  const monthlyUsd = monthlyFromHourly(NAT_USD_PER_HOUR)
  const out: WasteFinding[] = []
  for (const gw of live) {
    const series = metrics.value.series.find((s) => s.key === gw.natGatewayId)
    if (!series || series.points.length === 0) continue
    const total = series.points.reduce((n, p) => n + p.v, 0)
    if (total >= IDLE_NAT_BYTES) continue
    out.push({
      check: 'nat-idle',
      resourceId: gw.natGatewayId,
      label: nameTag(gw.tags) ?? gw.natGatewayId,
      region: input.region ?? '',
      monthlyUsd,
      overEstimate: false,
      detail: {
        vpc: gw.vpcId ?? '',
        bytes: String(Math.round(total)),
        window: `${String(IDLE_WINDOW_DAYS)}d`,
      },
    })
  }
  return { ok: true, value: out }
}

// ─── Điểm vào ────────────────────────────────────────────────────────────────

export type WasteScanInput = ScanInput & {
  /** Phép dò cần chạy. Mặc định: năm phép MIỄN PHÍ — hai phép trả tiền phải xin. */
  checks?: readonly WasteCheck[] | undefined
  /** Cho test bơm thời gian. */
  now?: number | undefined
}

/**
 * Chạy các phép dò được xin và gộp kết quả.
 *
 * MỘT PHÉP DÒ HỎNG KHÔNG LÀM HỎNG CẢ LƯỢT. Thiếu quyền cho `elbv2` là chuyện thường
 * gặp, và nó không nói gì về EIP hay EBS. Nhưng lỗi đó PHẢI đi ra ngoài trong `failed`:
 * một phép dò câm làm bảng trông như đã sạch, và đó là kiểu sai tệ nhất của một màn dò.
 */
export async function runWasteScan(input: WasteScanInput): Promise<WasteOutcome<WasteReport>> {
  const now = input.now ?? Date.now()
  const wanted = input.checks ?? WASTE_CHECKS.filter((c) => !PAID_CHECKS.includes(c))

  const findings: WasteFinding[] = []
  const ran: WasteCheck[] = []
  const failed: { check: WasteCheck; error: string }[] = []

  for (const check of wanted) {
    const res = await runOne(check, input, now)
    if (!res.ok) {
      failed.push({ check, error: res.error })
      continue
    }
    ran.push(check)
    findings.push(...res.value)
  }

  const priced = findings.filter((f) => f.monthlyUsd !== null)
  return {
    ok: true,
    value: {
      findings,
      ran,
      failed,
      totalMonthlyUsd: round2(priced.reduce((n, f) => n + (f.monthlyUsd ?? 0), 0)),
      unpricedCount: findings.length - priced.length,
      region: input.region ?? '',
    },
  }
}

function runOne(
  check: WasteCheck,
  input: ScanInput,
  now: number,
): Promise<WasteOutcome<WasteFinding[]>> {
  switch (check) {
    case 'eip-idle':
      return checkEipIdle(input)
    case 'ebs-unattached':
      return checkEbsUnattached(input)
    case 'snapshot-stale':
      return checkSnapshotStale(input, now)
    case 'logs-no-retention':
      return checkLogsNoRetention(input)
    case 'lb-no-targets':
      return checkLbNoTargets(input)
    case 'ec2-idle':
      return checkEc2Idle(input, now)
    case 'nat-idle':
      return checkNatIdle(input, now)
  }
}
