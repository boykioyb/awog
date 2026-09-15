import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useAwsLogsApi } from '~/composables/useAwsLogsApi'
import { useInfraContext } from '~/composables/useInfraContext'
import { insightsUsd } from '~/composables/useInfraLogs'
import { useInfraResourcesApi } from '~/composables/useInfraResourcesApi'
import { useSidecar } from '~/composables/useSidecar'
import type { AwsInsightsRow } from '~/composables/useAwsLogsApi'
import type { InfraResourceRow } from '~/composables/useInfraResourcesApi'

// Page-controller cho màn Tổng quan (Mốc 2 việc 2.8) + phần dữ liệu miễn phí của
// nó. Khuôn theo useInfraLogs.ts: màn chỉ hiển thị, state/luồng nằm ở đây.
//
// LUẬT CỦA FILE NÀY
//   · `refresh()` chỉ đọc thứ MIỄN PHÍ và CỤC BỘ: danh sách binary của máy
//     (`infra.status`), ma trận quyền (`infra.policy.get`), profile trong `~/.aws`
//     (`infra.contexts`), và thư viện câu lệnh trên đĩa. Không có CloudWatch nào
//     bị chạm khi mở màn.
//   · Hai thẻ có nguồn sống — "Máy chủ" (2.8, `ec2 describe-instances`) và "Lỗi
//     1 giờ qua" (CloudWatch Insights) — KHÔNG hàm nào chạy trong `onMounted`/
//     `watch`: mỗi lượt đọc đứng sau một cú bấm, đúng luật của `useInfraResourcesApi.ts`.
//     `watch` ở đây chỉ XOÁ kết quả khi đổi profile/region — một con số của tài khoản
//     vừa rời đi nằm lại trên màn là nói dối người dùng.
//   · Thẻ "Lỗi 1 giờ qua" là thẻ DUY NHẤT tốn tiền, và nó đi đúng hai bước có
//     người bấm: Ước lượng (rẻ) → Chạy (hiện số USD ước lượng ngay trên nút). Một
//     con số nhảy ra sau lưng người dùng là vi phạm 2.6. Thẻ "Máy chủ" không tốn
//     tiền theo GB, nhưng vẫn phải bấm — cùng một lý do: không có lời gọi CLI nào
//     dùng credential mà người dùng không biết.
//   · Log group để kiểm tra lấy từ LỊCH SỬ chạy gần đây (đọc từ thư viện, local),
//     không tự đi liệt kê log group — liệt kê là một lời gọi CLI dùng credential.

export type OvLamp = 'ok' | 'warn' | 'bad' | 'unknown'
export type OvMode = 'auto' | 'ask' | 'block'
export type OvCommandClass = 'read' | 'write' | 'destructive'
export type OvMatrixRow = { normal: OvMode; production: OvMode }
export type OvTool = { tool: string; found: boolean; version: string }
export type OvProfile = { name: string; kind: string; accountId: string; region: string }
export type OvEstimate = { bytes: number; usd: number; basis: 'history' | 'stored' }
export type OvErrorsResult = { n: number; bytes: number; usd: number }

/**
 * Thứ thẻ "Máy chủ" đếm được từ `ec2 describe-instances`. Chỉ hai con số và một
 * danh sách — không có "sức khoẻ", vì EC2 không kể cho ta điều đó.
 */
export type OvServersResult = {
  total: number
  running: number
  /** Tên (hay id) của máy KHÔNG ở trạng thái `running` — EC2 trả về sao thì ghi vậy. */
  notRunning: string[]
  /** Token của trang kế tiếp; `null` nghĩa là đã đọc hết. */
  nextToken: string | null
}

/**
 * Câu đếm lỗi của thẻ Tổng quan. Cố ý KHÁC mẫu "errors" trong thư viện: mẫu kia
 * trả về 100 dòng để người dùng đọc, còn thẻ này chỉ cần MỘT con số — ít byte
 * truyền về, và không bao giờ đẩy nội dung log lên màn Tổng quan.
 */
export const OVERVIEW_ERRORS_QUERY =
  'fields @timestamp, @message | filter @message like /(?i)(error|exception|fail)/ | stats count(*) as n'

export const OVERVIEW_ERRORS_WINDOW_SECONDS = 3600

/**
 * Câu mở sẵn ở tab Logs khi người dùng bấm "Mở trong Logs" từ thẻ Lỗi — bản ĐỌC
 * ĐƯỢC (có `sort`/`limit`), khác câu đếm một dòng của thẻ. Đây chỉ là câu chữ điền
 * vào editor: tab Logs vẫn không tự chạy.
 */
export const OVERVIEW_OPEN_LOGS_QUERY =
  'fields @timestamp, @message | filter @message like /(?i)(error|exception|fail)/ | sort @timestamp desc | limit 100'
/** Trần số nhóm log kiểm tra ở thẻ Tổng quan — mỗi nhóm là một phần của hoá đơn. */
export const OVERVIEW_MAX_CHECK_GROUPS = 5

const POLL_MS = 1500
const POLL_MAX_MS = 5 * 60_000
const CLASSES: readonly OvCommandClass[] = ['read', 'write', 'destructive']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}
function mode(v: unknown): OvMode {
  return v === 'auto' || v === 'ask' || v === 'block' ? v : 'ask'
}
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useInfraOverview() {
  const api = useAwsLogsApi()
  const sc = useSidecar()
  const infraContext = useInfraContext({ sessionId: null })
  const resources = useInfraResourcesApi()

  const profile = computed(() => infraContext.appValue.value.profile ?? '')
  const region = computed(() => infraContext.appValue.value.region ?? '')

  // ── Nền tảng: bốn thứ đọc được mà không tốn một xu nào ─────────────────────
  const tools = ref<OvTool[]>([])
  const profiles = ref<OvProfile[]>([])
  const matrix = ref<Partial<Record<OvCommandClass, OvMatrixRow>>>({})
  const prodAccountIds = ref<string[]>([])
  const bypassUntil = ref('')
  const updatedAt = ref(0)
  const loading = ref(false)

  /** "Đang dùng": app đã ghim profile/region nào trên bề mặt /infra. */
  const pinnedProfile = computed(() => profile.value)
  const pinnedRegion = computed(() => region.value)

  async function loadTools(): Promise<void> {
    const raw = await sc.request<unknown>('infra.status')
    const list = isRecord(raw) && Array.isArray(raw.tools) ? raw.tools : []
    tools.value = list
      .filter(isRecord)
      .map((item) => ({
        tool: text(item.tool),
        found: item.found === true,
        version: text(item.version),
      }))
      .filter((item) => item.tool.length > 0)
  }

  async function loadProfiles(): Promise<void> {
    const raw = await sc.request<unknown>('infra.contexts', { tool: 'aws' })
    const list = isRecord(raw) && Array.isArray(raw.contexts) ? raw.contexts : []
    profiles.value = list
      .filter(isRecord)
      .map((item) => ({
        name: text(item.name),
        kind: text(item.kind),
        accountId: text(item.ssoAccountId),
        region: text(item.region),
      }))
      .filter((item) => item.name.length > 0)
  }

  async function loadPolicy(): Promise<void> {
    const raw = await sc.request<unknown>('infra.policy.get')
    if (!isRecord(raw)) return
    const next: Partial<Record<OvCommandClass, OvMatrixRow>> = {}
    if (isRecord(raw.matrix)) {
      for (const cls of CLASSES) {
        const row = raw.matrix[cls]
        if (!isRecord(row)) continue
        next[cls] = { normal: mode(row.normal), production: mode(row.production) }
      }
    }
    matrix.value = next
    prodAccountIds.value = Array.isArray(raw.prodAccountIds)
      ? raw.prodAccountIds.map(text).filter(Boolean)
      : []
    const until = text(raw.bypassUntil)
    // Van hết hạn rồi thì đừng doạ người dùng bằng một cảnh báo cũ.
    bypassUntil.value = until && Date.parse(until) > Date.now() ? until : ''
  }

  /** Nhóm log của những lần chạy gần đây — đọc từ thư viện trên đĩa, không gọi mạng. */
  const recentGroups = ref<string[]>([])

  async function loadLibrary(): Promise<void> {
    const res = await api.library()
    recentGroups.value = [...new Set(res.history.flatMap((h) => h.logGroups))].slice(0, 6)
  }

  async function refresh(): Promise<void> {
    if (!sc.available || loading.value) return
    loading.value = true
    try {
      // Một nhánh hỏng không được kéo ba nhánh còn lại xuống: màn Tổng quan vẫn phải
      // nói được cái nó biết, kèm chỗ nó không biết.
      await Promise.allSettled([loadTools(), loadProfiles(), loadPolicy(), loadLibrary()])
      updatedAt.value = Date.now()
    } finally {
      loading.value = false
    }
  }

  // ── Thẻ "Lỗi 1 giờ qua" — thứ duy nhất tốn tiền ────────────────────────────
  const checkGroups = computed(() => recentGroups.value.slice(0, OVERVIEW_MAX_CHECK_GROUPS))
  const estimate = ref<OvEstimate | null>(null)
  const estimating = ref(false)
  const running = ref(false)
  const result = ref<OvErrorsResult | null>(null)
  const checkError = ref('')

  let timer: ReturnType<typeof setTimeout> | null = null
  let activeQueryId = ''
  let cancelled = false

  /**
   * Con dấu của lượt kiểm tra đang hợp lệ — cùng luật với `serversEpoch` bên dưới,
   * nhưng ở đây cái bị vứt còn TỐN TIỀN: một truy vấn Insights chạy dưới tài khoản
   * cũ mà đáp xuống sau khi người dùng đã đổi profile là vừa in ra con số của người
   * khác vừa gửi hoá đơn cho người khác.
   */
  let errorsEpoch = 0

  /**
   * Ngữ cảnh của lời gọi ĐANG chạy, chốt lại lúc `start`.
   *
   * Vòng poll KHÔNG được đọc `profile`/`region` sống: người dùng đổi tài khoản giữa
   * lượt là chuyện thường (thẻ Máy chủ đã phải xử đúng ca này), và hỏi truy vấn của
   * account cũ bằng credential của account mới thì hoặc lỗi, hoặc trả về số của
   * người khác; còn `cancel` thì gửi nhầm tài khoản nên truy vấn cũ vẫn quét tiếp.
   */
  let activeCtx: { profile?: string; region?: string } = {}

  /** `resolve` của nhịp chờ đang treo — xem `stopTimer()` bên dưới dùng nó làm gì. */
  let timerWake: (() => void) | null = null

  /**
   * `clearTimeout()` một mình không đánh thức được Promise đang chờ nhịp đó: nó
   * bỏ mặc Promise treo vĩnh viễn, nên `runErrors()` không bao giờ tới `finally`
   * và thẻ kẹt ở "đang kiểm tra" — bấm Huỷ xong vẫn không bấm lại được. Cùng một
   * lỗi đã sửa ở `useInfraLogs.ts`.
   */
  function stopTimer(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
    const wake = timerWake
    timerWake = null
    wake?.()
  }

  const canEstimate = computed(
    () => checkGroups.value.length > 0 && !estimating.value && !running.value,
  )
  const canRun = computed(() => canEstimate.value && estimate.value !== null)

  function ctx(): { profile?: string; region?: string } {
    return {
      ...(profile.value ? { profile: profile.value } : {}),
      ...(region.value ? { region: region.value } : {}),
    }
  }

  async function estimateErrors(): Promise<void> {
    if (!canEstimate.value) return
    const epoch = errorsEpoch
    const callCtx = ctx()
    estimating.value = true
    checkError.value = ''
    try {
      const res = await api.estimate({
        logGroups: checkGroups.value,
        query: OVERVIEW_ERRORS_QUERY,
        ...callCtx,
      })
      // Ngữ cảnh đã đổi trong lúc chờ: con số này là của tài khoản đã rời đi.
      if (epoch !== errorsEpoch) return
      estimate.value = res.ok ? { bytes: res.bytes, usd: res.usd, basis: res.basis } : null
      if (!res.ok) checkError.value = res.error
    } catch (err) {
      if (epoch !== errorsEpoch) return
      estimate.value = null
      checkError.value = message(err)
    } finally {
      if (epoch === errorsEpoch) estimating.value = false
    }
  }

  async function runErrors(): Promise<void> {
    if (!canRun.value || estimate.value === null) return
    const endMs = Date.now()
    const startMs = endMs - OVERVIEW_ERRORS_WINDOW_SECONDS * 1000
    const epoch = errorsEpoch
    // Chốt ngữ cảnh MỘT LẦN cho cả lượt (start → poll → cancel). Xem `activeCtx`.
    activeCtx = ctx()
    cancelled = false
    running.value = true
    checkError.value = ''
    result.value = null
    try {
      const started = await api.start({
        logGroups: checkGroups.value,
        query: OVERVIEW_ERRORS_QUERY,
        startMs,
        endMs,
        limit: 1,
        estimatedUsd: estimate.value.usd,
        ...activeCtx,
      })
      if (epoch !== errorsEpoch) return
      if (!started.ok) {
        checkError.value = started.error
        return
      }
      activeQueryId = started.queryId
      const deadline = Date.now() + POLL_MAX_MS
      for (;;) {
        const res = await api.status(started.queryId, activeCtx.profile, activeCtx.region)
        // Đổi profile/region giữa lượt: `watch` đã bật con dấu mới và tự huỷ truy
        // vấn. Không ghi gì thêm vào state của lượt mới.
        if (epoch !== errorsEpoch) return
        if (!res.ok) {
          checkError.value = res.error
          return
        }
        if (res.status === 'Complete') {
          result.value = {
            n: countOf(res.rows),
            bytes: res.bytesScanned,
            usd: insightsUsd(res.bytesScanned),
          }
          return
        }
        if (res.status === 'Failed' || res.status === 'Cancelled' || res.status === 'Timeout') {
          checkError.value = `Insights: ${res.status}`
          return
        }
        if (cancelled || Date.now() > deadline) return
        await new Promise<void>((resolve) => {
          timerWake = resolve
          timer = setTimeout(() => {
            timerWake = null
            resolve()
          }, POLL_MS)
        })
        // Huỷ xong thì thoát ngay, không hỏi thêm một lượt `get-query-results` nữa.
        if (cancelled || Date.now() > deadline) return
      }
    } catch (err) {
      if (epoch !== errorsEpoch) return
      checkError.value = message(err)
    } finally {
      // Lượt cũ KHÔNG được chạm state của lượt mới — kể cả `stopTimer()`, vì nhịp
      // chờ lúc này có thể là của lượt mới và đánh thức nó sớm là biến vòng poll
      // thành vòng quay nóng.
      if (epoch === errorsEpoch) {
        running.value = false
        activeQueryId = ''
        stopTimer()
      }
    }
  }

  /**
   * Huỷ THẬT truy vấn đang chạy (`logs stop-query`). Dừng vòng poll là chưa đủ —
   * truy vấn vẫn quét bên AWS và vẫn tính tiền cho tới khi CloudWatch tự kết thúc.
   */
  async function cancelCheck(): Promise<void> {
    cancelled = true
    stopTimer()
    const id = activeQueryId
    if (!id) return
    // Ngữ cảnh của lượt ĐANG chạy, không phải ngữ cảnh hiện tại: huỷ một truy vấn
    // của tài khoản cũ bằng credential của tài khoản mới là gửi nhầm chỗ, và truy
    // vấn cũ vẫn quét tiếp — vẫn tính tiền.
    await api.cancel(id, activeCtx.profile, activeCtx.region).catch(() => {})
  }

  // Rời màn giữa lúc chạy cũng phải huỷ thật, cùng lý do trên.
  onBeforeUnmount(() => {
    void cancelCheck()
  })

  // ── Thẻ "Máy chủ" — EC2 thật, cũng chỉ sau một cú bấm ──────────────────────
  // `list()` là GỌI AWS THẬT dùng credential (xem luật đầu `useInfraResourcesApi.ts`),
  // nên nó không có đường nào tự chạy. Khác thẻ Lỗi ở chỗ nó KHÔNG tính tiền theo GB.
  const servers = ref<OvServersResult | null>(null)
  const serversReading = ref(false)
  const serversError = ref('')

  /**
   * Con dấu của lượt đọc đang hợp lệ. `describe-instances` mất vài giây, và người
   * dùng có quyền đổi profile/region ngay giữa lượt đó; không có con dấu thì câu trả
   * lời của tài khoản CŨ đáp xuống SAU khi `watch` đã xoá sạch — tức đúng con số nói
   * dối mà luật đầu file cấm. Mỗi lần đổi ngữ cảnh là con dấu nhảy, và mọi thứ viết
   * vào `servers` từ lượt cũ bị vứt.
   */
  let serversEpoch = 0

  /**
   * Đọc MỘT trang `describe-instances`. `token` có nghĩa là đang đọc tiếp, và trang
   * mới được CỘNG vào trang trước — không cộng thì con số trên thẻ là số của trang
   * đầu (200 dòng), tức một trần bị đội lốt số đo.
   */
  async function readServers(token?: string): Promise<void> {
    if (!sc.available || serversReading.value) return
    const epoch = serversEpoch
    serversReading.value = true
    serversError.value = ''
    try {
      const res = await resources.list({
        viewId: 'ec2.instances',
        ...(token ? { token } : {}),
        context: ctx(),
      })
      // Tài khoản đã đổi trong lúc CLI chạy: câu trả lời này thuộc về người khác.
      if (epoch !== serversEpoch) return
      if (!res.ok) {
        // Cổng quyền chặn hay CLI hỏng đều là câu trả lời THẬT, và không phải số 0:
        // nuốt chúng thành "0 máy chủ" là biến một lỗi thành một tin tốt giả.
        servers.value = null
        serversError.value = res.blocked ? res.reason : res.error
        return
      }
      const page = countServers(res.rows)
      const before = token ? servers.value : null
      servers.value = {
        total: (before?.total ?? 0) + page.total,
        running: (before?.running ?? 0) + page.running,
        notRunning: [...(before?.notRunning ?? []), ...page.notRunning],
        nextToken: res.nextToken,
      }
    } catch (err) {
      if (epoch !== serversEpoch) return
      servers.value = null
      serversError.value = message(err)
    } finally {
      // Lượt cũ không được tắt vòng xoay của lượt mới (lượt cũ tự thoát ở `watch`).
      if (epoch === serversEpoch) serversReading.value = false
    }
  }

  // Đổi tài khoản/region thì số cũ phải BIẾN MẤT. Watch này cố ý chỉ XOÁ: nó không
  // được gọi AWS hộ người dùng (xem luật đầu file).
  watch([profile, region], () => {
    serversEpoch += 1
    servers.value = null
    serversError.value = ''
    // Lượt đang bay giờ là lượt cũ và sẽ không tự tắt cờ nữa (con dấu đã đổi), nên
    // phải tắt ở đây — không thì thẻ kẹt ở "Đang đọc…" vĩnh viễn.
    serversReading.value = false

    // Thẻ "Lỗi 1 giờ qua" cũng phải quên số cũ — và ở đây còn nặng hơn: lượt đang
    // chạy TỐN TIỀN theo GB quét, nên để nó tiếp tục là vừa giữ số của tài khoản cũ
    // trên màn vừa trả tiền cho tài khoản cũ.
    errorsEpoch += 1
    result.value = null
    estimate.value = null
    checkError.value = ''
    // Nhịp chờ đang treo: đánh thức nó để `runErrors()` thoát, và con dấu mới bảo nó
    // đừng ghi gì. `void` + bọc `catch` vì đây là huỷ nhân danh người dùng, không
    // phải một sự kiện đáng chặn UI.
    if (running.value || estimating.value) {
      cancelled = true
      stopTimer()
      const id = activeQueryId
      const old = activeCtx
      if (id) void api.cancel(id, old.profile, old.region).catch(() => {})
      running.value = false
      estimating.value = false
      activeQueryId = ''
    }
  })

  const serversLamp = computed<OvLamp>(() => {
    const s = servers.value
    if (serversReading.value || serversError.value || !s) return 'unknown'
    // Xanh chỉ khi MỌI máy đang `running` — đó là điều EC2 vừa kể, không phải phán
    // đoán về sức khoẻ dịch vụ. Tài khoản/region KHÔNG có máy nào cũng không được
    // coi là "bình thường": đó là thứ đáng nhìn lại (sai region, sai tài khoản).
    if (s.total === 0) return 'warn'
    return s.notRunning.length > 0 ? 'warn' : 'ok'
  })

  /** Đèn của thẻ Lỗi. Tên có tiền tố vì màn này giờ có hai thẻ đèn sống. */
  const errorsLamp = computed<OvLamp>(() => {
    if (running.value) return 'unknown'
    if (checkError.value) return 'unknown'
    if (!result.value) return 'unknown'
    // KHÔNG dùng đèn đỏ cho một con số đếm: mẫu lỗi khớp cả dòng vô hại ("0 failed"),
    // và AWOG không đủ dữ kiện để phán mức nghiêm trọng. Đèn vàng + con số thật, rồi
    // người dùng mở Logs để đọc — trung thực hơn một phán đoán sai.
    return result.value.n > 0 ? 'warn' : 'ok'
  })

  return {
    profile,
    pinnedProfile,
    pinnedRegion,
    tools,
    profiles,
    matrix,
    prodAccountIds,
    bypassUntil,
    updatedAt,
    loading,
    refresh,
    recentGroups,
    checkGroups,
    estimate,
    estimating,
    running,
    result,
    checkError,
    errorsLamp,
    canEstimate,
    canRun,
    estimateErrors,
    runErrors,
    cancelCheck,
    servers,
    serversReading,
    serversError,
    serversLamp,
    readServers,
  }
}

/** Dòng của `stats count(*) as n` ⇒ con số. Không đọc được ⇒ 0, và 0 ở đây nghĩa
 *  là "câu trả lời rỗng", đúng như CloudWatch trả về khi không khớp dòng nào. */
function countServers(rows: readonly InfraResourceRow[]): {
  total: number
  running: number
  notRunning: string[]
} {
  let running = 0
  const notRunning: string[] = []
  for (const row of rows) {
    if (row['state'] === 'running') {
      running += 1
      continue
    }
    notRunning.push(row['name'] || row['id'] || '?')
  }
  return { total: rows.length, running, notRunning }
}

function countOf(rows: readonly AwsInsightsRow[]): number {
  const raw = rows[0]?.n ?? rows[0]?.['count(*)'] ?? '0'
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}
