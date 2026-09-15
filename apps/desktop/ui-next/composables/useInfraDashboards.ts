// Bảng điều khiển tự lắp (mốc 6, M4) — page-controller của tab `/infra → Bảng điều khiển`,
// ĐỒNG THỜI là nguồn danh sách cho hộp "Ghim" mở từ màn Giám sát.
//
// TRẠNG THÁI Ở MỌC MODULE, HÀM THÌ KHÔNG. Hai bề mặt cùng đọc một danh sách: tab này, và
// hộp ghim (`InfraDashboardPinDialog`) mở từ tab Giám sát. Để state trong `ref` của
// composable là hai bản danh sách sống song song, và bản của tab sẽ cũ ngay sau cú ghim
// đầu tiên — người dùng vừa ghim xong, quay sang tab, không thấy bảng mình vừa tạo. Cùng
// lý do với `useShareExport`/`useInfraBubble`. Nhưng `useI18n()`/`useToast()`/
// `useSidecar()`/`useInfraContext()` phải gọi TRONG THÂN HÀM: chúng cần app instance, và
// gọi lúc nạp module thì nổ trước khi trang đầu tiên kịp vẽ.
//
// KHÔNG TỰ NẠP SỐ LIỆU. Mở một bảng chỉ ĐỌC FILE (không tốn tiền); chỉ cú bấm "Nạp" mới
// gọi `infra.metrics-query`, và mỗi lượt là một lô metric TÍNH TIỀN theo số metric × số
// điểm. Không `watch`, không hẹn giờ — luật 1 của `useInfraMetrics`.
//
// MỘT VÙNG, MỘT LÔ. `region` đi trong `context` của lời gọi chứ không phải của từng
// query ⇒ một bảng trộn vùng phải tách thành một lời gọi cho mỗi vùng. Ba bảng dựng sẵn
// đều đơn vùng (mẫu Chi phí ghim `us-east-1` ở cả hai biểu đồ — `AWS/Billing` chỉ được
// phát ở đó), nên bình thường có đúng một lời gọi.
//
// KHÔNG GỬI `unit` LÊN DÂY. `unit` trong file là NHÃN HIỂN THỊ (`USD`, `Count`), còn
// `Unit` gửi cho CloudWatch là một RÀNG BUỘC LỌC: lệch một chữ thì `get-metric-data` trả
// RỖNG chứ không báo lỗi, và biểu đồ trắng im lặng. Màn Giám sát gửi được vì ở đó `unit`
// là hằng số của chính bộ spec; ở đây nó là dữ liệu người dùng sửa tay được, nên gửi đi
// là tự tay dựng đúng cái bẫy đó. Một hệ quả đi kèm: mẫu Chi phí khai `unit: 'USD'` mà
// metric thật có đơn vị `None` — không gửi thì nó vẫn đúng.
import { computed, ref } from 'vue'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import { useInfraContext } from '~/composables/useInfraContext'
import { useSidecar } from '~/composables/useSidecar'
import { useSessionsStore } from '~/stores/sessions'
import { useToast } from '~/composables/useToast'
import {
  MONITOR_PRESET_SECONDS,
  MONITOR_WINDOW_PRESETS,
  TARGET_DIMENSIONS,
  periodForWindow,
} from '~/composables/useInfraMetrics'
import type {
  ChartSeriesView,
  InfraContextWire,
  MonitorTargetKey,
  WirePoint,
  WireQuery,
  WireSeries,
} from '~/composables/useInfraMetrics'
import type { LogsWindowPreset } from '~/composables/useInfraLogs'

// ─── Hợp đồng dây (khớp `sidecar/infra/dashboard/schema.ts` + `methods/infra.dashboard.ts`) ──

/** `builtin` sống trong mã, hai tier kia nằm trên đĩa. */
export type DashboardSource = 'builtin' | 'global' | 'project'
/** Chỉ hai tier này ghi được — bản dựng sẵn là bản chỉ-đọc, muốn sửa thì fork ra. */
export type WritableDashboardSource = 'global' | 'project'
export type DashboardTarget = MonitorTargetKey
export type DashboardDimension = { name: string; value: string }
export type DashboardChartKind = 'line' | 'area' | 'bar'
export type DashboardIssue = { code: string; message: string }

/**
 * Một chuỗi vẽ. `color`/`shade` nằm TRONG file chứ không suy ra lúc vẽ: bậc đậm nhạt là
 * một quyết định của người dựng bảng (p50 < p95 < p99 phải cùng một hue), không phải hệ
 * quả của thứ tự mảng.
 */
export type DashboardSeries = {
  key: string
  namespace: string
  metricName: string
  stat: string
  label: string
  color: string
  shade: number
  dimensions: DashboardDimension[]
  target?: DashboardTarget
  targetValue?: string
}

export type DashboardChart = {
  key: string
  title: string
  kind: DashboardChartKind
  unit: string
  /** Vùng đọc riêng của biểu đồ này khi khác vùng của ngữ cảnh. */
  region?: string
  series: DashboardSeries[]
}

export type Dashboard = {
  id: string
  name: string
  description: string
  tier: 'global' | 'project'
  updatedAt: string
  charts: DashboardChart[]
}

export type DashboardDraft = { name: string; description: string; charts: DashboardChart[] }

/** Dòng cho DANH SÁCH — `list` không trả biểu đồ, ruột đầy đủ đến qua `read`. */
export type DashboardSummary = {
  id: string
  name: string
  description: string
  source: DashboardSource
  tier: 'global' | 'project'
  projectId?: string
  updatedAt: string
  chartCount: number
  seriesCount: number
  /** Khác rỗng khi file hỏng: UI nói được "sai chỗ nào" thay vì bỏ qua im lặng. */
  issues: DashboardIssue[]
}

/**
 * Khoá của một bảng. `source` là một phần của khoá, không suy từ kết quả dò: cùng một
 * `id` ở hai tier là hai bảng khác nhau.
 */
export type DashboardRef = {
  source: DashboardSource
  projectId?: string
  id: string
}

export type DashboardChartView = {
  key: string
  title: string
  kind: DashboardChartKind
  unit: string
  series: ChartSeriesView[]
  hasData: boolean
  partial: boolean
}

export type CreateResult = { ok: true; id: string } | { ok: false; error: string }

export const MAX_CHARTS_PER_DASHBOARD = 12
export const MAX_SERIES_PER_DASHBOARD = 24

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

type ListWire = { ok: true; dashboards: DashboardSummary[] }
type ReadWire =
  | { ok: true; dashboard: Dashboard }
  | { ok: false; error: string; issues?: DashboardIssue[] }
type SaveWire =
  | { ok: true; dashboard: Dashboard }
  | { ok: false; error: string; issues?: DashboardIssue[] }
type DeleteWire = { ok: true } | { ok: false; error: string }
type MetricsWire =
  | { ok: true; series: WireSeries[]; fromCache: number; calls: number }
  | {
      ok: false
      error: string
    }

// ─── Tiện ích khoá (thuần, không cần app instance) ──────────────────────────

/**
 * Khoá duy nhất trong MỘT bảng. Sidecar từ chối khoá trùng (`validateDashboard`), và lý
 * do là thật: khoá chuỗi là danh tính để ghép dữ liệu trả về với biểu đồ, nên hai chuỗi
 * trùng khoá thì biểu đồ này vẽ dữ liệu của hàng xóm — im lặng. Ghim cùng một biểu đồ hai
 * lần là chuyện bình thường, nên phải tự đổi tên thay vì để lượt lưu hỏng.
 */
export function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
  const stem = clean || 'chart'
  if (!taken.has(stem)) return stem
  for (let n = 2; n < 1000; n += 1) {
    const next = `${stem}-${n}`
    if (!taken.has(next)) return next
  }
  return `${stem}-x`
}

/**
 * Đổi tên biểu đồ + chuỗi của nó cho vừa một bảng đã có người dùng.
 *
 * Cần vì `validateDashboard` đòi khoá duy nhất trên TOÀN BẢNG, và ghim cùng một biểu đồ
 * hai lần là chuyện bình thường. Chuỗi cũng phải đi qua `used` chung với khoá biểu đồ: một
 * chuỗi tên `latency` nằm cạnh một biểu đồ tên `latency` vẫn là hai khoá khác nhau ở hai
 * tập khác nhau — nhưng `used` gộp cả hai cho chắc, vì cái giá của một cú đổi tên thừa
 * (thấy `-2` trong file) rẻ hơn hẳn cái giá của một lượt lưu hỏng.
 */
export function remapChartKeys(chart: DashboardChart, taken: ReadonlySet<string>): DashboardChart {
  const used = new Set(taken)
  const key = uniqueKey(chart.key, used)
  used.add(key)
  const series = chart.series.map((s) => {
    const sk = uniqueKey(s.key, used)
    used.add(sk)
    return { ...s, key: sk }
  })
  return { ...chart, key, series }
}

/**
 * Tên → id. `id` là TÊN FILE (`~/.awog/dashboards/<id>.json`), nên nó phải khớp `ID_RE`
 * của sidecar: chữ thường, số, gạch nối, không bắt đầu bằng gạch nối. Bỏ dấu tiếng Việt ở
 * đây vì `đ` không tách được bằng NFD (nó là một ký tự, không phải `d` + dấu) — thiếu dòng
 * đó thì "Bảng chi phí" thành "b-ng-chi-ph".
 */
export function slugifyDashboardId(name: string): string {
  const ascii = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  if (ID_RE.test(slug)) return slug
  const padded = `bang-${slug}`.slice(0, 64).replace(/-+$/, '')
  return ID_RE.test(padded) ? padded : 'bang'
}

// ─── State mọc module (chỉ dữ liệu thuần) ───────────────────────────────────

const summaries = ref<DashboardSummary[]>([])
const listLoading = ref(false)
const listError = ref('')

const openedRef = ref<DashboardRef | null>(null)
const opened = ref<Dashboard | null>(null)
const openLoading = ref(false)
const openError = ref('')
const openIssues = ref<DashboardIssue[]>([])

/** Bản đang sửa (xoá biểu đồ) — `dirty` so với bản đã lưu để biết có gì để ghi. */
const working = ref<DashboardChart[]>([])
const baseline = ref('')

const targets = ref<Record<MonitorTargetKey, string>>({ lb: '', instance: '' })
const windowPreset = ref<LogsWindowPreset>('3h')

const seriesByKey = ref<Map<string, WireSeries>>(new Map())
const windowRef = ref<{ startMs: number; endMs: number } | null>(null)
const loading = ref(false)
const error = ref('')
const loadedAt = ref<number | null>(null)
const calls = ref(0)
const fromCache = ref(0)
const saving = ref(false)

function serialize(charts: readonly DashboardChart[]): string {
  return JSON.stringify(charts)
}

// ─── Composable ─────────────────────────────────────────────────────────────

export function useInfraDashboards() {
  const sc = useSidecar()
  const toast = useToast()
  const { t } = useI18n()
  const { askAgent } = useInfraAskAgent()
  const infraContext = useInfraContext({ sessionId: null })
  const sessionsStore = useSessionsStore()

  const rpc = {
    list: (projectIds: string[]): Promise<ListWire> =>
      sc.request<ListWire>('infra.dashboard-list', { projectIds }),

    read: (r: DashboardRef): Promise<ReadWire> =>
      sc.request<ReadWire>('infra.dashboard-read', {
        source: r.source,
        ...(r.projectId !== undefined ? { projectId: r.projectId } : {}),
        id: r.id,
      }),

    save: (r: DashboardRef & { draft: DashboardDraft }): Promise<SaveWire> =>
      sc.request<SaveWire>('infra.dashboard-save', {
        source: r.source,
        ...(r.projectId !== undefined ? { projectId: r.projectId } : {}),
        id: r.id,
        draft: r.draft,
      }),

    remove: (r: DashboardRef): Promise<DeleteWire> =>
      sc.request<DeleteWire>('infra.dashboard-delete', {
        source: r.source,
        ...(r.projectId !== undefined ? { projectId: r.projectId } : {}),
        id: r.id,
      }),

    /**
     * `surface: 'dashboards'` là tham số BẮT BUỘC của lời gọi này, không phải trang trí:
     * sổ kiểm toán phải trả lời được "lượt metric trả tiền này do ai bấm" — bảng điều
     * khiển hay màn Explorer. Bản trong `useInfraMetrics` không gửi `surface` (mặc định
     * `'explorer'`), nên không dùng lại được ở đây.
     */
    metrics: (p: {
      context: InfraContextWire
      startMs: number
      endMs: number
      queries: WireQuery[]
      force?: boolean
    }): Promise<MetricsWire> =>
      sc.request<MetricsWire>('infra.metrics-query', { ...p, surface: 'dashboards' }),
  }

  const context = computed<InfraContextWire>(() => {
    const e = infraContext.effective.value
    return {
      ...(e.profile ? { profile: e.profile } : {}),
      ...(e.region ? { region: e.region } : {}),
      ...(e.accountId ? { accountId: e.accountId } : {}),
    }
  })
  const hasAccount = computed(() => Boolean(context.value.profile))
  const sidecarAvailable = computed(() => sc.available)

  /**
   * Project của PHIÊN ĐANG MỞ — tier duy nhất hiện trong danh sách ngoài tier global, và
   * tier duy nhất `createDashboard` nhận ngoài `global`.
   *
   * ĐỌC TỪ STORE PHIÊN, KHÔNG TỪ `useInfraContext`. `InfraContext` là ngữ cảnh AWS
   * (profile · region · account · cluster · namespace · workspace) — nó KHÔNG mang
   * project, và trang `/infra` còn cố ý gọi nó với `sessionId: null`, tức đứng ngoài
   * phiên. Rỗng là câu trả lời ĐÚNG khi không có phiên nào mở: lúc đó "dự án này" không
   * trỏ vào đâu cả, và hộp ghim ẩn hẳn lựa chọn đó thay vì mời người dùng bấm vào một
   * lượt lưu chắc chắn hỏng.
   */
  const projectId = computed(() => sessionsStore.active?.project ?? '')

  function errText(res: { error: string }): string {
    const label = t(res.error)
    return label === res.error ? res.error : label
  }

  // ── Danh sách ─────────────────────────────────────────────────────────────

  /**
   * Quét cả hai tier. `projectIds` rỗng = chỉ tier global: một phiên không thuộc project
   * nào thì bảng của mọi project khác cũng không phải việc của nó.
   */
  async function refresh(): Promise<void> {
    listLoading.value = true
    listError.value = ''
    try {
      const res = await rpc.list(projectId.value ? [projectId.value] : [])
      summaries.value = res.dashboards
    } catch (err) {
      listError.value = err instanceof Error ? err.message : String(err)
    } finally {
      listLoading.value = false
    }
  }

  /** Bảng của NGƯỜI DÙNG (bỏ bản dựng sẵn) — hộp ghim chỉ ghi được vào nhóm này. */
  const writableSummaries = computed(() => summaries.value.filter((s) => s.source !== 'builtin'))

  // ── Mở một bảng ───────────────────────────────────────────────────────────

  /**
   * Gieo hai ô tài nguyên từ `targetValue` của chính bảng.
   *
   * `targetValue` là GỢI Ý, không phải ràng buộc — nên nó chỉ điền vào ô trống, và chỉ
   * khi cả bảng chưa có gợi ý nào cho tài nguyên đó. Hai biểu đồ của cùng một bảng trỏ vào
   * hai ALB khác nhau là chuyện có thật, nhưng màn này chỉ có MỘT ô cho mỗi loại tài
   * nguyên; lấy cái đầu tiên rồi để người dùng sửa là cách nói thật về giới hạn đó.
   */
  function seedTargets(charts: readonly DashboardChart[]): void {
    const next: Record<MonitorTargetKey, string> = { lb: '', instance: '' }
    for (const c of charts) {
      for (const s of c.series) {
        if (!s.target || !s.targetValue) continue
        if (!next[s.target]) next[s.target] = s.targetValue
      }
    }
    targets.value = next
  }

  /**
   * Mở bảng: đọc file, KHÔNG gọi metric. Xoá số liệu cũ ngay — giữ lại là màn hình nói
   * dối: biểu đồ của bảng vừa đóng còn nguyên trên khung trong khi tiêu đề đã đổi.
   */
  async function openDashboard(r: DashboardRef): Promise<void> {
    openLoading.value = true
    openError.value = ''
    openIssues.value = []
    seriesByKey.value = new Map()
    windowRef.value = null
    loadedAt.value = null
    calls.value = 0
    fromCache.value = 0
    try {
      const res = await rpc.read(r)
      if (!res.ok) {
        opened.value = null
        openedRef.value = null
        openIssues.value = res.issues ?? []
        openError.value = errText(res)
        return
      }
      opened.value = res.dashboard
      openedRef.value = r
      working.value = res.dashboard.charts
      baseline.value = serialize(res.dashboard.charts)
      seedTargets(res.dashboard.charts)
    } catch (err) {
      opened.value = null
      openedRef.value = null
      openError.value = err instanceof Error ? err.message : String(err)
    } finally {
      openLoading.value = false
    }
  }

  function closeDashboard(): void {
    opened.value = null
    openedRef.value = null
    openError.value = ''
    openIssues.value = []
    seriesByKey.value = new Map()
    windowRef.value = null
    loadedAt.value = null
    working.value = []
  }

  // ── Cửa sổ ────────────────────────────────────────────────────────────────

  const windowSeconds = computed(() =>
    windowPreset.value === 'custom' ? 0 : MONITOR_PRESET_SECONDS[windowPreset.value],
  )

  const windowLabel = computed(() => {
    const s = windowSeconds.value
    if (s < 3600) return `${String(Math.round(s / 60))}m`
    if (s < 86_400) return `${String(Math.round(s / 3600))}h`
    return `${String(Math.round(s / 86_400))}d`
  })

  const periodSeconds = computed(() => periodForWindow(windowSeconds.value || 3600))

  /**
   * Cửa sổ ĐÃ NẠP. Cùng luật 3 của `useInfraMetrics`: cửa sổ đang chọn và cửa sổ đã nạp
   * là hai thứ khác nhau, và UI phải nói ra khi chúng lệch.
   */
  const windowDirty = computed(() => {
    const w = windowRef.value
    if (!w) return false
    return Math.abs(w.endMs - w.startMs - windowSeconds.value * 1000) > 1000
  })

  // ── Dựng query ────────────────────────────────────────────────────────────

  /** Vùng của biểu đồ: vùng riêng của nó, không có thì vùng của ngữ cảnh. */
  function chartRegion(c: DashboardChart): string | undefined {
    return c.region ?? context.value.region
  }

  function dimensionsFor(s: DashboardSeries): DashboardDimension[] {
    const fixed = s.dimensions.map((d) => ({ name: d.name, value: d.value }))
    if (!s.target) return fixed
    const value = targets.value[s.target].trim()
    if (!value) return fixed
    return [...fixed, { name: TARGET_DIMENSIONS[s.target], value }]
  }

  /**
   * Dựng query cho cả bảng, GOM THEO VÙNG. Trả về một mảng nhóm — mỗi nhóm là một lời gọi
   * `infra.metrics-query` (xem đầu file: `region` đi ở `context`).
   *
   * Không có `unit`: xem đầu file.
   */
  function buildGroups(
    charts: readonly DashboardChart[],
  ): { region?: string; queries: WireQuery[] }[] {
    const groups = new Map<string, { region?: string; queries: WireQuery[] }>()
    for (const c of charts) {
      const region = chartRegion(c)
      const bucket = region ?? ''
      let group = groups.get(bucket)
      if (!group) {
        group = { ...(region !== undefined ? { region } : {}), queries: [] }
        groups.set(bucket, group)
      }
      for (const s of c.series) {
        const dims = dimensionsFor(s)
        group.queries.push({
          key: s.key,
          namespace: s.namespace,
          metricName: s.metricName,
          stat: s.stat,
          periodSeconds: periodSeconds.value,
          ...(dims.length > 0 ? { dimensions: dims } : {}),
          label: s.label,
        })
      }
    }
    return [...groups.values()]
  }

  /**
   * Tổng số chuỗi của bảng — chặn TRƯỚC khi gọi, vì vượt trần là sidecar từ chối NGUYÊN
   * lượt (trần `MAX_SERIES_PER_REQUEST` của `infra.metrics-query`).
   */
  const seriesCount = computed(() => working.value.reduce((n, c) => n + c.series.length, 0))

  // ── Nạp số liệu ───────────────────────────────────────────────────────────

  async function load(force = false): Promise<void> {
    if (!sc.available || loading.value) return
    if (!opened.value) return
    if (!hasAccount.value) {
      error.value = t('infra.monitoring.noProfile')
      return
    }
    if (windowSeconds.value <= 0) {
      error.value = t('infra.monitoring.badWindow')
      return
    }
    if (seriesCount.value > MAX_SERIES_PER_DASHBOARD) {
      error.value = t('infra.dashboard.error.tooManySeries', { n: MAX_SERIES_PER_DASHBOARD })
      return
    }

    const endMs = Date.now()
    const startMs = endMs - windowSeconds.value * 1000
    const groups = buildGroups(working.value)
    loading.value = true
    error.value = ''
    try {
      const merged = new Map<string, WireSeries>()
      let totalCalls = 0
      let totalCached = 0
      for (const group of groups) {
        // TUẦN TỰ, không `Promise.all`. Mỗi lượt là một lô metric tính tiền, và một cú
        // bấm "Nạp" phải tương ứng đúng một lượt nạp; bắn song song thì các lời gọi ập
        // vào `merged` theo thứ tự về đích chứ không theo thứ tự vùng, và không còn ai
        // trả lời được "lượt trả tiền này gồm những gì".

        const res = await rpc.metrics({
          context: {
            ...context.value,
            ...(group.region !== undefined ? { region: group.region } : {}),
          },
          startMs,
          endMs,
          queries: group.queries,
          ...(force ? { force: true } : {}),
        })
        if (!res.ok) {
          // Một nhóm hỏng thì DỪNG cả lượt và nói ra: hiện nửa bảng rồi im lặng về nửa
          // kia là để người dùng tin vào một bức tranh khuyết.
          error.value = errText(res)
          return
        }
        for (const s of res.series) merged.set(s.key, s)
        totalCalls += res.calls
        totalCached += res.fromCache
      }
      seriesByKey.value = merged
      windowRef.value = { startMs, endMs }
      loadedAt.value = Date.now()
      calls.value = totalCalls
      fromCache.value = totalCached
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function reload(): Promise<void> {
    return load(true)
  }

  // ── Biểu đồ đã dựng ───────────────────────────────────────────────────────

  const charts = computed<DashboardChartView[]>(() => {
    const byKey = seriesByKey.value
    return working.value.map((c) => {
      const series: ChartSeriesView[] = c.series.map((s) => {
        const got = byKey.get(s.key)
        const points: WirePoint[] = got?.points ?? []
        return {
          key: s.key,
          label: s.label,
          color: s.color,
          shade: s.shade,
          points,
          missing: points.length === 0,
        }
      })
      const withData = series.filter((s) => !s.missing).length
      return {
        key: c.key,
        title: c.title,
        kind: c.kind,
        unit: c.unit,
        series,
        hasData: withData > 0,
        partial: withData > 0 && withData < series.length,
      }
    })
  })

  // ── Sửa: bỏ một biểu đồ ───────────────────────────────────────────────────

  const dirty = computed(() => opened.value !== null && serialize(working.value) !== baseline.value)

  /** Còn biểu đồ nào không — bảng rỗng bị sidecar từ chối (`min(1)` của lược đồ). */
  const canRemove = computed(() => working.value.length > 1)

  function removeChart(key: string): void {
    working.value = working.value.filter((c) => c.key !== key)
  }

  function undoRemove(): void {
    if (!opened.value) return
    working.value = opened.value.charts
  }

  async function save(): Promise<boolean> {
    const r = openedRef.value
    if (!r || !opened.value || saving.value) return false
    if (r.source === 'builtin') {
      toast.add({ title: t('infra.dashboard.error.builtinReadOnly'), color: 'warning' })
      return false
    }
    saving.value = true
    try {
      const res = await rpc.save({
        ...r,
        draft: {
          name: opened.value.name,
          description: opened.value.description,
          charts: working.value,
        },
      })
      if (!res.ok) {
        openIssues.value = res.issues ?? []
        toast.add({ title: errText(res), color: 'error' })
        return false
      }
      opened.value = res.dashboard
      working.value = res.dashboard.charts
      baseline.value = serialize(res.dashboard.charts)
      await refresh()
      return true
    } catch (err) {
      toast.add({ title: err instanceof Error ? err.message : String(err), color: 'error' })
      return false
    } finally {
      saving.value = false
    }
  }

  // ── Ghi: tạo bảng mới / ghim thêm biểu đồ ─────────────────────────────────

  /** Đã có bảng cùng `id` ở cùng tier chưa — ghi đè im lặng là mất bảng của người khác. */
  function idTaken(source: WritableDashboardSource, id: string): boolean {
    const pid = source === 'project' ? projectId.value : undefined
    return summaries.value.some((s) => s.id === id && s.source === source && s.projectId === pid)
  }

  async function createDashboard(input: {
    source: WritableDashboardSource
    name: string
    description: string
    charts: DashboardChart[]
  }): Promise<CreateResult> {
    const name = input.name.trim()
    if (!name) return { ok: false, error: t('infra.dashboard.error.needName') }
    if (input.source === 'project' && !projectId.value) {
      return { ok: false, error: t('infra.dashboard.error.needProject') }
    }
    const id = slugifyDashboardId(name)
    if (idTaken(input.source, id)) {
      // Không tự thêm hậu tố: người dùng vừa đặt một cái tên, và `id` chính là tên file —
      // tự đổi id sau lưng họ là để file trên đĩa mang một cái tên họ chưa từng thấy.
      return { ok: false, error: t('infra.dashboard.error.idTaken', { id }) }
    }
    const res = await rpc.save({
      source: input.source,
      ...(input.source === 'project' ? { projectId: projectId.value } : {}),
      id,
      draft: { name, description: input.description, charts: input.charts },
    })
    if (!res.ok) return { ok: false, error: errText(res) }
    await refresh()
    await openDashboard({
      source: input.source,
      ...(input.source === 'project' ? { projectId: projectId.value } : {}),
      id,
    })
    return { ok: true, id }
  }

  /**
   * Ghim thêm một biểu đồ vào bảng có sẵn. Đọc bản ĐẦY ĐỦ trước khi ghi — `list` chỉ có
   * tóm tắt, và ghi đè bằng tóm tắt là xoá sạch biểu đồ của bảng đó.
   */
  async function appendChart(
    dest: DashboardRef,
    chart: DashboardChart,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const read = await rpc.read(dest)
    if (!read.ok) return { ok: false, error: errText(read) }
    const charts = [...read.dashboard.charts, chart]
    if (charts.length > MAX_CHARTS_PER_DASHBOARD) {
      return {
        ok: false,
        error: t('infra.dashboard.error.tooManyCharts', { n: MAX_CHARTS_PER_DASHBOARD }),
      }
    }
    const total = charts.reduce((n, c) => n + c.series.length, 0)
    if (total > MAX_SERIES_PER_DASHBOARD) {
      return {
        ok: false,
        error: t('infra.dashboard.error.tooManySeries', { n: MAX_SERIES_PER_DASHBOARD }),
      }
    }
    const res = await rpc.save({ ...dest, draft: { ...read.dashboard, charts } })
    if (!res.ok) return { ok: false, error: errText(res) }
    await refresh()
    return { ok: true }
  }

  /** Khoá đã dùng của một bảng — để lượt ghim tự đổi tên thay vì hỏng ở lượt lưu. */
  async function takenKeys(dest: DashboardRef): Promise<Set<string>> {
    const read = await rpc.read(dest)
    if (!read.ok) return new Set()
    const out = new Set<string>()
    for (const c of read.dashboard.charts) {
      out.add(c.key)
      for (const s of c.series) out.add(s.key)
    }
    return out
  }

  async function deleteDashboard(r: DashboardRef): Promise<boolean> {
    const res = await rpc.remove(r)
    if (!res.ok) {
      toast.add({ title: errText(res), color: 'error' })
      return false
    }
    if (openedRef.value?.id === r.id && openedRef.value.source === r.source) {
      closeDashboard()
    }
    await refresh()
    return true
  }

  // ── Luật 4 của infra-README: chip câu hỏi thay cho ô trống ────────────────
  //
  // Ảnh chụp là BẢNG ĐANG XEM (tên biểu đồ + chuỗi + có điểm hay không), dựng từ state
  // đã nạp — không thêm lời gọi metric tính tiền nào.

  const askSuggestions = computed(() => [
    { key: 'explain', text: t('infra.dashboard.ask.explain') },
    { key: 'anomaly', text: t('infra.dashboard.ask.anomaly') },
  ])

  const hasSnapshot = computed(() => opened.value !== null && loadedAt.value !== null)

  function snapshotText(): string {
    const board = opened.value
    if (!board) return ''
    const lines = [`Bảng: ${board.name}`, `Cửa sổ: ${windowLabel.value}`]
    for (const c of charts.value) {
      lines.push(`${c.title} (${c.unit})`)
      for (const s of c.series) {
        lines.push(
          `  ${s.label}: ${s.missing ? 'thiếu dữ liệu' : `${String(s.points.length)} điểm`}`,
        )
      }
    }
    return lines.join('\n')
  }

  async function ask(text: string): Promise<void> {
    const snap = snapshotText()
    const label = t('infra.dashboard.title')
    if (!snap) {
      await askAgent(text, label)
      return
    }
    await askAgent(`${text}\n\n\`\`\`\n${snap}\n\`\`\``, label)
  }

  return {
    // ngữ cảnh
    context,
    hasAccount,
    projectId,
    sidecarAvailable,
    // danh sách
    summaries,
    writableSummaries,
    listLoading,
    listError,
    refresh,
    // bảng đang mở
    opened,
    openedRef,
    openLoading,
    openError,
    openIssues,
    openDashboard,
    closeDashboard,
    // tài nguyên
    targets,
    targetDimensions: TARGET_DIMENSIONS,
    // cửa sổ
    windowPreset,
    windowPresets: MONITOR_WINDOW_PRESETS,
    windowSeconds,
    windowLabel,
    windowDirty,
    windowRef,
    periodSeconds,
    // nạp
    loading,
    error,
    loadedAt,
    calls,
    fromCache,
    load,
    reload,
    seriesCount,
    // biểu đồ
    charts,
    working,
    dirty,
    canRemove,
    removeChart,
    undoRemove,
    saving,
    save,
    // ghi
    createDashboard,
    appendChart,
    takenKeys,
    deleteDashboard,
    // hỏi agent (luật 4)
    askSuggestions,
    hasSnapshot,
    ask,
  }
}
