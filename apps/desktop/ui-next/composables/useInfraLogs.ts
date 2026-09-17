import { computed, ref, shallowRef } from 'vue'
import { useAwsLogsApi } from '~/composables/useAwsLogsApi'
import { useInfraContext } from '~/composables/useInfraContext'
import { useSidecar } from '~/composables/useSidecar'
import {
  absoluteWindow,
  isWindowValid,
  relativeWindow,
  windowSecondsOf,
  windowToMs,
  type InfraWindow,
} from '~/utils/infra-window'
import type {
  AwsInsightsRow,
  AwsInsightsStatus,
  AwsLogGroup,
  AwsLogsHistoryEntry,
  AwsLogsTailEvent,
  AwsLogsTemplate,
  AwsLogStream,
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

/** Ba chế độ của màn Logs — xem `mode` trong `useInfraLogs()`. */
export type LogsMode = 'tail' | 'advanced' | 'trace'

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
  /** Câu Insights điền sẵn. Bỏ trống ⇒ KHÔNG đụng vào câu người dùng đang soạn. */
  query?: string
  windowSeconds: number
  nonce: number
  group?: string
  /**
   * Lọc danh sách nhóm log. Dùng khi bên gieo chỉ suy được TIỀN TỐ chứ không ra
   * tên đầy đủ — sơ đồ biết `API-Gateway-Execution-Logs_<id>/` nhưng không biết
   * stage, và đoán nốt stage là đoán một nhóm có thể không tồn tại.
   */
  pattern?: string
  /**
   * Chế độ mở màn. Mặc định `advanced` vì đường gieo đầu tiên (Tổng quan → "Mở
   * trong Logs") mang theo một câu Insights. Sơ đồ thì gieo `tail`: xem dòng mới
   * nhất KHÔNG tốn GB quét, nên nó mở được ngay mà không cần một cú bấm trả tiền.
   */
  mode?: LogsMode
}

/**
 * Số dòng mỗi lượt `filter-log-events`.
 *
 * 200 là cỡ TRANG, không phải trần: hết trang thì `nextToken` cho đọc tiếp. Trước
 * 2026-09-17 đây là trần cứng và không có đường nào đi xa hơn nó.
 */
const TAIL_PAGE_SIZE = 200

/**
 * Câu của AWS có phải là "điểm đọc tiếp không còn dùng được" không?
 *
 * Khớp theo TÊN THAM SỐ chứ không theo mã lỗi: `InvalidParameterException` còn dùng
 * cho nhiều tham số khác, và một lỗi mạng tạm thời thì phải thử lại được — bỏ token đi
 * trong ca đó là làm mất phần đã đọc mà không có lý do.
 */
function isDeadTokenError(error: string): boolean {
  return /nexttoken/i.test(error)
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
  // Cửa sổ thời gian: mô hình dùng chung (tương đối "N giây gần đây" hoặc tuyệt đối
  // hai mốc). Control `InfraTimeRange` v-model thẳng vào `win`. Mặc định 1 giờ.
  const win = ref<InfraWindow>(relativeWindow(3600))

  const windowSeconds = computed(() => windowSecondsOf(win.value))
  const windowMs = computed<{ startMs: number; endMs: number } | null>(() => windowToMs(win.value))
  const windowValid = computed(() => isWindowValid(win.value))

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

  // ── tail: xem dòng mới nhất của MỘT nhóm (2.9) ─────────────────────────────
  // Đường RẺ, tách hẳn khỏi Insights: `filter-log-events` không tính tiền theo GB
  // quét, nên đây là đường được phép TỰ CHẠY khi người dùng bấm vào một nhóm log.
  /**
   * Ba chế độ của màn Logs. MỘT ref chứ không phải hai cờ boolean: hai cờ cho phép
   * biểu diễn những trạng thái không tồn tại ("vừa tail vừa lần theo") và người sau
   * sẽ phải viết luật để khử chúng.
   *
   *   · `tail`     — dòng mới nhất của một nhóm (rẻ, mặc định)
   *   · `advanced` — soạn câu Insights (tốn tiền, phải bấm Chạy)
   *   · `trace`    — lần theo một request (L5; cũng tốn tiền ở nhánh log)
   */
  const mode = ref<LogsMode>('tail')
  /** Hai chế độ dùng danh sách nhóm (multi) thay vì một nhóm đang xem. */
  const advancedOpen = computed(() => mode.value !== 'tail')
  /** Nhóm đang tail (một nhóm). '' = chưa bấm nhóm nào. */
  const tailGroup = ref('')
  /** Dòng log đã map về shape của bảng kết quả để DÙNG LẠI InfraLogsResults. */
  // Giữ SỰ KIỆN THÔ chứ không giữ hàng đã dựng: nối thêm một trang rồi sắp xếp lại
  // cần mốc thời gian dạng SỐ. Sắp theo chuỗi `@timestamp` cũng ra đúng thứ tự với
  // định dạng hiện tại, nhưng nó đúng do tình cờ — đổi định dạng là hỏng âm thầm.
  const tailEvents = shallowRef<AwsLogsTailEvent[]>([])
  const tailLoading = ref(false)
  /** Đang nối thêm trang, khác với đang tải lại từ đầu — nút và bảng phản ứng khác nhau. */
  const tailLoadingMore = ref(false)
  const tailError = ref('')
  const tailRanAt = ref(0)
  /** `null` = hết trang. Khác `null` = còn đọc tiếp được từ đúng chỗ vừa dừng. */
  const tailNextToken = ref<string | null>(null)
  /**
   * Cửa sổ của lượt đọc ĐẦU, ghim lại để các trang sau dùng đúng nó.
   *
   * `windowMs` là computed gọi `windowToMs(win, Date.now())`, nên với một cửa sổ
   * TƯƠNG ĐỐI ("1 giờ gần đây") nó trôi theo đồng hồ: người dùng đọc vài phút rồi bấm
   * Đọc thêm sẽ gửi một token của cửa sổ này kèm `--start-time` của cửa sổ khác.
   */
  const tailPinnedWindow = ref<{ startMs: number; endMs: number } | null>(null)
  /**
   * Điểm đọc tiếp vừa bị AWS từ chối ⇒ chỉ còn đường Làm mới.
   *
   * Là CỜ chứ không phải câu chữ: composable lo state + IPC, còn câu đã dịch thì
   * component dựng (SoC — file này không chạm i18n).
   */
  const tailTokenDead = ref(false)

  // Mới nhất lên đầu — người đọc log tìm dòng vừa xảy ra. Sắp xếp trên TOÀN BỘ tập
  // đã gom, không phải từng trang: cửa sổ bắt đầu trước 2024-01-01 không dùng được
  // `--no-start-from-head` nên AWS trả CŨ TRƯỚC, và lúc đó nối từng trang đã sắp sẵn
  // sẽ cho một danh sách răng cưa.
  const tailRows = computed<AwsInsightsRow[]>(() =>
    [...tailEvents.value]
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((e) => ({
        '@timestamp': toStamp(e.timestamp),
        '@message': e.message,
        '@logStream': e.logStreamName,
      })),
  )

  // ── Tầng giữa: log stream của group đang chọn (group → stream → event) ──────
  /** Stream của `tailGroup`. Nạp khi bấm vào một group (describe-log-streams, rẻ). */
  const streams = shallowRef<AwsLogStream[]>([])
  const streamsLoading = ref(false)
  const streamsError = ref('')
  /**
   * Stream đang xem — BA trạng thái, và phân biệt chúng là cả mô hình của màn này:
   *
   *   · `null` — CHƯA chọn. Đã bấm một nhóm log và danh sách stream đã nạp, nhưng
   *     chưa gọi một dòng log nào. Panel chính hiện danh sách để chọn.
   *   · `''`   — TẤT CẢ stream của nhóm, gộp qua `filter-log-events`.
   *   · tên    — đúng một stream.
   *
   * `null` và `''` KHÔNG được gộp làm một: cả hai đều "không có tên stream" khi
   * dựng lời gọi CLI, nhưng một cái nghĩa là "đừng gọi gì cả" còn cái kia là "gọi
   * và gộp mọi stream". Dùng chung một giá trị thì màn hình không thể biết nên hiện
   * danh sách hay hiện log.
   */
  const activeStream = ref<string | null>(null)

  /** Nạp danh sách stream của một group. Metadata rẻ — không tính GB quét. */
  async function loadStreams(group: string): Promise<void> {
    streamsLoading.value = true
    streamsError.value = ''
    try {
      const res = await api.streams({
        logGroup: group,
        ...(profile.value ? { profile: profile.value } : {}),
        ...(region.value ? { region: region.value } : {}),
      })
      if (!res.ok) {
        streamsError.value = res.error
        streams.value = []
        return
      }
      streams.value = res.streams
    } catch (err) {
      streamsError.value = err instanceof Error ? err.message : String(err)
    } finally {
      streamsLoading.value = false
    }
  }

  /** `2026-09-16 10:00:00.000` (giờ địa phương) — đọc được, cột thẳng hàng. */
  function toStamp(ms: number): string {
    const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
    return d.toISOString().replace('T', ' ').slice(0, 23)
  }

  /**
   * Chạy tail cho `tailGroup` theo cửa sổ đang chọn. KHÔNG phải Insights: không
   * ước lượng, không histogram, không ghi lịch sử thư viện. Cú bấm nhóm là sự cho
   * phép; lệnh rẻ nên chạy thẳng.
   */
  async function refreshTail(): Promise<void> {
    const group = tailGroup.value
    if (!group) return
    // Chưa chọn stream ⇒ không có gì để đọc. Guard ở ĐÂY chứ không chỉ ở call site:
    // watcher "đổi khoảng thời gian thì tail lại" cũng đi qua hàm này, và nó không
    // được phép biến một lần đổi khoảng thành một lời gọi CLI khi người dùng mới chỉ
    // đang nhìn danh sách stream.
    if (activeStream.value === null) return
    const win = windowMs.value
    if (!win) {
      tailError.value = 'INVALID_WINDOW'
      return
    }
    await fetchTail(null)
  }

  /**
   * Đọc TIẾP từ đúng chỗ lượt trước dừng.
   *
   * Là một nút chứ không phải tự nạp khi cuộn: mỗi lượt là một request
   * `filter-log-events` thật, tính tiền theo số request. Tự nạp khi cuộn sẽ biến một
   * cú lăn chuột thành mấy chục lệnh mà người dùng không hề yêu cầu.
   */
  async function loadMoreTail(): Promise<void> {
    const token = tailNextToken.value
    if (!token || tailLoading.value || tailLoadingMore.value) return
    await fetchTail(token)
  }

  /**
   * Một lượt `filter-log-events`. `token = null` ⇒ đọc lại từ đầu cửa sổ (thay sạch
   * kết quả); có token ⇒ nối thêm vào tập đang có.
   */
  async function fetchTail(token: string | null): Promise<void> {
    const group = tailGroup.value
    // Đọc tiếp thì bám cửa sổ đã ghim; đọc lại thì lấy cửa sổ hiện tại và ghim nó.
    const win = token ? tailPinnedWindow.value : windowMs.value
    if (!group || !win) return
    if (token) tailLoadingMore.value = true
    else tailLoading.value = true
    tailError.value = ''
    if (!token) tailTokenDead.value = false
    try {
      const res = await api.tail({
        logGroups: [group],
        startMs: win.startMs,
        endMs: win.endMs,
        limit: TAIL_PAGE_SIZE,
        ...(token ? { nextToken: token } : {}),
        // '' = mọi stream (không truyền cờ ⇒ filter-log-events gộp cả group).
        ...(activeStream.value ? { logStreamName: activeStream.value } : {}),
        ...(profile.value ? { profile: profile.value } : {}),
        ...(region.value ? { region: region.value } : {}),
      })
      if (!res.ok) {
        tailError.value = res.error
        // Lỗi khi ĐỌC TIẾP thì GIỮ những dòng đã đọc được: vứt chúng đi là phạt người
        // dùng vì một lượt gọi hỏng mà họ không gây ra.
        if (!token) {
          tailEvents.value = []
          tailNextToken.value = null
          tailPinnedWindow.value = null
        } else if (isDeadTokenError(res.error)) {
          // Token chết là chết hẳn — hết hạn 24 giờ, hoặc AWS không nhận. Giữ nút lại
          // thì bấm bao nhiêu lần cũng ra đúng một lỗi. Bỏ token đi để đường duy nhất
          // còn lại là Làm mới, và bật cờ cho màn nói ra điều đó bằng tiếng người.
          tailNextToken.value = null
          tailTokenDead.value = true
        }
        return
      }
      tailEvents.value = token ? [...tailEvents.value, ...res.events] : res.events
      if (!token) tailPinnedWindow.value = win
      tailNextToken.value = res.nextToken
      tailRanAt.value = Date.now()
    } catch (err) {
      tailError.value = err instanceof Error ? err.message : String(err)
    } finally {
      tailLoading.value = false
      tailLoadingMore.value = false
    }
  }

  /**
   * Bấm vào một nhóm log ⇒ nạp DANH SÁCH STREAM của nó, và dừng ở đó.
   *
   * KHÔNG tail ngay. Đây là mô hình chủ–chi tiết người dùng chốt ngày 2026-09-17:
   * nhóm log → chọn stream → mới đọc dòng. Đổi lại một cú bấm nữa trước dòng log
   * đầu tiên, nhưng người đọc thấy nhóm này có những stream nào và stream nào vừa
   * có event — thứ mà một bảng log gộp không nói ra.
   *
   * Bấm lại chính nhóm đang mở ⇒ nạp lại danh sách stream (giữ nguyên lựa chọn nếu
   * đang xem một stream).
   */
  async function openTail(name: string): Promise<void> {
    const sameGroup = tailGroup.value === name
    tailGroup.value = name
    if (!sameGroup) {
      // Đổi sang nhóm khác ⇒ về danh sách (stream của nhóm cũ vô nghĩa ở đây).
      activeStream.value = null
      tailEvents.value = []
      tailRanAt.value = 0
      tailNextToken.value = null
      tailPinnedWindow.value = null
      streams.value = []
    }
    await loadStreams(name)
  }

  /** Chọn một stream ('' = gộp tất cả) rồi đọc dòng log. Cú bấm là sự cho phép. */
  async function selectStream(name: string): Promise<void> {
    activeStream.value = name
    await refreshTail()
  }

  /**
   * Quay lại danh sách stream.
   *
   * Xoá luôn kết quả đang giữ: để lại thì lần chọn stream sau sẽ chớp qua dòng log
   * của stream TRƯỚC trong khi lời gọi mới còn đang bay — một bảng log hiện đúng
   * nửa giây thứ dữ liệu sai là thứ người đọc không kịp nghi ngờ.
   */
  function backToStreams(): void {
    activeStream.value = null
    tailEvents.value = []
    tailRanAt.value = 0
    tailNextToken.value = null
    tailPinnedWindow.value = null
    tailError.value = ''
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

  /**
   * Lọc mức log + lọc nhanh trong kết quả đang xem. Dùng CHUNG cho bảng Insights
   * (`filteredRows`) và bảng tail (`tailFilteredRows`) — hai bảng có cùng thanh
   * lọc, nên cùng một phép lọc. `facet` chỉ áp cho Insights (tail không có facet).
   */
  function filterRows(source: readonly AwsInsightsRow[], withFacet: boolean): AwsInsightsRow[] {
    let out = [...source]
    const level = levelFilter.value
    if (level) {
      const re = LEVEL_RE[level]
      if (re) out = out.filter((r) => re.test(Object.values(r).join(' ')))
    }
    const facet = facetFilter.value
    if (withFacet && facet) out = out.filter((r) => r[facet.field] === facet.value)
    const q = quickFilter.value.trim().toLowerCase()
    if (q) out = out.filter((r) => Object.values(r).join(' ').toLowerCase().includes(q))
    return out
  }

  const filteredRows = computed<AwsInsightsRow[]>(() => filterRows(rows.value, true))
  const tailFilteredRows = computed<AwsInsightsRow[]>(() => filterRows(tailRows.value, false))

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

  function applyTemplate(t: AwsLogsTemplate): void {
    query.value = t.query
    // Cửa sổ của một mẫu là khoảng nhìn-lại TƯƠNG ĐỐI.
    win.value = relativeWindow(t.windowSeconds > 0 ? t.windowSeconds : 3600)
  }

  /**
   * Bấm vào histogram để thu hẹp cửa sổ (2.5) — KHÔNG tự chạy lại. Thu hẹp
   * khoảng thời gian là một cách GIẢM chi phí; tự chạy lại ngay sau đó thì người
   * dùng không kịp nhìn thấy con số ước lượng mới.
   */
  function zoomToWindow(startMs: number, endMs: number): void {
    win.value = absoluteWindow(startMs, endMs)
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
    // Cửa sổ thời gian: một model dùng chung (`InfraTimeRange` v-model vào `win`).
    win,
    windowSeconds,
    // `windowMs` được export vì cầu nối khoảng-thời-gian (Mốc 6, 6.3) cần HAI MỐC
    // TUYỆT ĐỐI để gieo sang màn Giám sát, không phải độ dài.
    windowMs,
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
    // tail (2.9) — đường rẻ, mặc định của màn
    mode,
    advancedOpen,
    tailGroup,
    tailRows,
    tailFilteredRows,
    tailLoading,
    tailLoadingMore,
    tailError,
    tailRanAt,
    tailNextToken,
    tailTokenDead,
    loadMoreTail,
    openTail,
    refreshTail,
    // tầng giữa: log stream
    streams,
    streamsLoading,
    streamsError,
    activeStream,
    selectStream,
    backToStreams,
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
