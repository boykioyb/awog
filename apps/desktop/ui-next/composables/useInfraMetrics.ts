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

// ─── Bốn biểu đồ ────────────────────────────────────────────────────────────

/** Tài nguyên để gắn dimension. Một cửa sổ chỉ có hai thứ này vì bốn biểu đồ của
 *  màn nói về đúng hai loại tài nguyên: cân bằng tải và máy chủ. */
export type MonitorTargetKey = 'lb' | 'instance'

export const TARGET_DIMENSIONS: Record<MonitorTargetKey, string> = {
  lb: 'LoadBalancer',
  instance: 'InstanceId',
}

export type MonitorSeriesSpec = {
  key: string
  namespace: string
  metricName: string
  stat: string
  label: string
  target: MonitorTargetKey
  /** Màu `var(--…)` — SVG không nhận `var()` trong thuộc tính, chỉ trong CSS/`:style`. */
  color: string
  /** Bậc đậm nhạt cho dữ liệu CÓ THỨ TỰ (p50 < p95 < p99): một hue, ba bậc. */
  shade: number
}

export type MonitorChartSpec = {
  key: string
  kind: 'line' | 'area' | 'bar'
  unit: string
  series: MonitorSeriesSpec[]
}

/**
 * Bốn biểu đồ của spec, và luật vẽ đã áp sẵn:
 *   · Lượt gọi và tỉ lệ lỗi KHÔNG ghép chung khung (hai thang đo khác nhau ⇒ hai
 *     khung, chung một trục thời gian).
 *   · p50/p95/p99 là THANG BẬC ⇒ MỘT hue (`--blue`) ba bậc đậm nhạt, không phải ba
 *     màu. Danh tính vẫn đọc được nhờ nhãn ghi thẳng ở cuối đường.
 *   · CPU/RAM là hai HẠNG MỤC rời ⇒ hai màu tách bạch, và KHÔNG mượn màu trạng thái
 *     (`--danger`/`--amber`/`--green`) làm chuỗi thứ tư.
 */
export const MONITOR_CHARTS: readonly MonitorChartSpec[] = [
  {
    key: 'calls',
    kind: 'area',
    unit: 'Count',
    series: [
      {
        key: 'calls',
        namespace: 'AWS/ApplicationELB',
        metricName: 'RequestCount',
        stat: 'Sum',
        label: 'RequestCount',
        target: 'lb',
        color: 'var(--accent)',
        shade: 1,
      },
    ],
  },
  {
    key: 'errors',
    kind: 'bar',
    unit: 'Count',
    series: [
      {
        key: 'errors',
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_Target_5XX_Count',
        stat: 'Sum',
        label: '5XX',
        target: 'lb',
        color: 'var(--accent)',
        shade: 1,
      },
    ],
  },
  {
    key: 'latency',
    kind: 'line',
    unit: 'Seconds',
    series: [
      {
        key: 'p50',
        namespace: 'AWS/ApplicationELB',
        metricName: 'TargetResponseTime',
        stat: 'p50',
        label: 'p50',
        target: 'lb',
        color: 'var(--blue)',
        shade: 0.4,
      },
      {
        key: 'p95',
        namespace: 'AWS/ApplicationELB',
        metricName: 'TargetResponseTime',
        stat: 'p95',
        label: 'p95',
        target: 'lb',
        color: 'var(--blue)',
        shade: 0.7,
      },
      {
        key: 'p99',
        namespace: 'AWS/ApplicationELB',
        metricName: 'TargetResponseTime',
        stat: 'p99',
        label: 'p99',
        target: 'lb',
        color: 'var(--blue)',
        shade: 1,
      },
    ],
  },
  {
    key: 'compute',
    kind: 'line',
    unit: 'Percent',
    series: [
      {
        key: 'cpu',
        namespace: 'AWS/EC2',
        metricName: 'CPUUtilization',
        stat: 'Average',
        label: 'CPU',
        target: 'instance',
        color: 'var(--accent)',
        shade: 1,
      },
      {
        key: 'ram',
        namespace: 'CWAgent',
        metricName: 'mem_used_percent',
        stat: 'Average',
        label: 'RAM',
        target: 'instance',
        color: 'var(--violet)',
        shade: 1,
      },
    ],
  },
]

/** Bản nháp `put-metric-alarm`: mọi trường AWS cần, đều sửa được trước khi ghi. */
export type AlarmDraft = {
  chartKey: string
  name: string
  namespace: string
  metricName: string
  stat: string
  periodSeconds: number
  unit: string
  target: MonitorTargetKey
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
  // Hai ô nhập, không có picker tự động: màn này KHÔNG tự đi dò tài nguyên (mỗi lượt
  // dò là một loạt lời gọi AWS nữa). Người dùng dán tên tài nguyên từ màn Explorer.
  // Bỏ trống ⇒ truy vấn không kèm dimension (hợp lệ, và trả về rỗng ⇒ hiện "thiếu
  // dữ liệu", đúng sự thật hơn là đòi người dùng gõ trước mới cho xem gì).
  const targets = ref<Record<MonitorTargetKey, string>>({ lb: '', instance: '' })

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

  function dimensionsFor(target: MonitorTargetKey): WireDimension[] {
    const value = targets.value[target].trim()
    return value ? [{ name: TARGET_DIMENSIONS[target], value }] : []
  }

  /** Một chuỗi ⇒ một `MetricDataQuery`; `key` là danh tính duy nhất toàn màn.
   *  `unit` thuộc về BIỂU ĐỒ chứ không thuộc từng chuỗi (mọi chuỗi của một biểu đồ
   *  chung một đơn vị — trộn giây với phần trăm vào một trục là biểu đồ vô nghĩa),
   *  nên nó vào qua tham số thay vì lặp lại trên từng spec. */
  function specToQuery(s: MonitorSeriesSpec, unit: string): WireQuery {
    const dims = dimensionsFor(s.target)
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
    return MONITOR_CHARTS.map((spec) => {
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
    MONITOR_CHARTS.flatMap((c) =>
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
  const alarms = ref<WireAlarm[]>([])
  const alarmsLoaded = ref(false)
  const alarmsTruncated = ref(false)

  const alarmsByState = computed(() => ({
    alarm: alarms.value.filter((a) => a.state === 'alarm'),
    ok: alarms.value.filter((a) => a.state === 'ok'),
    insufficient: alarms.value.filter((a) => a.state === 'insufficient'),
  }))

  const worstState = computed<AlarmState>(() => {
    if (!alarmsLoaded.value) return 'insufficient'
    const g = alarmsByState.value
    if (g.alarm.length > 0) return 'alarm'
    if (g.ok.length > 0) return 'ok'
    return 'insufficient'
  })

  /**
   * Dải sự cố vẽ trên CẢ BỐN khung.
   *
   * Nguồn: những cảnh báo ĐANG ở trạng thái `alarm`. `stateUpdatedAt` là mốc duy nhất
   * có cấu trúc mà `describe-alarms` trả cho ta — câu `StateReason` là văn xuôi tiếng
   * Anh của AWS, cắt chuỗi đó ra để đoán thời gian là đoán mò. Một sự cố đã qua (alarm
   * đã về `ok`) vì thế KHÔNG hiện thành dải, trừ khi cửa sổ vẫn đang xem nó.
   * Kéo dài tới `endMs` của cửa sổ: sự cố chưa kết thúc thì dải chưa được phép kết
   * thúc, nếu không mắt đọc thành "đã xong lúc này".
   */
  const incidents = computed<IncidentBand[]>(() => {
    const win = windowRef.value
    if (!win || alarms.value.length === 0) return []
    const out: IncidentBand[] = []
    for (const a of alarms.value) {
      if (a.state !== 'alarm') continue
      const start = Math.max(a.stateUpdatedAt ?? win.startMs, win.startMs)
      const end = Math.min(win.endMs, Math.max(start + 60_000, win.endMs))
      if (end <= start) continue
      out.push({ startMs: start, endMs: end, label: a.name })
    }
    return out
  })

  /** Cảnh báo đầu tiên khớp một chuỗi metric — để vẽ ngưỡng đã có lên biểu đồ. */
  function alarmForSeries(s: MonitorSeriesSpec): WireAlarm | null {
    return (
      alarms.value.find(
        (a) =>
          a.namespace === s.namespace &&
          a.metricName === s.metricName &&
          a.threshold !== null &&
          a.state !== 'insufficient',
      ) ?? null
    )
  }

  // ── Ô số ─────────────────────────────────────────────────────────────────
  const tiles = computed<MonitorTile[]>(() => {
    const win = windowRef.value
    const p95 = seriesByKey.value.get('p95')
    const errs = seriesByKey.value.get('errors')

    const mean = p95 ? seriesMean(p95.points) : null
    const now = p95 ? seriesLast(p95.points) : null
    const lastHour = win ? seriesSumSince(errs?.points ?? [], win.endMs - 3600_000) : null
    const hourCount = Math.max(1, Math.round((windowSeconds.value || 3600) / 3600))
    const errTotal = errs ? errs.points.reduce((sum, p) => sum + p.v, 0) : null

    return [
      {
        key: 'p95',
        label: t('infra.monitoring.tile.p95'),
        value: formatMetricValue(now, 'Seconds'),
        baseline:
          mean === null
            ? null
            : t('infra.monitoring.tile.baselineP95', { v: formatMetricValue(mean, 'Seconds') }),
        state: 'ok',
        note: null,
      },
      {
        key: 'errors1h',
        label: t('infra.monitoring.tile.errors1h'),
        value: formatMetricValue(lastHour, 'Count'),
        baseline:
          errTotal === null
            ? null
            : t('infra.monitoring.tile.baselineErrors', {
                v: formatMetricValue(errTotal / hourCount, 'Count'),
              }),
        state: 'ok',
        note: null,
      },
      // Hai ô dưới đây CHƯA có nguồn trong Mốc 6, và hiện đúng như vậy: một chỗ
      // trống nói rõ lý do tốt hơn một số 0 trông như đã đo.
      {
        key: 'availability30d',
        label: t('infra.monitoring.tile.availability'),
        value: '—',
        baseline: null,
        state: 'unavailable',
        note: t('infra.monitoring.tile.availabilityNote'),
      },
      {
        key: 'costMonth',
        label: t('infra.monitoring.tile.cost'),
        value: '—',
        baseline: null,
        state: 'unavailable',
        note: t('infra.monitoring.tile.costNote'),
      },
    ]
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
    const win = resolveWindow()
    if (!win) {
      error.value = t('infra.monitoring.badWindow')
      return
    }
    const queries = MONITOR_CHARTS.flatMap((c) => c.series.map((s) => specToQuery(s, c.unit)))
    if (queries.length > MAX_MONITOR_SERIES) {
      error.value = t('infra.monitoring.tooManySeries')
      return
    }

    loading.value = true
    error.value = ''
    try {
      // MỘT lời gọi cho tám chuỗi (luật 2). Lô + cache nằm ở sidecar.
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
    const spec = MONITOR_CHARTS.find((c) => c.key === chartKey)
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
        target: primary.target,
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
      target: primary.target,
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
      const spec = MONITOR_CHARTS.find((c) => c.key === d.chartKey)
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
    for (const c of MONITOR_CHARTS) {
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
    const dims = dimensionsFor(d.target)
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
          title: t('infra.monitoring.history.loadFailed'),
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
      `RequestCount sau khi lọc: ${targets.value.lb || '(không dimension)'}`,
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
    targets,
    targetDimensions: TARGET_DIMENSIONS,
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
    incidents,
    thresholds,
    // cảnh báo
    alarms,
    alarmsLoaded,
    alarmsTruncated,
    alarmsByState,
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
