import { computed, ref, shallowRef } from 'vue'
import { useAwsLogsApi } from '~/composables/useAwsLogsApi'
import { useInfraContext } from '~/composables/useInfraContext'
import { useSidecar } from '~/composables/useSidecar'
import type {
  AwsInsightsRow,
  AwsInsightsStatus,
  AwsLogGroup,
  AwsLogsHistoryEntry,
  AwsLogsTemplate,
  AwsSavedQuery,
} from '~/composables/useAwsLogsApi'

// Page-controller cho màn CloudWatch Logs (Mốc 2, việc 2.1 → 2.7). Khuôn theo
// useInfraPage.ts: trang chỉ điều phối, state/luồng nằm ở đây.
//
// ⚠ LUẬT SỐ MỘT CỦA FILE NÀY — KHÔNG BAO GIỜ TỰ CHẠY. Không `watch`, không
// `onMounted` nào gọi `api.start()`/`api.estimate()` sau lưng người dùng. Insights
// tính tiền theo GB quét, nên MỌI lời gọi tốn tiền phải nằm sau một cú bấm (2.6).
// Việc duy nhất chạy lúc mở màn là nạp danh sách log group (metadata) và đọc thư
// viện trên đĩa — cả hai đều không gọi mạng ra CloudWatch Insights.

export type LogsWindowPreset = '15m' | '1h' | '3h' | '12h' | '1d' | '7d' | 'custom'

export const LOGS_WINDOW_PRESETS: readonly LogsWindowPreset[] = [
  '15m',
  '1h',
  '3h',
  '12h',
  '1d',
  '7d',
]

const PRESET_SECONDS: Record<Exclude<LogsWindowPreset, 'custom'>, number> = {
  '15m': 900,
  '1h': 3600,
  '3h': 3 * 3600,
  '12h': 12 * 3600,
  '1d': 86_400,
  '7d': 7 * 86_400,
}

const POLL_MS = 1500
/** Trần chờ phía UI. Sidecar cũng có trần riêng cho đường tool của agent. */
const POLL_MAX_MS = 5 * 60_000

/**
 * Bước nhóm của histogram. Tài liệu gọi nó là `bin(auto)`, nhưng CloudWatch
 * KHÔNG có đơn vị `auto` — nên bước được chọn theo độ dài cửa sổ. Chọn sai chỉ
 * làm biểu đồ thô/mịn hơn, không đổi dữ liệu và không đổi hoá đơn.
 */
export function histogramBucket(windowSeconds: number): string {
  if (windowSeconds <= 900) return '1m'
  if (windowSeconds <= 6 * 3600) return '5m'
  if (windowSeconds <= 2 * 86_400) return '1h'
  return '1d'
}

/**
 * Câu histogram chạy kèm. Trả `null` khi câu gốc ĐÃ có `stats` — lúc đó biểu đồ
 * được dựng từ chính kết quả, KHÔNG tốn thêm một lượt quét nào.
 */
export function buildHistogramQuery(query: string, windowSeconds: number): string | null {
  if (/\bstats\b/i.test(query)) return null
  // Bỏ `sort`/`limit`: chúng vô nghĩa trước một `stats`, và `limit` đứng trước
  // `stats` bị CloudWatch từ chối trong một số trường hợp.
  const cleaned = query
    .replace(/\|\s*(sort|limit)\b[^|]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return `${cleaned} | stats count(*) as n by bin(${histogramBucket(windowSeconds)})`
}

export type LogsFacet = { field: string; values: { value: string; count: number }[] }

/**
 * Câu lệnh do màn khác gieo vào màn này (Tổng quan → "Mở trong Logs"). `nonce` là
 * thứ khiến cùng một câu gieo hai lần vẫn được áp: nếu chỉ so `query` thì lần gieo
 * thứ hai trùng chuỗi sẽ bị bỏ qua, và người dùng thấy nút không có tác dụng.
 */
/**
 * Câu gieo từ màn khác (Tổng quan, Triển khai): điền sẵn câu lệnh — KHÔNG chạy.
 * `group` (tuỳ chọn) chọn luôn log group, cần cho đường từ màn Triển khai: log của
 * CodeBuild nằm ở `/aws/codebuild/<project>` mà người dùng không phải tự đi tìm.
 */
export type LogsSeed = {
  query: string
  windowSeconds: number
  nonce: number
  group?: string
}

export function useInfraLogs() {
  const api = useAwsLogsApi()
  const sidecar = useSidecar()
  const infraContext = useInfraContext({ sessionId: null })

  const profile = computed(() => infraContext.appValue.value.profile ?? '')
  const region = computed(() => infraContext.appValue.value.region ?? '')

  // ── log group ────────────────────────────────────────────────────────────
  const groups = ref<AwsLogGroup[]>([])
  const groupsLoading = ref(false)
  const groupsError = ref('')
  /** Tên group ĐÃ CHỌN. Giữ tên (không giữ object) để sống sót qua lần nạp lại. */
  const picked = ref<string[]>([])
  const pattern = ref('')
  /** Group đã dùng gần đây — đọc từ lịch sử thư viện, KHÔNG gọi mạng. */
  const recentGroups = ref<string[]>([])

  const pickedGroups = computed(() => groups.value.filter((g) => picked.value.includes(g.name)))
  const pickedStoredBytes = computed(() =>
    pickedGroups.value.reduce((sum, g) => sum + g.storedBytes, 0),
  )

  async function loadGroups(): Promise<void> {
    if (!sidecar.available) return
    groupsLoading.value = true
    groupsError.value = ''
    try {
      const res = await api.groups({
        ...(profile.value ? { profile: profile.value } : {}),
        ...(region.value ? { region: region.value } : {}),
        ...(pattern.value.trim() ? { pattern: pattern.value.trim() } : {}),
        limit: 100,
      })
      if (!res.ok) {
        groupsError.value = res.error
        groups.value = []
        return
      }
      groups.value = res.groups
      // Bỏ khỏi danh sách chọn những tên không còn tồn tại (group vừa bị xoá).
      const names = new Set(res.groups.map((g) => g.name))
      picked.value = picked.value.filter((n) => names.has(n))
    } catch (err) {
      groupsError.value = err instanceof Error ? err.message : String(err)
    } finally {
      groupsLoading.value = false
    }
  }

  function toggleGroup(name: string): void {
    picked.value = picked.value.includes(name)
      ? picked.value.filter((n) => n !== name)
      : [...picked.value, name]
  }

  // ── câu lệnh + cửa sổ thời gian ──────────────────────────────────────────
  const query = ref('')
  const windowPreset = ref<LogsWindowPreset>('1h')
  /** Chỉ dùng khi `windowPreset === 'custom'`. */
  const customStart = ref('')
  const customEnd = ref('')

  const windowSeconds = computed(() => {
    if (windowPreset.value !== 'custom') return PRESET_SECONDS[windowPreset.value]
    const start = Date.parse(customStart.value)
    const end = Date.parse(customEnd.value)
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0
    return Math.round((end - start) / 1000)
  })

  const windowMs = computed<{ startMs: number; endMs: number } | null>(() => {
    if (windowPreset.value === 'custom') {
      const startMs = Date.parse(customStart.value)
      const endMs = Date.parse(customEnd.value)
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null
      return { startMs, endMs }
    }
    const endMs = Date.now()
    return { startMs: endMs - PRESET_SECONDS[windowPreset.value] * 1000, endMs }
  })

  const windowValid = computed(() => windowMs.value !== null && windowSeconds.value > 0)

  // ── ước lượng TRƯỚC khi chạy (2.6) ───────────────────────────────────────
  const estimate = ref<{ bytes: number; usd: number; basis: 'history' | 'stored' } | null>(null)
  const estimating = ref(false)
  const histogramOn = ref(true)

  const needsHistogramQuery = computed(
    () => buildHistogramQuery(query.value, windowSeconds.value || 3600) !== null,
  )
  /** Số truy vấn sẽ chạy ở lần bấm kế tiếp (1, hoặc 2 khi bật biểu đồ). */
  const plannedQueries = computed(() => (histogramOn.value && needsHistogramQuery.value ? 2 : 1))
  /** Tổng chi phí dự kiến của cú bấm kế tiếp — con số người dùng phải đọc. */
  const plannedUsd = computed(() =>
    estimate.value ? estimate.value.usd * plannedQueries.value : 0,
  )

  async function refreshEstimate(): Promise<void> {
    if (picked.value.length === 0) {
      estimate.value = null
      return
    }
    estimating.value = true
    try {
      const res = await api.estimate({
        logGroups: picked.value,
        ...(query.value.trim() ? { query: query.value.trim() } : {}),
        ...(profile.value ? { profile: profile.value } : {}),
        ...(region.value ? { region: region.value } : {}),
      })
      estimate.value = res.ok ? { bytes: res.bytes, usd: res.usd, basis: res.basis } : null
    } catch {
      estimate.value = null
    } finally {
      estimating.value = false
    }
  }

  // ── chạy ─────────────────────────────────────────────────────────────────
  const running = ref(false)
  const activeQueryId = ref('')
  const status = ref<AwsInsightsStatus | ''>('')
  const rows = shallowRef<AwsInsightsRow[]>([])
  const bytesScanned = ref(0)
  const recordsMatched = ref(0)
  const runError = ref('')
  const ranAt = ref(0)
  const actualUsd = ref(0)

  const histogram = shallowRef<{ n: number; t: number }[]>([])
  const histogramFromRows = ref(false)

  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let pollDeadline = 0
  /** Bấm Huỷ ⇒ vòng poll dừng NGAY, không chờ hết nhịp. */
  let cancelled = false

  /**
   * `resolve` của nhịp chờ đang treo, để `stopPolling()` đánh thức được nó.
   *
   * `clearTimeout()` một mình KHÔNG dừng một Promise đang chờ — nó bỏ mặc Promise
   * đó treo vĩnh viễn. Hậu quả là cả một dây: `poll()` không bao giờ trả về →
   * `run()` không bao giờ tới `finally` → `running` kẹt ở `true` → người dùng bấm
   * Huỷ xong vẫn thấy "Đang chạy…" và KHÔNG chạy được câu lệnh nào nữa cho tới khi
   * rời tab. Bấm Huỷ là việc phải dừng được ngay, nên nhịp chờ phải thức dậy.
   */
  let pollWake: (() => void) | null = null

  function stopPolling(): void {
    if (pollTimer !== null) clearTimeout(pollTimer)
    pollTimer = null
    const wake = pollWake
    pollWake = null
    wake?.()
  }

  const canRun = computed(
    () =>
      picked.value.length > 0 &&
      query.value.trim().length > 0 &&
      windowValid.value &&
      !running.value,
  )

  async function run(): Promise<void> {
    if (!canRun.value) return
    const win = windowMs.value
    if (!win) return
    cancelled = false
    running.value = true
    runError.value = ''
    rows.value = []
    histogram.value = []
    histogramFromRows.value = false
    bytesScanned.value = 0
    recordsMatched.value = 0
    actualUsd.value = 0

    try {
      // Ước lượng NGAY TRƯỚC khi tiêu tiền, không dùng số cũ: câu lệnh có thể vừa
      // đổi. Đây là lệnh rẻ (chỉ đọc metadata) nhưng vẫn là một lời gọi CLI.
      await refreshEstimate()
      const perQueryUsd = estimate.value?.usd ?? 0
      const ctx = {
        ...(profile.value ? { profile: profile.value } : {}),
        ...(region.value ? { region: region.value } : {}),
      }

      const main = await api.start({
        logGroups: picked.value,
        query: query.value.trim(),
        startMs: win.startMs,
        endMs: win.endMs,
        limit: 200,
        estimatedUsd: perQueryUsd,
        ...ctx,
      })
      if (!main.ok) {
        runError.value = main.error
        return
      }
      activeQueryId.value = main.queryId
      status.value = 'Scheduled'

      const histQuery = histogramOn.value
        ? buildHistogramQuery(query.value.trim(), windowSeconds.value)
        : null
      const histStart = histQuery
        ? await api.start({
            logGroups: picked.value,
            query: histQuery,
            startMs: win.startMs,
            endMs: win.endMs,
            limit: 500,
            estimatedUsd: perQueryUsd,
            ...ctx,
          })
        : null

      pollDeadline = Date.now() + POLL_MAX_MS
      const mainRows = await poll(main.queryId)
      if (histStart?.ok) {
        histogram.value = toBuckets(await poll(histStart.queryId))
      } else if (histogramOn.value && !needsHistogramQuery.value) {
        // Câu gốc đã có `stats` ⇒ không chạy thêm truy vấn nào; gom bucket từ
        // chính kết quả. Không tốn thêm một GB nào.
        histogram.value = toBuckets(mainRows)
        histogramFromRows.value = true
      }
      ranAt.value = Date.now()
      void reloadLibrary()
    } catch (err) {
      runError.value = err instanceof Error ? err.message : String(err)
    } finally {
      running.value = false
      activeQueryId.value = ''
      stopPolling()
    }
  }

  /** Hỏi trạng thái cho tới khi kết thúc (hoặc bị huỷ). Trả các dòng kết quả. */
  async function poll(queryId: string): Promise<AwsInsightsRow[]> {
    let last: AwsInsightsRow[] = []
    for (;;) {
      const res = await api.status(queryId, profile.value || undefined, region.value || undefined)
      if (!res.ok) {
        runError.value = res.error
        return last
      }
      status.value = res.status
      if (res.rows.length > 0) last = res.rows
      if (queryId === activeQueryId.value) {
        rows.value = last
        bytesScanned.value = res.bytesScanned
        recordsMatched.value = res.recordsMatched
        actualUsd.value = insightsUsd(res.bytesScanned)
      }
      if (isTerminal(res.status)) {
        if (res.status !== 'Complete') runError.value = `Insights: ${res.status}`
        return last
      }
      if (cancelled || Date.now() > pollDeadline) return last
      await new Promise<void>((resolve) => {
        pollWake = resolve
        pollTimer = setTimeout(() => {
          pollWake = null
          resolve()
        }, POLL_MS)
      })
      // Thức dậy vì bị huỷ (hoặc quá hạn) thì thoát NGAY. Không có nhịp kiểm tra
      // này, vòng lặp quay lại đầu và hỏi thêm một lượt `get-query-results` nữa —
      // một lời gọi AWS sau khi người dùng đã bảo dừng.
      if (cancelled || Date.now() > pollDeadline) return last
    }
  }

  async function cancel(): Promise<void> {
    cancelled = true
    stopPolling()
    const id = activeQueryId.value
    if (!id) return
    await api.cancel(id, profile.value || undefined, region.value || undefined).catch(() => {})
  }

  // ── lọc tại chỗ (2.7) ────────────────────────────────────────────────────
  const quickFilter = ref('')
  const levelFilter = ref<'' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'>('')
  /** `null` = chưa bấm facet nào. */
  const facetFilter = ref<{ field: string; value: string } | null>(null)

  const LEVEL_RE: Record<string, RegExp> = {
    ERROR: /(\bERROR\b|\bFATAL\b|\bCRITICAL\b|\bException\b|\bError\b)/,
    WARN: /\bWARN(?:ING)?\b/,
    INFO: /\bINFO\b/,
    DEBUG: /(\bDEBUG\b|\bTRACE\b)/,
  }

  const filteredRows = computed<AwsInsightsRow[]>(() => {
    let out = rows.value
    const level = levelFilter.value
    if (level) {
      const re = LEVEL_RE[level]
      if (re) out = out.filter((r) => re.test(Object.values(r).join(' ')))
    }
    const facet = facetFilter.value
    if (facet) out = out.filter((r) => r[facet.field] === facet.value)
    const q = quickFilter.value.trim().toLowerCase()
    if (q) out = out.filter((r) => Object.values(r).join(' ').toLowerCase().includes(q))
    return out
  })

  /**
   * Facet = tần suất giá trị của những trường ít cardinality. Lấy từ CHÍNH kết
   * quả (không gọi thêm truy vấn): một trường có >20 giá trị khác nhau thì không
   * phải facet hữu ích, và cũng là dấu hiệu của dữ liệu gần như tự do.
   */
  const facets = computed<LogsFacet[]>(() => {
    const counts = new Map<string, Map<string, number>>()
    for (const row of rows.value) {
      for (const [field, value] of Object.entries(row)) {
        if (!value || value.length > 120) continue
        if (field === '@timestamp' || field === '@message') continue
        const byValue = counts.get(field) ?? new Map<string, number>()
        byValue.set(value, (byValue.get(value) ?? 0) + 1)
        counts.set(field, byValue)
      }
    }
    const out: LogsFacet[] = []
    for (const [field, byValue] of counts) {
      if (byValue.size > 20) continue
      out.push({
        field,
        values: [...byValue.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([value, count]) => ({ value, count })),
      })
    }
    return out.sort((a, b) => a.field.localeCompare(b.field)).slice(0, 6)
  })

  /** Bấm một giá trị facet ⇒ chèn `filter field = "value"` vào câu lệnh. */
  function insertFacetFilter(field: string, value: string): void {
    facetFilter.value = { field, value }
    const clause = `| filter ${field} = "${value.replace(/"/g, '\\"')}"`
    if (query.value.includes(clause)) return
    query.value = `${query.value.trim()} ${clause}`
  }

  // ── thư viện (2.4) ───────────────────────────────────────────────────────
  const templates = ref<AwsLogsTemplate[]>([])
  const saved = ref<AwsSavedQuery[]>([])
  const history = ref<AwsLogsHistoryEntry[]>([])

  async function reloadLibrary(): Promise<void> {
    if (!sidecar.available) return
    try {
      const res = await api.library()
      templates.value = res.templates
      saved.value = res.saved
      history.value = res.history
      recentGroups.value = [...new Set(res.history.flatMap((h) => h.logGroups))].slice(0, 6)
    } catch (err) {
      console.error('[infra-logs] load library failed', err)
    }
  }

  function presetForSeconds(seconds: number): LogsWindowPreset {
    const hit = (Object.entries(PRESET_SECONDS) as [LogsWindowPreset, number][]).find(
      ([, s]) => s === seconds,
    )
    return hit ? hit[0] : 'custom'
  }

  function applyTemplate(t: AwsLogsTemplate): void {
    query.value = t.query
    const preset = presetForSeconds(t.windowSeconds)
    windowPreset.value = preset
    if (preset === 'custom') {
      const end = Date.now()
      customStart.value = toLocalInput(end - t.windowSeconds * 1000)
      customEnd.value = toLocalInput(end)
    }
  }

  /**
   * Bấm vào histogram để thu hẹp cửa sổ (2.5) — KHÔNG tự chạy lại. Thu hẹp
   * khoảng thời gian là một cách GIẢM chi phí; tự chạy lại ngay sau đó thì người
   * dùng không kịp nhìn thấy con số ước lượng mới.
   */
  function zoomToWindow(startMs: number, endMs: number): void {
    windowPreset.value = 'custom'
    customStart.value = toLocalInput(startMs)
    customEnd.value = toLocalInput(endMs)
  }

  return {
    profile,
    region,
    groups,
    groupsLoading,
    groupsError,
    picked,
    pickedGroups,
    pickedStoredBytes,
    pattern,
    recentGroups,
    loadGroups,
    toggleGroup,
    query,
    windowPreset,
    customStart,
    customEnd,
    windowSeconds,
    windowValid,
    estimate,
    estimating,
    histogramOn,
    plannedQueries,
    plannedUsd,
    refreshEstimate,
    running,
    status,
    rows,
    filteredRows,
    bytesScanned,
    recordsMatched,
    actualUsd,
    runError,
    ranAt,
    canRun,
    run,
    cancel,
    quickFilter,
    levelFilter,
    facetFilter,
    facets,
    insertFacetFilter,
    histogram,
    histogramFromRows,
    templates,
    saved,
    history,
    reloadLibrary,
    applyTemplate,
    zoomToWindow,
  }
}

function isTerminal(status: AwsInsightsStatus): boolean {
  return (
    status === 'Complete' || status === 'Failed' || status === 'Cancelled' || status === 'Timeout'
  )
}

/** Khớp `INSIGHTS_USD_PER_GB` của sidecar. Con số có thẩm quyền vẫn là con số
 *  sidecar ghi vào nhật ký; đây chỉ là bản hiển thị. */
const USD_PER_GB = 0.005
export function insightsUsd(bytes: number): number {
  return Math.round((bytes / 1024 ** 3) * USD_PER_GB * 10_000) / 10_000
}

/**
 * Dòng của câu `stats count(*) by bin(…)` ⇒ cặp (thời điểm, số đếm).
 * Tên cột thời gian do CloudWatch đặt theo biểu thức (`bin(5m)`), nên nó được
 * NHẬN RA chứ không được đoán: cột nào không phải `n` và parse được thành thời
 * gian thì là trục thời gian.
 */
export function toBuckets(rows: readonly AwsInsightsRow[]): { n: number; t: number }[] {
  const out: { n: number; t: number }[] = []
  for (const row of rows) {
    const n = Number(row.n ?? row['count(*)'] ?? '0')
    if (!Number.isFinite(n)) continue
    let t: number | null = null
    for (const [key, value] of Object.entries(row)) {
      if (key === 'n' || key === 'count(*)') continue
      const parsed = parseAwsTime(value)
      if (parsed !== null) {
        t = parsed
        break
      }
    }
    if (t !== null) out.push({ n, t })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** `2026-09-13 10:00:00.000` (giờ UTC của Insights) ⇒ epoch ms. */
export function parseAwsTime(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(
    value.trim(),
  )
  if (!m) return null
  const ms = m[7] ? Number(m[7].padEnd(3, '0')) : 0
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
    ms,
  )
}

/** ISO ⇒ giá trị cho `<input type="datetime-local">` (giờ ĐỊA PHƯƠNG). */
function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}
