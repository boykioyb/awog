// Danh mục TÀI NGUYÊN GIÁM SÁT — nguồn của ô chọn ở màn Giám sát.
//
// ⚠ NGUỒN ĐÃ ĐỔI HAI LẦN, VÀ LẦN THỨ HAI LÀ VÌ QUYỀN (2026-09-17).
//
// Bản 1 chỉ liệt kê ALB + EC2, vì màn Giám sát chỉ có bốn biểu đồ ghim cứng
// `AWS/ApplicationELB` + `AWS/EC2` + `CWAgent`. Một hạ tầng ECS Fargate vì thế mở
// màn ra là bốn khung "thiếu dữ liệu" vĩnh viễn.
//
// Bản 2 hỏi từng dịch vụ một: `ecs list-clusters` + `list-services`, `elbv2
// describe-load-balancers`, `rds describe-db-instances`, `sqs list-queues`,
// `ec2 describe-instances`. Đúng về mặt dữ liệu, nhưng nó đòi NĂM quyền khác nhau,
// và một role chỉ-đọc-CloudWatch điển hình không có quyền nào trong số đó. Đo được
// trên role `Offshore-Developer` của người dùng 2026-09-17: cả bốn lệnh đều
// `AccessDenied` (`ecs:ListClusters`, `elasticloadbalancing:DescribeLoadBalancers`,
// `sqs:ListQueues`, `ec2:DescribeInstances`) trong khi `cloudwatch:DescribeAlarms`
// của chính màn đó chạy bình thường — tức là người ta xem được cảnh báo mà không
// chọn nổi một tài nguyên để xem.
//
// BẢN NÀY HỎI CHÍNH CLOUDWATCH: `cloudwatch list-metrics`. MỘT quyền
// (`cloudwatch:ListMetrics`) thay cho năm, và nó còn ĐÚNG HƠN cho việc màn này làm:
// nó chỉ trả về những tài nguyên THẬT SỰ ĐANG PHÁT metric, nên không còn ca chọn
// xong mới biết biểu đồ rỗng. Cái mất: nhãn đẹp (tag `Name` của EC2, engine của
// RDS) — chấp nhận, vì định danh mới là thứ cần để vẽ; và tài nguyên im lặng quá
// 2 tuần sẽ không xuất hiện (CloudWatch chỉ giữ chừng đó lịch sử metric), điều mà
// một màn giám sát coi là đúng chứ không phải thiếu sót.
//
// ⚠ VÀ `cloudwatch:ListMetrics` CŨNG CÓ THỂ BỊ TỪ CHỐI — đo được trên chính role
// đó ngay sau đấy. Nên có ĐƯỜNG LÙI: `describe-alarms` (lệnh mà màn này vẫn gọi,
// và vẫn chạy được) mang sẵn `Namespace` + `Dimensions` trên từng cảnh báo, đủ để
// dựng lại những tài nguyên mà ai đó đã thấy đáng đặt cảnh báo lên. Xem
// `deriveFromAlarms`. Nó KHÔNG đầy đủ, và nhóm dựng từ nó luôn mang cờ `truncated`
// cùng câu lỗi gốc — người dùng phải biết mình đang nhìn một danh sách chắp vá.
//
// NHÓM LOG ĐI ĐƯỜNG RIÊNG (`logs describe-log-groups`) vì nó KHÔNG phải một tài
// nguyên phát metric theo nghĩa thông thường — người ta chọn nó để ĐỌC, và biểu đồ
// `AWS/Logs` chỉ là phần kèm theo. Đây cũng là nhóm cần ÍT quyền nhất, nên trên một
// tài khoản bị siết nó thường là thứ duy nhất còn chọn được.
//
// MỖI MỤC MANG SẴN `dimensions` ĐÚNG NHƯ CLOUDWATCH MUỐN. Đây là điều khoản chính
// của file. Tri thức "CloudWatch gọi tên tài nguyên này là gì" thuộc về đây, không
// thuộc renderer — kể cả ca hai dimension của ECS (`ClusterName` + `ServiceName`),
// thứ mà một bảng một-khoá-một-tên không diễn tả nổi.
//
// MỘT NGUỒN HỎNG KHÔNG LÀM HỎNG CẢ LƯỢT. Mỗi nhóm mang lỗi riêng, UI hiện được
// phần chạy và nói ra phần hỏng.

import { z } from 'zod'
import { runInfra } from './run.js'
import type { InfraSurface } from './audit/store.js'

const RUN_TIMEOUT_MS = 30_000
/** Trần số mục mỗi nhóm — một tài khoản lớn có hàng nghìn EC2 và picker thì không. */
const MAX_ITEMS = 300

/** Loại tài nguyên giám sát được. Quyết định bộ biểu đồ nào được vẽ. */
export const MONITOR_KINDS = ['ecs-service', 'alb', 'rds', 'sqs', 'ec2', 'log-group'] as const
export type MonitorTargetKind = (typeof MONITOR_KINDS)[number]

export type MonitorDimension = { name: string; value: string }

export type MonitorTarget = {
  /** Định danh ổn định, duy nhất xuyên mọi nhóm — giá trị của ô chọn. */
  id: string
  kind: MonitorTargetKind
  /** Chuỗi cho người đọc. */
  label: string
  /** Chuỗi phụ (cluster, loại, trạng thái) — hiện mờ cạnh nhãn. */
  hint: string
  /** ĐÚNG như CloudWatch muốn cho namespace của loại này. */
  dimensions: MonitorDimension[]
}

export type MonitorTargetGroup = {
  kind: MonitorTargetKind
  items: MonitorTarget[]
  /** Lỗi của RIÊNG nhóm này. `''` = chạy được. */
  error: string
  /** Chạm trần ⇒ danh sách chưa đủ, UI phải nói ra. */
  truncated: boolean
}

export type MonitorTargets = { groups: MonitorTargetGroup[] }

export interface MonitorTargetsInput {
  profile?: string | undefined
  region?: string | undefined
  actor?: string | undefined
  surface: InfraSurface
}

// ─── Phép cắt định danh (thuần, test được không cần tài khoản AWS) ──────────

/**
 * `app/my-alb/50dc6c495c0c9188` ⇒ nhãn `my-alb`, gợi ý `app`.
 *
 * Dimension `LoadBalancer` của CloudWatch KHÔNG phải tên load balancer, nó là phần
 * đuôi ARN. Giá trị đó đi nguyên vẹn vào truy vấn; chỗ này chỉ tách ra để hiện.
 * Tiền tố (`app`/`net`/`gwy`) giữ lại làm gợi ý vì ba loại đó dùng ba namespace
 * khác nhau, và người đọc cần phân biệt được.
 */
export function albLabel(dimensionValue: string): { label: string; hint: string } {
  const parts = dimensionValue.split('/')
  return parts.length === 3 && parts[0] && parts[1]
    ? { label: parts[1], hint: parts[0] }
    : { label: dimensionValue, hint: '' }
}

/**
 * Nhóm log ⇒ nhãn ngắn. `/aws/ecs/pwpf-dev-apne1-api` ⇒ `pwpf-dev-apne1-api`, và
 * phần đầu thành gợi ý — danh sách nhóm log thật thường có mươi mục cùng tiền tố,
 * nên tiền tố chiếm chỗ mà không phân biệt được gì.
 */
export function logGroupLabel(name: string): { label: string; hint: string } {
  const at = name.lastIndexOf('/')
  return at > 0 && at < name.length - 1
    ? { label: name.slice(at + 1), hint: name.slice(0, at) }
    : { label: name, hint: '' }
}

/**
 * Rút lỗi của AWS CLI về một câu đọc được.
 *
 * stderr của nó có hình dạng cố định:
 *   `An error occurred (ExpiredToken) when calling the DescribeLoadBalancers
 *    operation: The security token included in the request is expired`
 * Đoạn đầu là khuôn, không mang tin: cái người dùng cần là MÃ và CÂU CUỐI. Giữ
 * nguyên cả dòng thì UI phải hiện một câu dài gấp ba chỗ nó có (lỗi thật
 * 2026-09-16: dòng đó làm vỡ cả thanh công cụ của màn Giám sát).
 *
 * Không khớp khuôn ⇒ trả dòng đầu như cũ: khuôn này là của AWS CLI, không phải
 * hợp đồng, nên nó đổi được và ta không được nuốt lỗi vì thế.
 */
export function shortAwsError(stderr: string): string {
  const line = stderr.split('\n').find((l) => l.trim().length > 0)?.trim() ?? ''
  const m = line.match(/An error occurred \(([^)]+)\)[^:]*:\s*(.+)$/)
  if (m) return `${m[1]}: ${m[2]}`.slice(0, 300)
  return line.slice(0, 300)
}

/**
 * Tên action IAM còn thiếu, rút từ một câu `AccessDenied` của AWS.
 *
 * Bốn câu AccessDenied nối nhau dài gần một nghìn ký tự và lặp lại cùng một ARN
 * bốn lần (ảnh người dùng 2026-09-17); thứ khác nhau giữa chúng chỉ là TÊN ACTION.
 * UI gom danh sách action đó thành một câu, nên phép rút nằm ở đây — cùng nhà với
 * `shortAwsError`, không rải sang renderer.
 *
 * Trả `''` khi câu không phải lỗi quyền: bên gọi phân biệt được "thiếu quyền" với
 * "hết hạn token", và hai thứ đó cần hai lời khuyên khác nhau.
 */
export function deniedAction(error: string): string {
  const m = /not authorized to perform:?\s*([A-Za-z0-9_-]+:[A-Za-z0-9_*-]+)/.exec(error)
  return m?.[1] ?? ''
}

// ─── Lược đồ đầu ra CLI ─────────────────────────────────────────────────────

const ListMetrics = z.object({
  metrics: z
    .array(
      z.object({
        dimensions: z
          .array(z.object({ name: z.string().optional(), value: z.string().optional() }))
          .optional(),
      }),
    )
    .optional(),
  nextToken: z.string().optional(),
})

const Alarms = z.object({
  metricAlarms: z
    .array(
      z.object({
        namespace: z.string().optional(),
        dimensions: z
          .array(z.object({ name: z.string().optional(), value: z.string().optional() }))
          .optional(),
      }),
    )
    .optional(),
})

const LogGroups = z.object({
  logGroups: z
    .array(z.object({ logGroupName: z.string().optional(), storedBytes: z.number().optional() }))
    .optional(),
  nextToken: z.string().optional(),
})

/** `--output json` của AWS CLI trả khoá PascalCase; hạ chữ đầu để khớp schema. */
function lowerFirstKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(lowerFirstKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k.charAt(0).toLowerCase() + k.slice(1)] = lowerFirstKeys(v)
    }
    return out
  }
  return value
}

async function readJson(
  args: readonly string[],
  input: MonitorTargetsInput,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const run = await runInfra({
    tool: 'aws',
    args: [...args, '--output', 'json'],
    context: {
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.region ? { region: input.region } : {}),
    },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'monitor_targets',
    decision: 'auto',
    timeoutMs: RUN_TIMEOUT_MS,
  })
  if (!run.ok) {
    return { ok: false, error: shortAwsError(run.stderr) || 'aws exited without saying why' }
  }
  try {
    return { ok: true, value: lowerFirstKeys(JSON.parse(run.stdout)) }
  } catch {
    return { ok: false, error: 'BAD_OUTPUT' }
  }
}

function failed(kind: MonitorTargetKind, error: string): MonitorTargetGroup {
  return { kind, items: [], error, truncated: false }
}

// ─── Dò tài nguyên qua CloudWatch ───────────────────────────────────────────

/**
 * Một nhóm được dò bằng `list-metrics`: hỏi MỘT metric của MỘT namespace, rồi đọc
 * tài nguyên ra từ chính `Dimensions` của kết quả.
 *
 * `metricName` là một metric MẪU, không phải metric sẽ vẽ — nó chỉ cần là thứ mà
 * mọi tài nguyên loại này đều phát, vì nhiệm vụ của nó là làm câu trả lời NHỎ LẠI.
 * Không ghim metric thì `AWS/EC2` trả về hàng chục nghìn dòng cho cùng một danh
 * sách máy.
 */
type MetricProbe = {
  kind: MonitorTargetKind
  namespace: string
  metricName: string
  /** Tên dimension PHẢI có, đúng và đủ — xem `dimensionsMatch`. */
  dimensionNames: readonly string[]
}

const PROBES: readonly MetricProbe[] = [
  {
    kind: 'ecs-service',
    namespace: 'AWS/ECS',
    metricName: 'CPUUtilization',
    dimensionNames: ['ClusterName', 'ServiceName'],
  },
  {
    kind: 'alb',
    namespace: 'AWS/ApplicationELB',
    metricName: 'RequestCount',
    dimensionNames: ['LoadBalancer'],
  },
  {
    kind: 'rds',
    namespace: 'AWS/RDS',
    metricName: 'CPUUtilization',
    dimensionNames: ['DBInstanceIdentifier'],
  },
  {
    kind: 'sqs',
    namespace: 'AWS/SQS',
    metricName: 'ApproximateNumberOfMessagesVisible',
    dimensionNames: ['QueueName'],
  },
  { kind: 'ec2', namespace: 'AWS/EC2', metricName: 'CPUUtilization', dimensionNames: ['InstanceId'] },
]

/**
 * Tập dimension khớp ĐÚNG VÀ ĐỦ tên mong đợi.
 *
 * ⚠ PHẢI SO BẰNG NHAU, KHÔNG PHẢI "CÓ CHỨA". Cùng một metric được CloudWatch phát
 * ở nhiều mức tổng hợp với các tập dimension khác nhau, và nhận bừa sẽ đẻ ra những
 * mục vô nghĩa trong ô chọn:
 *   · `AWS/ECS CPUUtilization` có cả bản CHỈ `ClusterName` (mức cluster) — "có chứa
 *     ClusterName" sẽ nhận nó vào làm một "service" không tồn tại.
 *   · `AWS/ApplicationELB RequestCount` có bản `{LoadBalancer, TargetGroup}` và bản
 *     `{LoadBalancer, AvailabilityZone}` — mỗi ALB sẽ hiện ra hàng chục lần.
 *   · `AWS/EC2 CPUUtilization` có bản theo `AutoScalingGroupName`, `ImageId`,
 *     `InstanceType` — không cái nào là một máy cụ thể.
 */
export function dimensionsMatch(
  dims: readonly MonitorDimension[],
  expected: readonly string[],
): boolean {
  if (dims.length !== expected.length) return false
  return expected.every((name) => dims.some((d) => d.name === name))
}

async function probeGroup(
  probe: MetricProbe,
  input: MonitorTargetsInput,
): Promise<MonitorTargetGroup> {
  const res = await readJson(
    ['cloudwatch', 'list-metrics', '--namespace', probe.namespace, '--metric-name', probe.metricName],
    input,
  )
  if (!res.ok) return failed(probe.kind, res.error)
  const parsed = ListMetrics.safeParse(res.value)
  if (!parsed.success) return failed(probe.kind, 'BAD_OUTPUT')

  const seen = new Set<string>()
  const items: MonitorTarget[] = []
  let truncated = parsed.data.nextToken !== undefined

  for (const metric of parsed.data.metrics ?? []) {
    const dims: MonitorDimension[] = (metric.dimensions ?? []).flatMap((d) =>
      d.name && d.value ? [{ name: d.name, value: d.value }] : [],
    )
    if (!dimensionsMatch(dims, probe.dimensionNames)) continue

    // Thứ tự dimension trong câu trả lời KHÔNG được bảo đảm, nên sắp lại theo thứ
    // tự đã khai: `id` phải ổn định giữa hai lượt dò, nếu không lựa chọn đang lưu
    // của người dùng trỏ vào hư không sau mỗi lần làm mới.
    const ordered = probe.dimensionNames.flatMap((n) => dims.filter((d) => d.name === n))
    const id = `${probe.kind}:${ordered.map((d) => d.value).join('/')}`
    if (seen.has(id)) continue
    seen.add(id)
    if (items.length >= MAX_ITEMS) {
      truncated = true
      break
    }

    items.push({ id, kind: probe.kind, ...labelFor(probe.kind, ordered), dimensions: ordered })
  }

  return { kind: probe.kind, items, error: '', truncated }
}

/** Nhãn + gợi ý cho một tài nguyên, theo loại. Giá trị dimension là nguồn duy nhất. */
function labelFor(
  kind: MonitorTargetKind,
  dims: readonly MonitorDimension[],
): { label: string; hint: string } {
  const values = dims.map((d) => d.value)
  if (kind === 'ecs-service') {
    // ĐÃ sắp theo `dimensionNames` nên phần tử 0 là cluster, 1 là service.
    return { label: values[1] ?? '', hint: values[0] ?? '' }
  }
  if (kind === 'alb') return albLabel(values[0] ?? '')
  const value = values[0] ?? ''
  if (kind === 'sqs') {
    // Hàng đợi chết (DLQ) đáng được nhận ra ngay trong danh sách: nó là thứ người
    // ta mở màn Giám sát để xem, và tên của nó luôn nói ra điều đó.
    return { label: value, hint: /(^|[-_.])dlq([-_.]|$)|dead-?letter/i.test(value) ? 'DLQ' : '' }
  }
  return { label: value, hint: '' }
}

/**
 * Nhóm log — đường riêng, và là loại DUY NHẤT chọn được khi tài khoản chỉ có quyền
 * đọc log. Nó trả lời thẳng câu "tôi muốn giám sát log CloudWatch thì làm thế nào".
 *
 * `describe-log-groups` là metadata thuần (tên, dung lượng đang lưu, thời hạn giữ),
 * KHÔNG trả về dòng log nào — đó là lý do nó không nằm trong nhóm bị siết ở tài
 * khoản production, và cũng là lý do nó gọi được tự do ở đây.
 */
async function listLogGroups(input: MonitorTargetsInput): Promise<MonitorTargetGroup> {
  const res = await readJson(['logs', 'describe-log-groups'], input)
  if (!res.ok) return failed('log-group', res.error)
  const parsed = LogGroups.safeParse(res.value)
  if (!parsed.success) return failed('log-group', 'BAD_OUTPUT')

  const items: MonitorTarget[] = []
  let truncated = parsed.data.nextToken !== undefined
  for (const g of parsed.data.logGroups ?? []) {
    const name = g.logGroupName ?? ''
    if (!name) continue
    if (items.length >= MAX_ITEMS) {
      truncated = true
      break
    }
    items.push({
      id: `log-group:${name}`,
      kind: 'log-group',
      ...logGroupLabel(name),
      dimensions: [{ name: 'LogGroupName', value: name }],
    })
  }
  return { kind: 'log-group', items, error: '', truncated }
}

/**
 * ĐƯỜNG LÙI: suy tài nguyên từ chính CÁC CẢNH BÁO của tài khoản.
 *
 * VÌ SAO CÓ ĐƯỜNG NÀY. `cloudwatch:ListMetrics` cũng có thể bị từ chối — đo được
 * trên role `Offshore-Developer` 2026-09-17, sau khi năm lệnh `describe-*` của
 * từng dịch vụ đã bị từ chối trước đó. Nhưng `cloudwatch:DescribeAlarms` thì
 * CHẠY (chính màn Giám sát đang liệt kê được ~30 cảnh báo của tài khoản đó), và
 * mỗi cảnh báo mang sẵn `Namespace` + `Dimensions` — tức là đủ để dựng lại đúng
 * những tài nguyên mà ai đó đã thấy đáng đặt cảnh báo lên.
 *
 * KHÔNG THÊM QUYỀN NÀO. Đây là lời gọi mà màn này vẫn gọi ở chỗ khác; đường lùi
 * chỉ chạy khi có probe hỏng, nên tài khoản đủ quyền không phải trả thêm lời gọi.
 *
 * ⚠ NÓ KHÔNG ĐẦY ĐỦ, và đó là bản chất chứ không phải thiếu sót: tài nguyên chưa
 * ai đặt cảnh báo sẽ KHÔNG có mặt. Nhóm dựng từ đây vì thế luôn mang cờ
 * `truncated` — UI nói ra rằng danh sách còn thiếu thay vì để người dùng tin nó đủ.
 */
async function deriveFromAlarms(
  input: MonitorTargetsInput,
): Promise<{ byKind: Map<MonitorTargetKind, MonitorTarget[]>; error: string }> {
  const byKind = new Map<MonitorTargetKind, MonitorTarget[]>()
  const res = await readJson(['cloudwatch', 'describe-alarms'], input)
  if (!res.ok) return { byKind, error: res.error }
  const parsed = Alarms.safeParse(res.value)
  if (!parsed.success) return { byKind, error: 'BAD_OUTPUT' }

  const seen = new Set<string>()
  for (const alarm of parsed.data.metricAlarms ?? []) {
    const probe = PROBES.find((p) => p.namespace === alarm.namespace)
    if (!probe) continue
    const dims: MonitorDimension[] = (alarm.dimensions ?? []).flatMap((d) =>
      d.name && d.value ? [{ name: d.name, value: d.value }] : [],
    )
    if (!dimensionsMatch(dims, probe.dimensionNames)) continue

    const ordered = probe.dimensionNames.flatMap((n) => dims.filter((d) => d.name === n))
    const id = `${probe.kind}:${ordered.map((d) => d.value).join('/')}`
    if (seen.has(id)) continue
    seen.add(id)

    const list = byKind.get(probe.kind) ?? []
    if (list.length >= MAX_ITEMS) continue
    list.push({ id, kind: probe.kind, ...labelFor(probe.kind, ordered), dimensions: ordered })
    byKind.set(probe.kind, list)
  }
  return { byKind, error: '' }
}

/**
 * Sáu nguồn chạy SONG SONG và độc lập — xem đầu file.
 *
 * Thứ tự nhóm trong mảng là thứ tự đọc của picker, và nó CÓ chủ ý: cái người ta mở
 * màn Giám sát để xem đứng trước (service đang chạy, rồi cửa vào, rồi kho dữ liệu,
 * rồi hàng đợi), máy trần gần cuối vì ngày càng ít người có, và nhóm log đứng cuối
 * vì nó là danh sách DÀI nhất ở phần lớn tài khoản.
 *
 * ĐƯỜNG LÙI CHỈ CHẠY KHI CẦN. Probe nào hỏng thì mới đi hỏi cảnh báo, và chỉ MỘT
 * lời gọi `describe-alarms` phục vụ mọi nhóm hỏng. Tài khoản đủ quyền không trả
 * thêm gì; tài khoản thiếu quyền vẫn có cái để chọn thay vì một ô rỗng.
 */
export async function listMonitorTargets(input: MonitorTargetsInput): Promise<MonitorTargets> {
  const [probed, logs] = await Promise.all([
    Promise.all(PROBES.map((p) => probeGroup(p, input))),
    listLogGroups(input),
  ])

  const broken = probed.filter((g) => g.error !== '')
  if (broken.length === 0) return { groups: [...probed, logs] }

  const fallback = await deriveFromAlarms(input)
  const groups = probed.map((g) => {
    if (g.error === '') return g
    const items = fallback.byKind.get(g.kind) ?? []
    if (items.length === 0) return g
    // GIỮ NGUYÊN `error`: danh sách này dựng từ cảnh báo nên nó thiếu, và câu lỗi
    // gốc là thứ nói cho người dùng biết quyền nào còn thiếu để có danh sách đủ.
    // Xoá lỗi đi ở đây là biến một danh sách chắp vá thành một danh sách trông
    // như đầy đủ — đúng kiểu nói dối im lặng mà màn này đã gỡ nhiều lần.
    return { ...g, items, truncated: true }
  })
  return { groups: [...groups, logs] }
}
