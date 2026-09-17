// Page-controller của tab `/infra → Giám sát` (Mốc 6, 6.3 · 6.4).
//
// Toàn bộ state + lời gọi RPC nằm ở đây, SFC chỉ bind — khuôn `useXxxManager()` của
// .claude/rules/nuxt-vue.md §Composable.
//
// NĂM LUẬT CỦA FILE NÀY:
//   1. KHÔNG TỰ CHẠY. Không `watch`, không `onMounted` nào gọi `get-metric-data` sau
//      lưng người dùng — lệnh đó tính tiền theo SỐ METRIC × SỐ ĐIỂM. Chỉ hai đường
//      vào: cú bấm "Nạp" của người dùng, và một khoảng thời gian được gieo từ màn
//      Logs (bản thân việc gieo là một cú bấm ở màn kia). KHÔNG có hẹn giờ.
//   2. MỘT LÔ, MỘT LỜI GỌI. Bốn biểu đồ (8 chuỗi) đi trong ĐÚNG một lời gọi
//      `infra.metrics-query`; chia lô và cache là việc của `sidecar/infra/aws/metrics.ts`.
//      Gọi lẻ từng biểu đồ là nhân hoá đơn lên bốn lần cho cùng lượng dữ liệu.
//   3. CỬA SỔ ĐÓNG BĂNG KHI NẠP. `windowRef` là cửa sổ ĐÃ NẠP; `windowSeconds` là cửa
//      sổ ĐANG chọn. Chúng khác nhau ngay khi người dùng đổi preset mà chưa bấm Nạp,
//      và UI phải nói ra điều đó ("đang xem 3 giờ · đã chọn 1 ngày") — nếu không thì
//      trục hoành nói một đằng, nút bấm nói một nẻo.
//   4. THIẾU DỮ LIỆU LÀ MỘT TRẠNG THÁI. Một chuỗi không có điểm nào KHÔNG được vẽ
//      như 0 và không được im lặng bỏ qua: nó hiện ra là "thiếu dữ liệu", cùng chuỗi
//      chữ với dải cảnh báo. (Ô số nào chưa có nguồn — sẵn sàng 30 ngày, chi phí
//      tháng — cũng nói thẳng là chưa có, không hiện 0.)
//   5. CỔNG QUYỀN KHÔNG ĐƯỢC NHẠI LẠI Ở ĐÂY. `put-metric-alarm` là lệnh GHI: nhận
//      `blocked` + vé ⇒ mở hộp duyệt hạ tầng (`useConfirm kind: 'infra'`) rồi gọi lại
//      ĐÚNG payload kèm vé. Không có đường nào tự khai "người dùng đã duyệt".
import { computed, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useConfirm } from '~/composables/useConfirm'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import { useInfraContext } from '~/composables/useInfraContext'
import { useInfraWindowSync } from '~/composables/useInfraWindowSync'
import { useSidecar } from '~/composables/useSidecar'
import {
  absoluteWindow,
  isWindowValid,
  relativeWindow,
  windowSecondsOf,
  windowToMs,
  type InfraWindow,
} from '~/utils/infra-window'
import { useToast } from '~/composables/useToast'
import { formatBytes } from '~/utils/format-bytes'
import type { InfraActionClass } from '~/composables/useConfirm'
// `InfraBlocked` đã có ở `useInfraResourcesApi` — import chứ không khai lại. Nuxt
// auto-import type từ `composables/`, nên hai bản cùng tên là một cảnh báo trùng
// import cho TOÀN app và bản nào thắng thì không ai đoán được (khuôn `PlaybookSource`
// ở `useShareExport.ts`). Bản ở đây còn LỎNG hơn (`accountKind: string` so với
// `'normal' | 'production'`) vì nó chép hợp đồng dây, mà hợp đồng dây thì chặt hơn.
import type { InfraBlocked } from '~/composables/useInfraResourcesApi'

// ─── Hợp đồng dây (khớp `methods/infra.metrics.ts` + `methods/infra.alarms.ts`) ──

export type WireDimension = { name: string; value: string }
export type WirePoint = { t: number; v: number }

export type WireSeries = {
  key: string
  label: string
  stat: string
  periodSeconds: number
  points: WirePoint[]
}

export type WireQuery = {
  key: string
  namespace: string
  metricName: string
  stat: string
  periodSeconds: number
  dimensions?: WireDimension[]
  unit?: string
  label?: string
}

export type InfraContextWire = { profile?: string; region?: string; accountId?: string }

/** Trạng thái cảnh báo CloudWatch. `insufficient` (thiếu dữ liệu) KHÔNG phải `ok`. */
export type AlarmState = 'alarm' | 'ok' | 'insufficient'

export type WireAlarm = {
  name: string
  arn: string
  state: AlarmState
  stateReason: string
  stateUpdatedAt: number | null
  metricName: string | null
  namespace: string | null
  dimensions: WireDimension[]
  stat: string | null
  periodSeconds: number | null
  comparisonOperator: string | null
  threshold: number | null
  evaluationPeriods: number | null
  treatMissingData: string | null
  actionsEnabled: boolean
}

export type WireAlarmHistoryEntry = { at: number | null; type: string; summary: string }

export type ComparisonOperator =
  | 'GreaterThanThreshold'
  | 'GreaterThanOrEqualToThreshold'
  | 'LessThanThreshold'
  | 'LessThanOrEqualToThreshold'

export type TreatMissingData = 'breaching' | 'notBreaching' | 'ignore' | 'missing'

export type AlarmPutParams = {
  context: InfraContextWire
  name: string
  namespace: string
  metricName: string
  dimensions?: WireDimension[]
  stat: string
  periodSeconds: number
  evaluationPeriods: number
  threshold: number
  comparisonOperator: ComparisonOperator
  treatMissingData: TreatMissingData
  alarmDescription?: string
  alarmActions?: string[]
  approvalTicket?: string
}

type MetricsWire =
  | { ok: true; series: WireSeries[]; fromCache: number; calls: number }
  | { ok: false; error: string }

type AlarmsWire =
  | { ok: true; alarms: WireAlarm[]; truncated: boolean }
  | { ok: false; error: string }

type HistoryWire =
  | { ok: true; entries: WireAlarmHistoryEntry[]; truncated: boolean }
  | { ok: false; error: string }

/** Kết cục của `alarm-put`: ba nhánh phân biệt được bằng `ok` + `blocked`. */
export type AlarmPutOutcome =
  | { ok: true; command: string }
  | (InfraBlocked & { ok: false })
  | { ok: false; blocked: false; error: string }

type PutWire =
  | {
      blocked: true
      requiresApproval: boolean
      approvalTicket?: string
      command: string
      class: string
      accountKind: string
      mode: string
      reason: string
    }
  | {
      blocked: false
      command: string
      class: string
      accountKind: string
      decision: string
      result: { ok: boolean; stdout: string; stderr: string }
    }

/** Vỏ mỏng kiểu-hoá quanh ba RPC. Một hàm một method — khuôn `useInfraCicdApi`. */
function api() {
  const sc = useSidecar()
  return {
    metrics: (p: {
      context: InfraContextWire
      startMs: number
      endMs: number
      queries: WireQuery[]
      force?: boolean
    }): Promise<MetricsWire> => sc.request<MetricsWire>('infra.metrics-query', p),

    alarms: (p: {
      context: InfraContextWire
      stateFilter?: AlarmState
      limit?: number
    }): Promise<AlarmsWire> => sc.request<AlarmsWire>('infra.alarm-list', p),

    history: (p: {
      context: InfraContextWire
      alarmName: string
      limit?: number
    }): Promise<HistoryWire> => sc.request<HistoryWire>('infra.alarm-history', p),

    put: async (p: AlarmPutParams): Promise<AlarmPutOutcome> => {
      const res = await sc.request<PutWire>('infra.alarm-put', p)
      // `PutWire` chép hợp đồng DÂY nên ở đó `accountKind`/`mode` chỉ là `string` —
      // đúng, vì dây là dữ liệu chưa tin. `AlarmPutOutcome` thì chở bản CHẶT (hộp
      // duyệt đổi màu theo `accountKind`, cổng quyền đọc thẳng `mode`), nên thu hẹp
      // ngay tại biên thay vì để giá trị lạ đi tiếp vào hai chỗ đó.
      if (res.blocked) {
        return {
          ...res,
          accountKind: res.accountKind === 'production' ? 'production' : 'normal',
          // Giá trị lạ ⇒ `'ask'`: còn vé thì vẫn mời gọi lại được, còn `'auto'` sẽ
          // khai rằng lệnh đã tự chạy — điều ta không biết.
          mode: (['auto', 'ask', 'block'] as const).find((m) => m === res.mode) ?? 'ask',
          ok: false,
        }
      }
      if (!res.result.ok) {
        const detail = res.result.stderr.trim() || 'aws rejected the command'
        return { ok: false, blocked: false, error: detail.slice(0, 600) }
      }
      return { ok: true, command: res.command }
    },
  }
}

// ─── Trần + bảng tra ────────────────────────────────────────────────────────

/** Trần chuỗi của một lượt nạp — khớp `MAX_SERIES_PER_REQUEST` của sidecar. */
export const MAX_MONITOR_SERIES = 24
/** Trần cảnh báo đưa lên dải. Khớp `MAX_ALARM_LIMIT` của sidecar. */
export const MAX_MONITOR_ALARMS = 100

/**
 * Bước nhóm theo độ dài cửa sổ. Mọi giá trị đều là bội của 60 — CloudWatch chỉ nhận
 * 1/5/10/30 giây hoặc bội của phút, và một bước sai KHÔNG báo lỗi mà trả về rỗng
 * (biểu đồ trắng không kèm lời giải thích). Trần điểm cũng là trần TIỀN: cửa sổ 7
 * ngày ở bước 60 giây là hơn một vạn điểm cho MỖI metric.
 */
export function periodForWindow(windowSeconds: number): number {
  if (windowSeconds <= 900) return 60
  if (windowSeconds <= 6 * 3600) return 300
  if (windowSeconds <= 2 * 86_400) return 3600
  return 21_600
}

// ─── Danh mục biểu đồ, theo LOẠI tài nguyên ─────────────────────────────────
//
// VÌ SAO KHÔNG CÒN "BỐN BIỂU ĐỒ" (2026-09-17). Bản trước ghim cứng đúng bốn khung
// đọc `AWS/ApplicationELB` + `AWS/EC2` + `CWAgent`, tức là giả định mọi người đều
// chạy một website sau ALB trên máy EC2 có cài CloudWatch agent. Một hạ tầng ECS
// Fargate + RDS + SQS — không một máy EC2 nào — vì thế mở màn ra là bốn khung
// "thiếu dữ liệu" vĩnh viễn trong khi AWS hoàn toàn khoẻ (lỗi thật, ảnh người
// dùng 2026-09-17). Nay người dùng chọn MỘT tài nguyên, và bộ biểu đồ bám theo
// LOẠI của nó.
//
// DIMENSION KHÔNG CÒN Ở ĐÂY. Mỗi `MonitorTarget` do sidecar trả về đã mang sẵn
// mảng `dimensions` đúng như CloudWatch muốn — kể cả ca hai dimension của ECS
// (`ClusterName` + `ServiceName`), thứ mà bảng `TARGET_DIMENSIONS` một-khoá-một-tên
// cũ không diễn tả nổi. Tri thức "CloudWatch gọi tên tài nguyên này là gì" thuộc
// về `sidecar/infra/monitor-targets.ts`, không thuộc renderer.
//
// BA LUẬT VẼ giữ nguyên và áp cho MỌI bộ dưới đây:
//   1. KHÔNG hai trục y — hai thang đo khác nhau thì hai khung, chung trục thời gian.
//   2. Dữ liệu CÓ THỨ TỰ (p50<p95<p99, trung bình<đỉnh) dùng MỘT hue nhiều bậc đậm
//      nhạt; hai HẠNG MỤC rời (đọc/ghi, gửi/xoá) mới được hai màu.
//   3. Màu trạng thái (`--danger`/`--amber`/`--green`) là của riêng trạng thái,
//      không bộ nào mượn làm chuỗi dữ liệu.
//
// MỖI KHUNG MỘT NGUỒN. Chuỗi nào cần một namespace khác (RAM của EC2 đến từ
// `CWAgent`, số task của ECS đến từ `ECS/ContainerInsights`) thì đứng RIÊNG một
// khung, không ghép chung với chuỗi luôn có. Ghép vào thì một nửa rỗng làm cả
// khung đọc ra thành hỏng — chính là điều bản trước làm với "Sức tải máy (CPU/RAM)".

/** Loại tài nguyên giám sát được — khớp `MONITOR_KINDS` của sidecar. */
export const MONITOR_KINDS = ['ecs-service', 'alb', 'rds', 'sqs', 'ec2', 'log-group'] as const
export type MonitorTargetKind = (typeof MONITOR_KINDS)[number]

/** Một tài nguyên chọn được, đúng hình dạng sidecar trả về. */
export type MonitorTarget = {
  id: string
  kind: MonitorTargetKind
  label: string
  hint: string
  dimensions: WireDimension[]
}

export type MonitorSeriesSpec = {
  key: string
  namespace: string
  metricName: string
  stat: string
  label: string
  /** Màu `var(--…)` — SVG không nhận `var()` trong thuộc tính, chỉ trong CSS/`:style`. */
  color: string
  /** Bậc đậm nhạt cho dữ liệu CÓ THỨ TỰ (p50 < p95 < p99): một hue, nhiều bậc. */
  shade: number
}

export type MonitorChartSpec = {
  key: string
  kind: 'line' | 'area' | 'bar'
  unit: string
  series: MonitorSeriesSpec[]
}

/** Một chuỗi, viết gọn — năm bộ dưới đây khai gần trăm chuỗi và cú pháp object đầy
 *  đủ cho mỗi cái làm chìm mất thứ đáng đọc (metric nào, thống kê nào). */
function sr(
  key: string,
  namespace: string,
  metricName: string,
  stat: string,
  label: string,
  color: string,
  shade = 1,
): MonitorSeriesSpec {
  return { key, namespace, metricName, stat, label, color, shade }
}

const ECS = 'AWS/ECS'
const ECS_INSIGHTS = 'ECS/ContainerInsights'
const ALB = 'AWS/ApplicationELB'
const RDS = 'AWS/RDS'
const SQS = 'AWS/SQS'
const EC2 = 'AWS/EC2'
const LOGS = 'AWS/Logs'
const CW_AGENT = 'CWAgent'

/**
 * Bộ biểu đồ của từng loại tài nguyên.
 *
 * `key` DUY NHẤT XUYÊN MỌI BỘ (tiền tố là loại), vì nó vừa là khoá i18n
 * `infra.monitoring.chart.<key>` vừa là danh tính của ngưỡng và của bản nháp cảnh
 * báo. Hai loại cùng có "cpu" mà trùng khoá thì tiêu đề của loại này rơi vào biểu
 * đồ của loại kia.
 */
export const MONITOR_CATALOG: Record<MonitorTargetKind, readonly MonitorChartSpec[]> = {
  // ECS service — ba câu hỏi của một service đang chạy: nó có bận không (CPU), nó
  // có sắp hết bộ nhớ không (RAM), và có đủ bản chạy không (số task).
  'ecs-service': [
    {
      key: 'ecs-cpu',
      kind: 'line',
      unit: 'Percent',
      series: [
        sr('ecs-cpu-avg', ECS, 'CPUUtilization', 'Average', 'trung bình', 'var(--accent)', 0.45),
        sr('ecs-cpu-max', ECS, 'CPUUtilization', 'Maximum', 'đỉnh', 'var(--accent)', 1),
      ],
    },
    {
      key: 'ecs-memory',
      kind: 'line',
      unit: 'Percent',
      series: [
        sr('ecs-mem-avg', ECS, 'MemoryUtilization', 'Average', 'trung bình', 'var(--blue)', 0.45),
        sr('ecs-mem-max', ECS, 'MemoryUtilization', 'Maximum', 'đỉnh', 'var(--blue)', 1),
      ],
    },
    {
      // ⚠ `ECS/ContainerInsights` CHỈ tồn tại khi cluster đã bật Container Insights.
      // Chưa bật thì khung này ghi "thiếu dữ liệu" — đúng sự thật, và là lý do nó
      // đứng riêng thay vì ghép vào khung CPU ngay trên.
      key: 'ecs-tasks',
      kind: 'line',
      unit: 'Count',
      series: [
        sr(
          'ecs-task-run',
          ECS_INSIGHTS,
          'RunningTaskCount',
          'Average',
          'đang chạy',
          'var(--accent)',
        ),
        sr(
          'ecs-task-want',
          ECS_INSIGHTS,
          'DesiredTaskCount',
          'Average',
          'mong muốn',
          'var(--violet)',
        ),
      ],
    },
  ],

  // ALB — cửa vào: có ai gọi không, gọi có lỗi không, gọi có chậm không.
  alb: [
    {
      key: 'alb-calls',
      kind: 'area',
      unit: 'Count',
      series: [sr('alb-req', ALB, 'RequestCount', 'Sum', 'RequestCount', 'var(--accent)')],
    },
    {
      // Hai nguồn lỗi KHÁC NHAU nên hai màu: `Target_5XX` là ứng dụng trả lỗi,
      // `ELB_5XX` là chính load balancer không với tới ứng dụng. Gộp làm một con số
      // là xoá mất phân biệt đắt giá nhất của khung này.
      key: 'alb-errors',
      kind: 'bar',
      unit: 'Count',
      series: [
        sr('alb-5xx-target', ALB, 'HTTPCode_Target_5XX_Count', 'Sum', 'ứng dụng', 'var(--accent)'),
        sr('alb-5xx-elb', ALB, 'HTTPCode_ELB_5XX_Count', 'Sum', 'load balancer', 'var(--violet)'),
      ],
    },
    {
      key: 'alb-latency',
      kind: 'line',
      unit: 'Seconds',
      series: [
        sr('alb-p50', ALB, 'TargetResponseTime', 'p50', 'p50', 'var(--blue)', 0.4),
        sr('alb-p95', ALB, 'TargetResponseTime', 'p95', 'p95', 'var(--blue)', 0.7),
        sr('alb-p99', ALB, 'TargetResponseTime', 'p99', 'p99', 'var(--blue)', 1),
      ],
    },
    {
      key: 'alb-4xx',
      kind: 'bar',
      unit: 'Count',
      series: [
        sr('alb-4xx-target', ALB, 'HTTPCode_Target_4XX_Count', 'Sum', '4XX', 'var(--accent)'),
      ],
    },
  ],

  // RDS — bốn câu hỏi của một cơ sở dữ liệu: bận không, bao nhiêu kết nối, còn chỗ
  // không, đọc/ghi có chậm không.
  rds: [
    {
      key: 'rds-cpu',
      kind: 'line',
      unit: 'Percent',
      series: [sr('rds-cpu-avg', RDS, 'CPUUtilization', 'Average', 'CPU', 'var(--accent)')],
    },
    {
      key: 'rds-connections',
      kind: 'line',
      unit: 'Count',
      series: [
        sr(
          'rds-conn-avg',
          RDS,
          'DatabaseConnections',
          'Average',
          'trung bình',
          'var(--blue)',
          0.45,
        ),
        sr('rds-conn-max', RDS, 'DatabaseConnections', 'Maximum', 'đỉnh', 'var(--blue)', 1),
      ],
    },
    {
      key: 'rds-storage',
      kind: 'area',
      unit: 'Bytes',
      series: [sr('rds-free', RDS, 'FreeStorageSpace', 'Average', 'còn trống', 'var(--accent)')],
    },
    {
      // Đọc và ghi là hai HẠNG MỤC rời (khác đường đi trong máy), không phải hai bậc
      // của một thang ⇒ hai màu tách bạch.
      key: 'rds-latency',
      kind: 'line',
      unit: 'Seconds',
      series: [
        sr('rds-read', RDS, 'ReadLatency', 'Average', 'đọc', 'var(--accent)'),
        sr('rds-write', RDS, 'WriteLatency', 'Average', 'ghi', 'var(--violet)'),
      ],
    },
  ],

  // SQS — hàng đợi chỉ có ba câu hỏi, và câu thứ hai (tuổi tin cũ nhất) là câu duy
  // nhất phân biệt được "đang bận" với "đang tắc".
  sqs: [
    {
      key: 'sqs-depth',
      kind: 'area',
      unit: 'Count',
      series: [
        sr(
          'sqs-visible',
          SQS,
          'ApproximateNumberOfMessagesVisible',
          'Average',
          'đang chờ',
          'var(--accent)',
        ),
        sr(
          'sqs-inflight',
          SQS,
          'ApproximateNumberOfMessagesNotVisible',
          'Average',
          'đang xử lý',
          'var(--violet)',
        ),
      ],
    },
    {
      key: 'sqs-age',
      kind: 'line',
      unit: 'Seconds',
      series: [
        sr(
          'sqs-age-max',
          SQS,
          'ApproximateAgeOfOldestMessage',
          'Maximum',
          'tin cũ nhất',
          'var(--blue)',
        ),
      ],
    },
    {
      key: 'sqs-flow',
      kind: 'bar',
      unit: 'Count',
      series: [
        sr('sqs-sent', SQS, 'NumberOfMessagesSent', 'Sum', 'gửi vào', 'var(--accent)'),
        sr('sqs-deleted', SQS, 'NumberOfMessagesDeleted', 'Sum', 'xử lý xong', 'var(--violet)'),
      ],
    },
  ],

  // Nhóm log — loại tài nguyên DUY NHẤT chọn được khi tài khoản chỉ có quyền đọc
  // log (role `Offshore-Developer` của người dùng bị chặn mọi `describe-*` của
  // ECS/ELB/SQS/EC2, đo 2026-09-17). Hai biểu đồ này đo LƯU LƯỢNG GHI, không đo
  // nội dung — câu "có lỗi gì" do khối đọc log bên dưới trả lời, và với loại này
  // nó trỏ thẳng vào chính nhóm đang chọn, không phải đoán.
  'log-group': [
    {
      key: 'log-events',
      kind: 'area',
      unit: 'Count',
      series: [sr('log-events', LOGS, 'IncomingLogEvents', 'Sum', 'dòng ghi vào', 'var(--accent)')],
    },
    {
      key: 'log-bytes',
      kind: 'area',
      unit: 'Bytes',
      series: [
        sr('log-bytes', LOGS, 'IncomingBytes', 'Sum', 'dung lượng ghi vào', 'var(--violet)'),
      ],
    },
  ],

  // EC2 — máy trần. CPU luôn có; RAM thì KHÔNG: nó đến từ CloudWatch agent chạy
  // TRÊN máy đó, nên nó đứng riêng một khung (xem ghi chú "mỗi khung một nguồn").
  ec2: [
    {
      key: 'ec2-cpu',
      kind: 'line',
      unit: 'Percent',
      series: [sr('ec2-cpu-avg', EC2, 'CPUUtilization', 'Average', 'CPU', 'var(--accent)')],
    },
    {
      key: 'ec2-memory',
      kind: 'line',
      unit: 'Percent',
      series: [sr('ec2-mem', CW_AGENT, 'mem_used_percent', 'Average', 'RAM', 'var(--violet)')],
    },
    {
      key: 'ec2-network',
      kind: 'area',
      unit: 'Bytes',
      series: [
        sr('ec2-net-in', EC2, 'NetworkIn', 'Sum', 'vào', 'var(--accent)'),
        sr('ec2-net-out', EC2, 'NetworkOut', 'Sum', 'ra', 'var(--violet)'),
      ],
    },
  ],
}

/** Mọi chuỗi của mọi bộ — dùng để tra ngược từ `key` về quy cách vẽ. */
const SPEC_BY_SERIES_KEY: ReadonlyMap<
  string,
  { chart: MonitorChartSpec; series: MonitorSeriesSpec }
> = new Map(
  Object.values(MONITOR_CATALOG).flatMap((charts) =>
    charts.flatMap((chart) =>
      chart.series.map((series) => [series.key, { chart, series }] as const),
    ),
  ),
)

/** Quy cách vẽ của một chuỗi bất kỳ, tra bằng `key`. `null` = key không thuộc bộ nào. */
export function seriesSpecByKey(
  key: string,
): { chart: MonitorChartSpec; series: MonitorSeriesSpec } | null {
  return SPEC_BY_SERIES_KEY.get(key) ?? null
}

/** Bản nháp `put-metric-alarm`: mọi trường AWS cần, đều sửa được trước khi ghi. */
export type AlarmDraft = {
  chartKey: string
  name: string
  namespace: string
  metricName: string
  stat: string
  periodSeconds: number
  unit: string
  comparisonOperator: ComparisonOperator
  threshold: number
  evaluationPeriods: number
  treatMissingData: TreatMissingData
  alarmDescription: string
  alarmActions: string
  /** Cảnh báo đang ghi đè — `null` là tạo mới. */
  editing: string | null
}

/** Chuỗi đầu tiên của biểu đồ — cái mà nút "Tạo cảnh báo" nhắm tới. */
export function primarySeries(spec: MonitorChartSpec): MonitorSeriesSpec {
  return spec.series[spec.series.length - 1] ?? spec.series[0]!
}

// ─── Định dạng (thuần, dùng chung cho chart + ô số + panel) ─────────────────

/** Số theo đúng lượng tử của nó: giây hiện 2 chữ số thập phân, đếm hiện số nguyên
 *  có dấu phân cách. `null` ⇒ '—' (chưa đo được, KHÁC hẳn 0). */
export function formatMetricValue(v: number | null, unit: string): string {
  if (v === null || !Number.isFinite(v)) return '—'
  if (unit === 'Count') return Math.round(v).toLocaleString()
  if (unit === 'Seconds') return v < 1 ? `${(v * 1000).toFixed(0)} ms` : `${v.toFixed(2)} s`
  if (unit === 'Percent') return `${v.toFixed(1)} %`
  // Dung lượng đọc bằng bậc 1024, không bằng số chữ số: `128849018880` không nói
  // lên điều gì, `120 GB` thì có. Thang dùng chung ở `utils/format-bytes.ts`.
  if (unit === 'Bytes') return formatBytes(v)
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/** Nhãn trục thời gian: cửa sổ ngắn hiện giờ-phút, cửa sổ dài hiện ngày-giờ. */
export function formatAxisTime(ms: number, windowSeconds: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (windowSeconds <= 36 * 3600) return `${hh}:${mm}`
  const dd = String(d.getDate()).padStart(2, '0')
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mo} ${hh}:${mm}`
}

/** Khoảng dài bao nhiêu, viết bằng giờ/ngày — dùng ở dòng "đang xem …". */
export function formatSpanSeconds(seconds: number): string {
  if (seconds < 3600) return `${String(Math.round(seconds / 60))}m`
  if (seconds < 86_400) return `${String(Math.round(seconds / 3600))}h`
  return `${String(Math.round(seconds / 86_400))}d`
}

/**
 * Trung bình của một chuỗi — mốc so sánh cho ô số. Bỏ qua điểm `null` (đã bị sidecar
 * lọc) và trả `null` cho chuỗi rỗng: "bình thường 0" trên một metric chưa từng có
 * điểm là bịa ra một đường cơ sở không tồn tại.
 */
export function seriesMean(points: readonly WirePoint[]): number | null {
  if (points.length === 0) return null
  return points.reduce((sum, p) => sum + p.v, 0) / points.length
}

/** Tổng của các điểm rơi vào `[fromMs, ∞)`. */
export function seriesSumSince(points: readonly WirePoint[], fromMs: number): number | null {
  const hit = points.filter((p) => p.t >= fromMs)
  if (hit.length === 0) return null
  return hit.reduce((sum, p) => sum + p.v, 0)
}

/** Giá trị của điểm cuối cùng — "hiện tại" của một chuỗi. */
export function seriesLast(points: readonly WirePoint[]): number | null {
  return points.length > 0 ? points[points.length - 1]!.v : null
}

// ─── Ô số ───────────────────────────────────────────────────────────────────

export type TileState = 'ok' | 'unavailable'
export type MonitorTile = {
  key: string
  label: string
  value: string
  /** Mốc so sánh ("bình thường 0,38 s"). Số trần trụi không nói lên điều gì. */
  baseline: string | null
  state: TileState
  /** Vì sao ô này chưa có số — chỉ có mặt khi `state === 'unavailable'`. */
  note: string | null
}

// ─── Biểu đồ đã dựng ────────────────────────────────────────────────────────

export type ChartSeriesView = {
  key: string
  label: string
  color: string
  shade: number
  points: WirePoint[]
  /** Không có điểm nào ⇒ UI nói ra, không vẽ như 0. */
  missing: boolean
}

export type IncidentBand = { startMs: number; endMs: number; label: string }

export type ChartThreshold = { value: number; label: string; editable: boolean }

export type ChartView = {
  key: string
  title: string
  kind: 'line' | 'area' | 'bar'
  unit: string
  series: ChartSeriesView[]
  /** Có ít nhất một chuỗi có điểm. */
  hasData: boolean
  /** Có chuỗi rỗng lẫn chuỗi có điểm — "vẽ được một phần". */
  partial: boolean
}

export type MonitorSeriesView = {
  key: string
  namespace: string
  metricName: string
  stat: string
  periodSeconds: number
  label: string
  unit: string
}

export function useInfraMetrics() {
  const { t } = useI18n()
  const toast = useToast()
  const sc = useSidecar()
  const rpc = api()
  const { confirm } = useConfirm()
  const { askAgent } = useInfraAskAgent()
  const infraContext = useInfraContext({ sessionId: null })
  const bridge = useInfraWindowSync()

  const context = computed<InfraContextWire>(() => {
    const e = infraContext.effective.value
    return {
      ...(e.profile ? { profile: e.profile } : {}),
      ...(e.region ? { region: e.region } : {}),
      ...(e.accountId ? { accountId: e.accountId } : {}),
    }
  })
  const hasAccount = computed(() => Boolean(context.value.profile))

  // ── Tài nguyên đang xem ──────────────────────────────────────────────────
  //
  // MỘT tài nguyên, và nó quyết định CẢ bộ biểu đồ. Bản trước có hai ô ("ALB nào"
  // + "EC2 nào") đều mặc định RỖNG, mà truy vấn không kèm dimension thì ALB/EC2
  // không phát chuỗi nào ⇒ trạng thái mặc định của màn được BẢO ĐẢM là bốn khung
  // trắng. Nay chưa chọn thì màn nói thẳng là phải chọn, chứ không vẽ bốn cái
  // khung rỗng rồi để người dùng đoán mình làm sai ở đâu.
  const target = ref<MonitorTarget | null>(null)

  /** Bộ biểu đồ của loại tài nguyên đang chọn. Chưa chọn ⇒ rỗng, và màn nói ra. */
  const activeCharts = computed<readonly MonitorChartSpec[]>(() =>
    target.value ? MONITOR_CATALOG[target.value.kind] : [],
  )

  /**
   * Đổi tài nguyên ⇒ VỨT số liệu cũ.
   *
   * Không vứt thì hai chuyện xảy ra, cả hai đều là nói dối im lặng: đổi sang loại
   * KHÁC thì khoá chuỗi không khớp nên mọi khung ghi "thiếu dữ liệu" (sự thật là
   * "chưa nạp"), còn đổi sang tài nguyên CÙNG LOẠI thì khoá khớp y nguyên và màn
   * vẽ số liệu của service A dưới cái tên service B. `watch` chứ không phải một
   * cú gọi trong handler: tài nguyên đổi được từ chỗ khác (khôi phục lựa chọn,
   * đổi profile), và mọi đường đổi đều phải vứt.
   */
  watch(
    () => target.value?.id ?? '',
    () => {
      loadedSeries.value = []
      windowRef.value = null
      loadedAt.value = null
      calls.value = 0
      partialKeys.value = []
      error.value = ''
      draft.value = null
      historyName.value = null
    },
  )

  /**
   * Dimension của tài nguyên đang chọn — sidecar đã dựng sẵn đúng như CloudWatch
   * muốn (kể cả ca hai dimension của ECS), nên ở đây không còn phép cắt chuỗi nào.
   */
  const activeDimensions = computed<WireDimension[]>(() => target.value?.dimensions ?? [])

  // ── Cửa sổ thời gian (đang chọn) ─────────────────────────────────────────
  // Model dùng chung (`InfraTimeRange` v-model vào `win`). Mặc định 3 giờ gần đây.
  const win = ref<InfraWindow>(relativeWindow(3 * 3600))

  const windowSeconds = computed(() => windowSecondsOf(win.value))

  function resolveWindow(): { startMs: number; endMs: number } | null {
    return windowToMs(win.value)
  }

  // ── Trạng thái nạp ──────────────────────────────────────────────────────
  const loading = ref(false)
  const error = ref('')
  /** Cửa sổ ĐÃ NẠP. `null` = chưa nạp gì. Xem luật 3 ở đầu file. */
  const windowRef = ref<{ startMs: number; endMs: number } | null>(null)
  const loadedAt = ref<number | null>(null)
  const fromCache = ref(0)
  const calls = ref(0)
  /** Chuỗi nào AWS nói `PartialData` — UI phải nói ra chứ không vẽ im. */
  const partialKeys = ref<string[]>([])

  const seriesByKey = computed<Map<string, WireSeries>>(() => {
    const map = new Map<string, WireSeries>()
    for (const s of loadedSeries.value) map.set(s.key, s)
    return map
  })
  const loadedSeries = ref<WireSeries[]>([])

  /** Cửa sổ đã chọn khác cửa sổ đã nạp ⇒ số trên màn KHÔNG còn ứng với thứ đang chọn. */
  const windowDirty = computed(() => {
    const w = resolveWindow()
    const loaded = windowRef.value
    if (!w || !loaded) return false
    // Preset luôn tính từ `Date.now()` nên lệch vài giây là bình thường; chỉ báo
    // "lệch" khi độ DÀI đổi hoặc khoảng dịch đi quá một bước nhóm.
    return Math.abs(w.endMs - w.startMs - (loaded.endMs - loaded.startMs)) > 1000
  })

  const windowValid = computed(() => isWindowValid(win.value))

  const windowLabel = computed(() => formatSpanSeconds(windowSeconds.value))

  // ── Biểu đồ ──────────────────────────────────────────────────────────────
  const periodSeconds = computed(() => periodForWindow(windowSeconds.value || 3600))

  /** Một chuỗi ⇒ một `MetricDataQuery`; `key` là danh tính duy nhất toàn màn.
   *  `unit` thuộc về BIỂU ĐỒ chứ không thuộc từng chuỗi (mọi chuỗi của một biểu đồ
   *  chung một đơn vị — trộn giây với phần trăm vào một trục là biểu đồ vô nghĩa),
   *  nên nó vào qua tham số thay vì lặp lại trên từng spec. */
  function specToQuery(s: MonitorSeriesSpec, unit: string): WireQuery {
    const dims = activeDimensions.value
    return {
      key: s.key,
      namespace: s.namespace,
      metricName: s.metricName,
      stat: s.stat,
      periodSeconds: periodSeconds.value,
      ...(dims.length > 0 ? { dimensions: dims } : {}),
      unit,
      label: s.label,
    }
  }

  const charts = computed<ChartView[]>(() => {
    const byKey = seriesByKey.value
    return activeCharts.value.map((spec) => {
      const series: ChartSeriesView[] = spec.series.map((s) => {
        const got = byKey.get(s.key)
        return {
          key: s.key,
          label: s.label,
          color: s.color,
          shade: s.shade,
          points: got?.points ?? [],
          missing: (got?.points ?? []).length === 0,
        }
      })
      const withData = series.filter((s) => !s.missing).length
      return {
        key: spec.key,
        title: t(`infra.monitoring.chart.${spec.key}`),
        kind: spec.kind,
        unit: spec.unit,
        series,
        hasData: withData > 0,
        partial: withData > 0 && withData < series.length,
      }
    })
  })

  /** Quy cách vẽ của từng chuỗi — panel cảnh báo cần namespace/metric/stat/period. */
  const seriesViews = computed<MonitorSeriesView[]>(() =>
    activeCharts.value.flatMap((c) =>
      c.series.map((s) => ({
        key: s.key,
        namespace: s.namespace,
        metricName: s.metricName,
        stat: s.stat,
        periodSeconds: periodSeconds.value,
        label: s.label,
        unit: c.unit,
      })),
    ),
  )

  // ── Cảnh báo ─────────────────────────────────────────────────────────────
  //
  // BA VIỆC PHẢI TÁCH, VÌ TRỘN CHÚNG LẠI LÀ CÁCH MÀN NÀY TỪNG BÁO ĐỘNG SAI.
  // Bản trước đổ nguyên 100 cảnh báo của cả region lên một dải phẳng. Trong ảnh
  // người dùng 2026-09-17, bốn dòng ĐỎ "ĐANG BÁO" đều là `TargetTracking-…-AlarmLow`
  // — cảnh báo scale-in do Application Auto Scaling tự sinh, ở trạng thái ALARM
  // nghĩa là "tải đang thấp hơn ngưỡng thu nhỏ", tức là BÌNH THƯỜNG. Bên dưới là
  // ~26 chip xanh đẩy biểu đồ ra khỏi màn hình.
  //
  //   1. Cảnh báo của TÀI NGUYÊN ĐANG XEM lên trước — đó là thứ người ta mở màn ra
  //      để xem, và nó so bằng `dimensions`, không bằng tên.
  //   2. Cảnh báo HẠ TẦNG TỰ QUẢN (`TargetTracking-…`) tách thành nhóm riêng, KHÔNG
  //      tính vào "đang báo": chúng là cần gạt của autoscaling, không phải sự cố.
  //   3. Phần còn lại của tài khoản gộp thành một con số, mở ra khi người dùng muốn.
  const alarms = ref<WireAlarm[]>([])
  const alarmsLoaded = ref(false)
  const alarmsTruncated = ref(false)

  /**
   * Cảnh báo do Application Auto Scaling tự tạo.
   *
   * AWS đặt tên theo khuôn `TargetTracking-<resourceId>-Alarm{High,Low}-<uuid>`;
   * khuôn đó là hợp đồng đặt tên của dịch vụ, không phải do người dùng gõ. `AlarmLow`
   * ở trạng thái ALARM là trạng thái NGHỈ của một cụm đang chạy dưới ngưỡng — gọi nó
   * là sự cố thì mọi hệ thống rảnh rỗi đều đang cháy.
   *
   * ⚠ Đây là phép đoán theo TÊN, và nó là phép đoán duy nhất có được:
   * `describe-alarms` không trả trường nào nói "cái này do autoscaling tạo". Vì vậy
   * chúng bị TÁCH RA chứ không bị GIẤU ĐI — người dùng vẫn mở được nhóm này.
   */
  function isAutoScalingAlarm(a: WireAlarm): boolean {
    return /^TargetTracking-/.test(a.name)
  }

  /** Cảnh báo này nói về ĐÚNG tài nguyên đang chọn không? So bằng dimension.
   *
   *  So theo TẬP CON chứ không theo bằng nhau: một alarm trên ECS service có đủ
   *  `ClusterName` + `ServiceName`, nhưng alarm trên ALB lại thường mang thêm
   *  `TargetGroup` mà `MonitorTarget` không có. Đòi hai tập trùng khít sẽ loại đúng
   *  những cảnh báo sát sườn nhất. */
  function matchesTarget(a: WireAlarm): boolean {
    const want = activeDimensions.value
    if (want.length === 0) return false
    return want.every((w) => a.dimensions.some((d) => d.name === w.name && d.value === w.value))
  }

  /** Ba rổ, loại trừ nhau, phủ hết danh sách. */
  const alarmGroups = computed(() => {
    const mine: WireAlarm[] = []
    const scaling: WireAlarm[] = []
    const others: WireAlarm[] = []
    for (const a of alarms.value) {
      if (isAutoScalingAlarm(a)) scaling.push(a)
      else if (matchesTarget(a)) mine.push(a)
      else others.push(a)
    }
    return { mine, scaling, others }
  })

  /** Cảnh báo của tài nguyên đang xem — dải trên đầu màn chỉ hiện nhóm này. */
  const targetAlarms = computed<WireAlarm[]>(() => alarmGroups.value.mine)

  /** Số cảnh báo còn lại của tài khoản, gộp thành một con số. */
  const otherAlarmCount = computed(() => alarmGroups.value.others.length)
  /** Số cần gạt autoscaling đang bật — hiện ra được, nhưng KHÔNG tô đỏ. */
  const scalingAlarmCount = computed(() => alarmGroups.value.scaling.length)

  const alarmsByState = computed(() => ({
    alarm: targetAlarms.value.filter((a) => a.state === 'alarm'),
    ok: targetAlarms.value.filter((a) => a.state === 'ok'),
    insufficient: targetAlarms.value.filter((a) => a.state === 'insufficient'),
  }))

  const worstState = computed<AlarmState>(() => {
    if (!alarmsLoaded.value) return 'insufficient'
    const g = alarmsByState.value
    if (g.alarm.length > 0) return 'alarm'
    if (g.ok.length > 0) return 'ok'
    return 'insufficient'
  })

  /**
   * Dải sự cố vẽ trên MỘT khung — khung nào có metric khớp cảnh báo đó.
   *
   * Bản trước trả về một mảng duy nhất và SFC bind nó cho cả bốn khung, nên một
   * cảnh báo ECS được tô thành vệt "sự cố" phủ lên biểu đồ độ trễ ALB. Ba thứ
   * không liên quan gì đến nhau.
   *
   * Nguồn: những cảnh báo ĐANG ở trạng thái `alarm`. `stateUpdatedAt` là mốc duy nhất
   * có cấu trúc mà `describe-alarms` trả cho ta — câu `StateReason` là văn xuôi tiếng
   * Anh của AWS, cắt chuỗi đó ra để đoán thời gian là đoán mò. Một sự cố đã qua (alarm
   * đã về `ok`) vì thế KHÔNG hiện thành dải, trừ khi cửa sổ vẫn đang xem nó.
   * Kéo dài tới `endMs` của cửa sổ: sự cố chưa kết thúc thì dải chưa được phép kết
   * thúc, nếu không mắt đọc thành "đã xong lúc này".
   */
  const incidentsByChart = computed<Record<string, IncidentBand[]>>(() => {
    const win = windowRef.value
    const out: Record<string, IncidentBand[]> = {}
    for (const spec of activeCharts.value) out[spec.key] = []
    if (!win) return out

    for (const a of targetAlarms.value) {
      if (a.state !== 'alarm') continue
      const start = Math.max(a.stateUpdatedAt ?? win.startMs, win.startMs)
      const end = Math.min(win.endMs, Math.max(start + 60_000, win.endMs))
      if (end <= start) continue
      for (const spec of activeCharts.value) {
        const hit = spec.series.some(
          (sp) => sp.namespace === a.namespace && sp.metricName === a.metricName,
        )
        if (hit) out[spec.key]?.push({ startMs: start, endMs: end, label: a.name })
      }
    }
    return out
  })

  /** Cảnh báo khớp một chuỗi metric — để vẽ ngưỡng đã có lên biểu đồ.
   *
   *  So CẢ dimension, không chỉ namespace + metricName. Tài khoản có ba ALB thì bản
   *  cũ vẽ lên biểu đồ ngưỡng của một ALB BẤT KỲ trong ba cái, và `openDraft` mở ra
   *  form sửa đúng cái cảnh báo sai đó. */
  function alarmForSeries(s: MonitorSeriesSpec): WireAlarm | null {
    return (
      targetAlarms.value.find(
        (a) =>
          a.namespace === s.namespace &&
          a.metricName === s.metricName &&
          a.threshold !== null &&
          a.state !== 'insufficient',
      ) ?? null
    )
  }

  // ── Ô số ─────────────────────────────────────────────────────────────────
  //
  // MỘT Ô CHO MỖI BIỂU ĐỒ: giá trị MỚI NHẤT của chuỗi chính, kèm trung bình của
  // chính cửa sổ đang xem làm mốc. Không có bảng cứng nào ở đây, nên hàng ô số
  // theo được mọi loại tài nguyên mà không cần một nhánh `if kind ===` nào.
  //
  // HAI Ô CŨ ĐÃ BỊ GỠ. `availability30d` và `costMonth` ghim cứng `'—'` từ ngày
  // viết, tức một NỬA hàng chỉ để trang trí; riêng ô chi phí còn ghi "Cost Explorer
  // chưa được nối" trong khi `sidecar/infra/cost/cost.ts` đang gọi thật
  // `ce get-cost-and-usage` và tab Chi phí chạy được — một câu sai để lại trên màn.
  // Chi phí có màn riêng và trả lời được nhiều hơn một con số, nên nó ở lại bên đó.
  const tiles = computed<MonitorTile[]>(() => {
    const byKey = seriesByKey.value
    return activeCharts.value.map((spec) => {
      const primary = primarySeries(spec)
      const got = byKey.get(primary.key)
      const points = got?.points ?? []
      const now = seriesLast(points)
      const mean = seriesMean(points)
      return {
        key: spec.key,
        label: t(`infra.monitoring.chart.${spec.key}`),
        value: formatMetricValue(now, spec.unit),
        baseline:
          mean === null
            ? null
            : t('infra.monitoring.tile.baseline', { v: formatMetricValue(mean, spec.unit) }),
        state: points.length === 0 ? 'unavailable' : 'ok',
        note: points.length === 0 ? t('infra.monitoring.missing') : null,
      }
    })
  })

  // ── Nạp ─────────────────────────────────────────────────────────────────
  async function loadAlarms(): Promise<void> {
    const res = await rpc.alarms({ context: context.value, limit: MAX_MONITOR_ALARMS })
    if (!res.ok) {
      // Dải cảnh báo hỏng KHÔNG được làm trắng phần số liệu: hai nguồn độc lập.
      alarmsLoaded.value = false
      toast.add({
        title: t('infra.monitoring.alarm.loadFailed'),
        description: res.error,
        color: 'error',
      })
      return
    }
    alarms.value = res.alarms
    alarmsTruncated.value = res.truncated
    alarmsLoaded.value = true
  }

  /**
   * Nạp số liệu + cảnh báo. `force` CHỈ đến từ cú bấm "Nạp lại" — nó bỏ qua cache
   * của sidecar, tức là trả tiền lại cho cùng một cửa sổ.
   */
  async function load(force = false): Promise<void> {
    if (!sc.available || loading.value) return
    if (!hasAccount.value) {
      error.value = t('infra.monitoring.noProfile')
      return
    }
    // CHƯA CHỌN TÀI NGUYÊN THÌ KHÔNG NẠP. Bản trước vẫn gửi truy vấn không kèm
    // dimension, và CloudWatch trả về rỗng mà KHÔNG báo lỗi — nên người dùng trả
    // tiền cho một lời gọi rồi nhận về bốn khung trắng không ai giải thích.
    if (!target.value) {
      error.value = t('infra.monitoring.target.required')
      return
    }
    const win = resolveWindow()
    if (!win) {
      error.value = t('infra.monitoring.badWindow')
      return
    }
    const queries = activeCharts.value.flatMap((c) => c.series.map((sp) => specToQuery(sp, c.unit)))
    if (queries.length > MAX_MONITOR_SERIES) {
      error.value = t('infra.monitoring.tooManySeries')
      return
    }

    loading.value = true
    error.value = ''
    try {
      // MỘT lời gọi cho MỌI chuỗi của bộ (luật 2). Lô + cache nằm ở sidecar.
      const res = await rpc.metrics({
        context: context.value,
        startMs: win.startMs,
        endMs: win.endMs,
        queries,
        ...(force ? { force: true } : {}),
      })
      if (!res.ok) {
        error.value = res.error
        return
      }
      loadedSeries.value = res.series
      fromCache.value = res.fromCache
      calls.value = res.calls
      windowRef.value = win
      loadedAt.value = Date.now()
      // `PartialData` là chuyện của từng chuỗi; bắt từ điểm đã bóc: thiếu hẳn điểm ở
      // ĐUÔI chính là dấu hiệu AWS chưa kịp tổng hợp.
      partialKeys.value = res.series
        .filter(
          (s) =>
            s.points.length > 0 &&
            s.points[s.points.length - 1]!.t < win.endMs - 2 * periodSeconds.value * 1000,
        )
        .map((s) => s.key)
      await loadAlarms()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  /** "Nạp lại" — bỏ qua cache. Chỉ nơi này truyền `force`. */
  async function reload(): Promise<void> {
    await load(true)
  }

  // ── Kéo ngưỡng → đặt cảnh báo (6.4) ─────────────────────────────────────

  /** Bản nháp `put-metric-alarm`. Mọi trường AWS cần đều có mặt và sửa được. */
  const draft = ref<AlarmDraft | null>(null)

  /** Sửa một trường của bản nháp. Panel cảnh báo KHÔNG giữ bản sao — hai bản sao là
   *  hai chỗ để ngưỡng vừa kéo trên biểu đồ lệch với ngưỡng sắp gửi lên AWS. */
  function patchDraft(patch: Partial<AlarmDraft>): void {
    const d = draft.value
    if (d) Object.assign(d, patch)
  }

  const savingAlarm = ref(false)

  /** Tên cảnh báo mặc định: đọc ra được metric nào, thống kê nào, mức nào. */
  function defaultAlarmName(s: MonitorSeriesSpec, threshold: number): string {
    const raw = `${s.metricName}-${s.stat}-${String(threshold)}`
    // AWS chỉ nhận chữ, số và `-_.`; tên sinh tự động phải hợp lệ NGAY, không để
    // người dùng bấm Lưu rồi mới nhận `BAD_ALARM_NAME`.
    return raw.replace(/[^\w.-]/g, '-').slice(0, 255)
  }

  /**
   * Mở bản nháp cho một biểu đồ.
   *
   * Ngưỡng mặc định: mức đã có của một cảnh báo trùng metric nếu có, không thì
   * TRUNG BÌNH của chuỗi trong cửa sổ (một mức giữa dải đọc được ngay là hợp lý hay
   * vô lý; một mức 0 ở đáy biểu đồ thì không).
   */
  function openDraft(chartKey: string, seriesKey?: string): void {
    const spec = activeCharts.value.find((c) => c.key === chartKey)
    if (!spec) return
    const primary = seriesKey
      ? (spec.series.find((s) => s.key === seriesKey) ?? primarySeries(spec))
      : primarySeries(spec)
    const existing = alarmForSeries(primary)
    if (existing) {
      draft.value = {
        chartKey,
        name: existing.name,
        namespace: existing.namespace ?? primary.namespace,
        metricName: existing.metricName ?? primary.metricName,
        stat: existing.stat ?? primary.stat,
        periodSeconds: existing.periodSeconds ?? periodSeconds.value,
        unit: spec.unit,
        comparisonOperator:
          (existing.comparisonOperator as ComparisonOperator) ?? 'GreaterThanThreshold',
        threshold: existing.threshold ?? 0,
        evaluationPeriods: existing.evaluationPeriods ?? 1,
        treatMissingData: (existing.treatMissingData as TreatMissingData) ?? 'missing',
        alarmDescription: existing.stateReason || '',
        alarmActions: '',
        editing: existing.name,
      }
      return
    }
    const got = seriesByKey.value.get(primary.key)
    const base = got ? seriesMean(got.points) : null
    draft.value = {
      chartKey,
      name: defaultAlarmName(primary, 0),
      namespace: primary.namespace,
      metricName: primary.metricName,
      stat: primary.stat,
      periodSeconds: periodSeconds.value,
      unit: spec.unit,
      comparisonOperator: 'GreaterThanThreshold',
      threshold: base ?? 0,
      evaluationPeriods: 1,
      treatMissingData: 'missing',
      alarmDescription: '',
      alarmActions: '',
      editing: null,
    }
  }

  function closeDraft(): void {
    draft.value = null
  }

  /** Kéo tay nắm trên biểu đồ. Tên tự sinh bám theo ngưỡng cho tới khi người dùng
   *  tự sửa tên — nếu không thì bản nháp nào cũng tên `…-Average-0`. */
  function setThreshold(value: number): void {
    const d = draft.value
    if (!d) return
    d.threshold = value
    if (d.editing === null) {
      const spec = activeCharts.value.find((c) => c.key === d.chartKey)
      const primary = spec
        ? spec.series.find((s) => s.key === d.chartKey || s.metricName === d.metricName)
        : null
      if (spec && primary && d.name === defaultAlarmName(primary, d.threshold)) return
      if (primary) d.name = defaultAlarmName(primary, value)
    }
  }

  /** Ngưỡng vẽ trên khung: bản nháp (kéo được) hoặc cảnh báo đã có (đứng yên). */
  const thresholds = computed<Record<string, ChartThreshold | null>>(() => {
    const out: Record<string, ChartThreshold | null> = {}
    for (const c of activeCharts.value) {
      const d = draft.value
      if (d && d.chartKey === c.key) {
        out[c.key] = { value: d.threshold, label: d.name, editable: true }
        continue
      }
      const alarm = alarmForSeries(primarySeries(c))
      out[c.key] =
        alarm && alarm.threshold !== null
          ? { value: alarm.threshold, label: alarm.name, editable: false }
          : null
    }
    return out
  })

  /**
   * Ghi cảnh báo. Đây là lệnh GHI nên có thể bị cổng quyền chặn: lần đầu không kèm
   * vé, nhận `blocked` ⇒ hỏi người dùng qua hộp duyệt hạ tầng dùng chung ⇒ gọi lại
   * ĐÚNG payload kèm vé. Vé không bao giờ do UI tự phát.
   */
  async function saveDraft(): Promise<boolean> {
    const d = draft.value
    if (!d || savingAlarm.value) return false
    if (!hasAccount.value) {
      toast.add({ title: t('infra.monitoring.noProfile'), color: 'error' })
      return false
    }
    const dims = activeDimensions.value
    const payload: AlarmPutParams = {
      context: context.value,
      name: d.name.trim(),
      namespace: d.namespace,
      metricName: d.metricName,
      ...(dims.length > 0 ? { dimensions: dims } : {}),
      stat: d.stat,
      periodSeconds: d.periodSeconds,
      evaluationPeriods: d.evaluationPeriods,
      threshold: d.threshold,
      comparisonOperator: d.comparisonOperator,
      treatMissingData: d.treatMissingData,
      ...(d.alarmDescription.trim() ? { alarmDescription: d.alarmDescription.trim() } : {}),
      ...(d.alarmActions.trim() ? { alarmActions: splitActions(d.alarmActions) } : {}),
    }

    savingAlarm.value = true
    try {
      const first = await rpc.put(payload)
      if (first.ok) {
        toast.add({ title: t('infra.monitoring.alarm.saved', { name: d.name }), color: 'success' })
        draft.value = null
        await loadAlarms()
        return true
      }
      if (!first.blocked) {
        toast.add({
          title: t('infra.monitoring.alarm.saveFailed'),
          description: first.error,
          color: 'error',
        })
        return false
      }
      const ticket = await confirmBlocked(first, d.name)
      if (!ticket) return false

      const second = await rpc.put({ ...payload, approvalTicket: ticket })
      if (!second.ok) {
        toast.add({
          title: t('infra.monitoring.alarm.saveFailed'),
          description: second.blocked ? second.reason : second.error,
          color: 'error',
        })
        return false
      }
      toast.add({ title: t('infra.monitoring.alarm.saved', { name: d.name }), color: 'success' })
      draft.value = null
      await loadAlarms()
      return true
    } catch (err) {
      toast.add({
        title: t('infra.monitoring.alarm.saveFailed'),
        description: err instanceof Error ? err.message : String(err),
        color: 'error',
      })
      return false
    } finally {
      savingAlarm.value = false
    }
  }

  /** `a, b ,c` ⇒ ba ARN. Cắt khoảng trắng và bỏ mảnh rỗng. */
  function splitActions(raw: string): string[] {
    return raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5)
  }

  /**
   * Hộp duyệt hạ tầng dùng chung (ADR 0088 §5). Vé chỉ trả về khi cổng quyền THẬT SỰ
   * phát vé; `requiresApproval: false` ⇒ hộp chỉ còn nút chép lệnh và ta không gọi lại.
   */
  async function confirmBlocked(res: InfraBlocked, target: string): Promise<string | null> {
    const cls = (['read', 'write', 'destructive'] as const).find((c) => c === res.class) ?? 'write'
    const base = {
      kind: 'infra' as const,
      action: t('infra.monitoring.alarm.confirmAction'),
      target,
      command: res.command,
      context: { ...context.value },
      accountKind: res.accountKind === 'production' ? ('production' as const) : ('normal' as const),
      class: cls as InfraActionClass,
    }
    if (!res.requiresApproval || !res.approvalTicket) {
      await confirm({ ...base, consequence: res.reason, blocked: true })
      return null
    }
    const ok = await confirm({ ...base, consequence: res.reason })
    return ok ? res.approvalTicket : null
  }

  // ── Lịch sử cảnh báo ────────────────────────────────────────────────────
  const historyName = ref<string | null>(null)
  const historyEntries = ref<WireAlarmHistoryEntry[]>([])
  const historyLoading = ref(false)

  async function openHistory(name: string): Promise<void> {
    historyName.value = name
    historyEntries.value = []
    historyLoading.value = true
    try {
      const res = await rpc.history({ context: context.value, alarmName: name, limit: 50 })
      if (!res.ok) {
        toast.add({
          title: t('infra.monitoring.alarm.historyLoadFailed'),
          description: res.error,
          color: 'error',
        })
        return
      }
      historyEntries.value = res.entries
    } finally {
      historyLoading.value = false
    }
  }

  function closeHistory(): void {
    historyName.value = null
    historyEntries.value = []
  }

  // ── Cầu nối thời gian với Logs ───────────────────────────────────────────

  /** Áp một khoảng TUYỆT ĐỐI được gieo từ màn Logs (một cú kéo ở kia = một cửa sổ ở đây). */
  function applyWindow(startMs: number, endMs: number): void {
    win.value = absoluteWindow(startMs, endMs)
  }

  // Khoảng gieo TỪ màn Logs sang. Một cú kéo ở màn kia = một lượt nạp ở màn này —
  // KHÔNG phải vòng lặp nền, và `consumeWindow` xoá ngay để lần vào tab sau không áp
  // lại một khoảng cũ.
  watch(
    bridge.pendingMonitoring,
    (seed) => {
      if (!seed) return
      const got = bridge.consumeWindow('monitoring')
      if (!got) return
      applyWindow(got.startMs, got.endMs)
      void load(false)
    },
    { immediate: true },
  )

  /** Gieo cửa sổ ĐÃ NẠP sang màn Logs rồi để trang chuyển tab (xem header
   *  `useInfraWindowSync.ts` — phần chuyển tab thuộc `pages/infra.vue`). */
  function sendToLogs(): boolean {
    const win = windowRef.value
    if (!win) return false
    return bridge.pushWindow('logs', win.startMs, win.endMs, t('infra.monitoring.bridge.note'))
  }

  // ── Câu hỏi gợi ý ───────────────────────────────────────────────────────

  /** Ảnh chụp số liệu đang xem, dạng văn bản — đủ để agent trả lời có căn cứ. */
  function snapshotText(): string {
    const win = windowRef.value
    if (!win) return ''
    const lines = [
      `Cửa sổ: ${new Date(win.startMs).toISOString()} → ${new Date(win.endMs).toISOString()}`,
      `Ngữ cảnh: profile=${context.value.profile ?? '—'} region=${context.value.region ?? '—'}`,
      `Tài nguyên: ${target.value ? `${target.value.kind} ${target.value.label}` : '(chưa chọn)'}`,
    ]
    for (const c of charts.value) {
      lines.push('', `## ${c.title} (${c.unit})`)
      for (const s of c.series) {
        if (s.missing) {
          lines.push(`- ${s.label}: THIẾU DỮ LIỆU`)
          continue
        }
        lines.push(
          `- ${s.label}: min ${formatMetricValue(Math.min(...s.points.map((p) => p.v)), c.unit)} · ` +
            `max ${formatMetricValue(Math.max(...s.points.map((p) => p.v)), c.unit)} · ` +
            `cuối ${formatMetricValue(s.points[s.points.length - 1]!.v, c.unit)}`,
        )
      }
    }
    const firing = alarmsByState.value.alarm
    lines.push('', `## Cảnh báo đang báo (${String(firing.length)})`)
    for (const a of firing) lines.push(`- ${a.name}: ${a.stateReason || 'không có lý do'}`)
    return lines.join('\n')
  }

  const askSuggestions = computed(() => [
    { key: 'spike', text: t('infra.monitoring.ask.spike') },
    { key: 'week', text: t('infra.monitoring.ask.week') },
    { key: 'incident', text: t('infra.monitoring.ask.incident') },
  ])

  async function ask(text: string): Promise<void> {
    const snapshot = snapshotText()
    if (!snapshot) {
      await askAgent(text, t('infra.monitoring.title'))
      return
    }
    await askAgent(`${text}\n\n\`\`\`\n${snapshot}\n\`\`\``, t('infra.monitoring.title'))
  }

  return {
    // ngữ cảnh
    context,
    hasAccount,
    sidecarAvailable: computed(() => sc.available),
    // tài nguyên
    target,
    activeCharts,
    // cửa sổ
    win,
    windowSeconds,
    windowLabel,
    windowValid,
    windowDirty,
    windowRef,
    applyWindow,
    sendToLogs,
    // nạp
    loading,
    error,
    load,
    reload,
    loadedAt,
    fromCache,
    calls,
    partialKeys,
    periodSeconds,
    // biểu đồ
    charts,
    seriesViews,
    incidentsByChart,
    thresholds,
    // cảnh báo
    alarms,
    alarmsLoaded,
    alarmsTruncated,
    alarmsByState,
    targetAlarms,
    otherAlarmCount,
    scalingAlarmCount,
    worstState,
    // ô số
    tiles,
    // bản nháp
    draft,
    patchDraft,
    savingAlarm,
    openDraft,
    closeDraft,
    setThreshold,
    saveDraft,
    // lịch sử
    historyName,
    historyEntries,
    historyLoading,
    openHistory,
    closeHistory,
    // hỏi agent
    askSuggestions,
    ask,
  }
}
