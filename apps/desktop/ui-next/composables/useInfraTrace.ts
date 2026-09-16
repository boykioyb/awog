import { computed, ref, shallowRef } from 'vue'
import { useAwsLogsApi } from '~/composables/useAwsLogsApi'
import { useInfraContext } from '~/composables/useInfraContext'
import type { AwsTrace, AwsTraceStartResult } from '~/composables/useAwsLogsApi'

// Page-controller cho chế độ "Lần theo request" của màn Logs (L5).
//
// ⚠ LUẬT SỐ MỘT CỦA MÀN LOGS ÁP NGUYÊN Ở ĐÂY — KHÔNG BAO GIỜ TỰ CHẠY. Không
// `watch`/`onMounted` nào gọi `run()`. Nhánh log của L5 là một truy vấn Insights
// thật, tính tiền theo GB quét như mọi câu khác.
//
// VÌ SAO TÁCH KHỎI `useInfraLogs.ts`: file kia đã 700 dòng và sở hữu hai chế độ
// khác (tail + Insights). Chế độ này có vòng đời riêng (một id, một truy vấn, một
// dòng thời gian) và KHÔNG dùng lại `rows`/`facets`/`histogram` của bên đó — gộp
// vào chỉ để "cùng màn Logs" là trộn ba lý do thay đổi vào một file.
//
// Tham số chạy (nhóm log + khoảng thời gian) do bên gọi đưa vào qua `params()` chứ
// không tự đọc: chúng thuộc về cột trái của màn Logs, và sao chép state ấy sang
// đây là tạo bản thứ hai có thể trôi lệch.

const POLL_MS = 1500
/** Trần chờ phía UI — cùng con số với `useInfraLogs`. */
const POLL_MAX_MS = 5 * 60_000

export type TraceRunParams = {
  logGroups: string[]
  startMs: number
  endMs: number
  estimatedUsd?: number | undefined
}

export function useInfraTrace(params: () => TraceRunParams) {
  const api = useAwsLogsApi()
  // `sessionId: null` — màn `/infra` đọc ngữ cảnh của APP, không của phiên đang mở.
  // Cùng lời gọi với `useInfraLogs`, nên hai chế độ của màn Logs không bao giờ chạy
  // trên hai tài khoản khác nhau.
  const infraContext = useInfraContext({ sessionId: null })
  const profile = computed(() => infraContext.appValue.value.profile ?? '')
  const region = computed(() => infraContext.appValue.value.region ?? '')

  /** Id người dùng dán vào. KHÔNG tự điền từ đâu — nó là câu hỏi của họ. */
  const traceId = ref('')
  const running = ref(false)
  const error = ref('')
  /** Khoá i18n nói nhánh X-Ray đã thử và không dùng được. */
  const notes = ref<string[]>([])
  const bytesScanned = ref(0)
  const ranAt = ref(0)
  /** `shallowRef`: dòng thời gian được THAY NGUYÊN KHỐI mỗi lượt, không sửa từng chặng. */
  const trace = shallowRef<AwsTrace | null>(null)
  /** Chặng đang mở để đọc log nguyên bản. */
  const openHopKey = ref('')

  let queryId = ''
  let cancelled = false

  const canRun = computed(() => traceId.value.trim().length > 0 && !running.value)
  const hops = computed(() => trace.value?.hops ?? [])
  const failedHop = computed(() => hops.value.find((h) => h.status === 'error') ?? null)

  function reset(): void {
    error.value = ''
    notes.value = []
    bytesScanned.value = 0
    trace.value = null
    openHopKey.value = ''
    queryId = ''
  }

  /**
   * Chạy một lượt lần theo.
   *
   * Nhánh nào chạy là do SIDECAR quyết (nó dò X-Ray), không phải UI đoán trước —
   * xem đầu `infra/logs/trace.ts`. Ở đây chỉ có hai đường xử lý kết quả.
   */
  async function run(): Promise<void> {
    if (!canRun.value) return
    const id = traceId.value.trim()
    const p = params()
    reset()
    running.value = true
    cancelled = false

    let started: AwsTraceStartResult
    try {
      started = await api.traceStart({
        id,
        logGroups: p.logGroups,
        startMs: p.startMs,
        endMs: p.endMs,
        ...(p.estimatedUsd !== undefined ? { estimatedUsd: p.estimatedUsd } : {}),
        ...(profile.value ? { profile: profile.value } : {}),
        ...(region.value ? { region: region.value } : {}),
      })
    } catch (err) {
      running.value = false
      error.value = messageOf(err)
      return
    }

    if (!started.ok) {
      running.value = false
      error.value = started.error
      return
    }

    if (started.mode === 'xray') {
      trace.value = started.trace
      ranAt.value = Date.now()
      running.value = false
      return
    }

    notes.value = started.notes
    queryId = started.queryId
    await poll(id)
  }

  /** Vòng poll — cùng nhịp và cùng trần với truy vấn Insights thường. */
  async function poll(id: string): Promise<void> {
    const startedAt = Date.now()
    while (!cancelled) {
      await sleep(POLL_MS)
      if (cancelled) break
      if (Date.now() - startedAt > POLL_MAX_MS) {
        error.value = 'TIMEOUT'
        break
      }
      let reply
      try {
        reply = await api.traceStatus({
          queryId,
          id,
          ...(profile.value ? { profile: profile.value } : {}),
          ...(region.value ? { region: region.value } : {}),
        })
      } catch (err) {
        error.value = messageOf(err)
        break
      }
      if (!reply.ok) {
        error.value = reply.error
        break
      }
      bytesScanned.value = reply.bytesScanned
      if (reply.trace) {
        trace.value = reply.trace
        ranAt.value = Date.now()
        break
      }
      // Trạng thái kết thúc mà KHÔNG có dòng thời gian ⇒ truy vấn hỏng/bị huỷ.
      // `Unknown` cũng dừng: hỏi mãi một trạng thái không hiểu là vòng lặp vô tận.
      if (reply.status !== 'Scheduled' && reply.status !== 'Running') {
        if (reply.status !== 'Complete') error.value = reply.status
        break
      }
    }
    running.value = false
  }

  /**
   * Huỷ THẬT: truy vấn chưa xong vẫn quét và vẫn tính tiền cho tới khi AWS tự kết
   * thúc, nên ngừng poll là chưa đủ (cùng bài học với `infra.logs-query-cancel`).
   */
  async function cancel(): Promise<void> {
    cancelled = true
    running.value = false
    if (!queryId) return
    const id = queryId
    queryId = ''
    try {
      await api.cancel(id, profile.value || undefined, region.value || undefined)
    } catch {
      // Huỷ một truy vấn đã xong trả lỗi từ AWS — người dùng vẫn đạt được điều họ
      // muốn, nên không có gì để báo.
    }
  }

  /** Bấm một chặng để đọc log nguyên bản của nó (đóng/mở). */
  function toggleHop(key: string): void {
    openHopKey.value = openHopKey.value === key ? '' : key
  }

  /** Dán một id rồi chạy ngay — đường vào từ một dòng log ở bảng kết quả. */
  async function traceFrom(id: string): Promise<void> {
    traceId.value = id
    await run()
  }

  return {
    traceId,
    running,
    error,
    notes,
    bytesScanned,
    ranAt,
    trace,
    hops,
    failedHop,
    openHopKey,
    canRun,
    run,
    cancel,
    toggleHop,
    traceFrom,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
