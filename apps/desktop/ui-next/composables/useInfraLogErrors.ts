// "Lỗi trong log" của màn Giám sát — số liệu CloudWatch nói CÓ BAO NHIÊU lỗi,
// log ứng dụng nói LỖI GÌ, và cho tới nay màn Giám sát không có đường nào tới đó.
//
// HAI ĐƯỜNG, HAI ĐỒNG HỒ TÍNH TIỀN KHÁC NHAU — và đó là lý do chúng KHÔNG gộp:
//
//   · ĐỌC (`filter-log-events`) trả lời "5 phút qua có lỗi GÌ". Tính tiền theo SỐ
//     REQUEST, không theo dung lượng quét, nên nó rẻ, nhanh, chạy được ngay sau
//     một cú bấm mà không cần hộp duyệt. Đây là câu hỏi người ta hỏi trước.
//   · ĐẾM (`Insights`) trả lời "lỗi rải ra thế nào theo thời gian". Tính tiền theo
//     SỐ GB QUÉT nên nó là bước phụ, có ước lượng và hộp duyệt riêng.
//
// Bản đầu (2026-09-17) CHỈ có đường đếm — người dùng chỉ ra ngay rằng một cột số
// không trả lời được "có lỗi gì", và họ đúng: biết có 47 lỗi mà không biết lỗi nào
// thì vẫn phải mở tab Nhật ký ra đọc, tức là màn Giám sát chưa làm xong việc.
//
// BA LUẬT CÒN LẠI CỦA FILE NÀY:
//
//   1. KHÔNG TỰ CHẠY, VÀ KHÔNG ĐI KÈM NÚT "NẠP". Insights tính tiền theo SỐ GB
//      QUÉT — khác hẳn `get-metric-data` (tính theo số metric × điểm) và khác hẳn
//      `filter-log-events` (tính theo request). Một hoá đơn quét lặng lẽ mỗi lần
//      người dùng bấm Nạp là cách nhanh nhất để họ tắt cả màn này đi. Nó là một
//      NÚT RIÊNG, bấm riêng.
//
//   2. NGƯỜI DÙNG PHẢI NHÌN THẤY ƯỚC LƯỢNG TRƯỚC. Đây là luật của
//      `methods/infra.logs-query-start.ts` ("UI chịu trách nhiệm bắt buộc bước
//      đó"), không phải phép lịch sự: `infra.logs-estimate` chạy trước, con số đi
//      vào hộp duyệt hạ tầng, và chỉ cú bấm của người dùng mới mở `start-query`.
//
//   3. NHÓM LOG `guess` PHẢI NÓI RA LÀ PHỎNG ĐOÁN. Với ECS ta đọc được tên nhóm
//      từ task definition (`exact`); với mọi loại khác ta khớp theo tên, nên danh
//      sách SÓT được. Một biểu đồ "0 lỗi" dựng trên một nhóm log sai là kết luận
//      sai tệ nhất màn này có thể đưa ra, nên `basis` đi kèm mọi kết quả.
import { computed, ref } from 'vue'
import { useConfirm } from '~/composables/useConfirm'
import { useI18n } from '~/composables/useI18n'
import { useSidecar } from '~/composables/useSidecar'
import { useToast } from '~/composables/useToast'
import type { InfraContextWire, MonitorTarget, WirePoint } from '~/composables/useInfraMetrics'
import { groupErrorLines, type ErrorGroup, type ErrorLine } from '~/utils/log-errors'

/** Nhịp hỏi kết quả Insights — cùng nhịp với màn Nhật ký. */
const POLL_MS = 1500
/** Trần số lượt hỏi. 60 × 1,5s = 90 giây; Insights quá đó thì gần như luôn là hỏng. */
const MAX_POLLS = 60

/**
 * Trần dòng lấy về MỖI nhóm log cho lượt đọc.
 *
 * `filter-log-events` trả mới-nhất-trước (`--no-start-from-head`), nên 300 dòng đầu
 * là 300 dòng GẦN NHẤT — đủ để thấy chuyện gì vừa xảy ra, và sau khi gộp thì 300
 * dòng thường rút lại còn vài nhóm. Cao hơn chỉ làm chậm mà không đổi kết luận.
 */
const TAIL_LIMIT = 300

/** Trần nhóm log gọi trong một lượt đọc — mỗi nhóm là MỘT lời gọi (xem `readRecent`). */
const MAX_READ_GROUPS = 5

/**
 * Cửa sổ nhanh của phần ĐỌC, tách khỏi khoảng thời gian của biểu đồ.
 *
 * "5 phút qua có lỗi gì" là câu hỏi người ta hỏi khi vừa có chuyện, và nó KHÔNG
 * cùng nhịp với cửa sổ 3 giờ của biểu đồ số liệu. Bắt hai thứ dùng chung một khoảng
 * là ép người dùng đổi trục hoành của cả màn chỉ để liếc 5 phút gần nhất.
 */
export const RECENT_SPANS = [300, 900, 3600] as const
export type RecentSpan = (typeof RECENT_SPANS)[number]

/**
 * Bộ lọc của `filter-log-events`.
 *
 * ⚠ ĐÂY KHÔNG PHẢI REGEX. Cú pháp filter pattern của CloudWatch: `?A ?B` nghĩa là
 * "chứa A HOẶC chứa B", so khớp chuỗi con và PHÂN BIỆT HOA THƯỜNG — nên mỗi cách
 * viết phải liệt kê riêng. Viết một regex ở đây thì CloudWatch không báo lỗi, nó chỉ
 * lặng lẽ coi cả chuỗi là một từ khoá và trả về rỗng.
 *
 * Cố ý RỘNG: thiếu sót ở đây hiện ra thành "không có lỗi nào", tức một kết luận sai
 * về hệ thống; dư thừa chỉ hiện ra thành một nhóm rác mà mắt bỏ qua được trong một
 * giây. Danh sách này hiện nguyên văn ra UI để người dùng biết mình đang lọc theo gì.
 */
export const ERROR_FILTER_PATTERN =
  '?ERROR ?Error ?error ?EXCEPTION ?Exception ?exception ?FATAL ?Fatal ?fatal ?CRITICAL ?Critical ?Traceback ?panic ?PANIC'

type LogGroupsWire = { groups: string[]; basis: 'exact' | 'guess'; error: string }
type TailWire =
  | { ok: true; events: ErrorLine[]; truncated: boolean; nextToken: string | null }
  | { ok: false; error: string }
type EstimateWire =
  | { ok: true; bytes: number; usd: number; basis: string }
  | { ok: false; error: string }
type StartWire = { ok: true; queryId: string } | { ok: false; error: string }
type PollWire =
  | { ok: true; status: string; rows: Record<string, string>[]; bytesScanned: number }
  | { ok: false; error: string }

/**
 * Câu lệnh Insights. `bin(<n>s)` bám ĐÚNG bước nhóm của các biểu đồ bên cạnh —
 * hai trục thời gian cùng một màn mà chia ô khác nhau thì không so được bằng mắt.
 *
 * Bộ lọc cố ý RỘNG và không phân biệt hoa thường: mỗi ngôn ngữ ghi một kiểu
 * (`ERROR`, `Error`, `error:`, `Exception`, `Traceback`, `FATAL`). Rộng thì đếm
 * thừa, hẹp thì đếm thiếu — và đếm thiếu ở đây đọc ra thành "hệ thống khoẻ".
 */
export function errorCountQuery(periodSeconds: number): string {
  const bin = Math.max(60, Math.round(periodSeconds))
  return (
    'fields @timestamp, @message' +
    ' | filter @message like /(?i)(error|exception|fatal|traceback|panic)/' +
    ` | stats count(*) as errors by bin(${String(bin)}s)`
  )
}

/**
 * Hàng kết quả ⇒ điểm trên trục thời gian.
 *
 * Insights đặt tên cột bin theo chính biểu thức (`bin(300s)`), nên KHÔNG tra theo
 * một tên cố định: lấy cột không phải `errors` làm mốc thời gian. Mốc là chuỗi
 * `YYYY-MM-DD HH:mm:ss.SSS` giờ UTC KHÔNG có hậu tố múi giờ — thiếu chữ `Z` thì
 * `new Date()` đọc nó theo giờ MÁY, và cả biểu đồ lệch đúng bằng lệch múi giờ.
 */
export function rowsToPoints(rows: readonly Record<string, string>[]): WirePoint[] {
  const out: WirePoint[] = []
  for (const row of rows) {
    const binKey = Object.keys(row).find((k) => k !== 'errors')
    if (!binKey) continue
    const raw = row[binKey]
    const count = Number(row['errors'])
    if (!raw || !Number.isFinite(count)) continue
    const iso = raw.includes('T') ? raw : raw.replace(' ', 'T')
    const t = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`)
    if (!Number.isFinite(t)) continue
    out.push({ t, v: count })
  }
  return out.sort((a, b) => a.t - b.t)
}

export function useInfraLogErrors() {
  const sc = useSidecar()
  const { t } = useI18n()
  const toast = useToast()
  const { confirm } = useConfirm()

  const groups = ref<string[]>([])
  const basis = ref<'exact' | 'guess'>('guess')
  const resolving = ref(false)
  const running = ref(false)
  const points = ref<WirePoint[]>([])
  /** Đã chạy xong ít nhất một lượt — phân biệt "0 lỗi" với "chưa hỏi". */
  const ran = ref(false)
  const bytesScanned = ref(0)
  const error = ref('')

  // ── Đường ĐỌC: "5 phút qua có lỗi gì" ────────────────────────────────────
  const reading = ref(false)
  const recent = ref<ErrorGroup[]>([])
  /** Đã đọc xong ít nhất một lượt — phân biệt "không có lỗi nào" với "chưa hỏi". */
  const read = ref(false)
  /** Cửa sổ đã đọc, tính bằng giây. Hiện ra để câu trả lời luôn kèm phạm vi của nó. */
  const readSpan = ref<RecentSpan>(300)
  /** Còn dòng chưa lấy về ở ít nhất một nhóm ⇒ con số bên dưới là SÀN, không phải tổng. */
  const readTruncated = ref(false)
  /** Dòng khớp bộ lọc nhưng tự khai mức bình thường — nói ra để con số đọc được. */
  const readDropped = ref(0)
  const readError = ref('')

  const ready = computed(() => groups.value.length > 0)
  /** Tổng số dòng lỗi sau khi gộp — con số của câu "5 phút qua có lỗi gì". */
  const recentTotal = computed(() => recent.value.reduce((n, g) => n + g.count, 0))

  /** Vứt kết quả cũ. Đổi tài nguyên hay cửa sổ ⇒ con số cũ không còn nói về gì cả. */
  function reset(): void {
    groups.value = []
    points.value = []
    ran.value = false
    bytesScanned.value = 0
    error.value = ''
    recent.value = []
    read.value = false
    readTruncated.value = false
    readDropped.value = 0
    readError.value = ''
  }

  /**
   * Tìm nhóm log của tài nguyên. RẺ (chỉ metadata) và tách khỏi lượt chạy đắt: người
   * dùng thấy tìm được nhóm nào rồi mới quyết có trả tiền quét hay không.
   */
  async function resolveGroups(target: MonitorTarget, ctx: InfraContextWire): Promise<void> {
    if (resolving.value) return
    resolving.value = true
    error.value = ''
    try {
      const cluster = target.dimensions.find((d) => d.name === 'ClusterName')?.value
      // TÊN ĐẦY ĐỦ, KHÔNG PHẢI NHÃN. `label` của một nhóm log đã bị cắt bỏ tiền tố
      // để đọc cho gọn (`/aws/ecs/api` → `api`), mà CloudWatch chỉ nhận tên đầy đủ.
      // Giá trị dimension là bản chưa cắt, nên nó là thứ đi lên dây.
      const logGroupName = target.dimensions.find((d) => d.name === 'LogGroupName')?.value
      const res = await sc.request<LogGroupsWire>('infra.monitor-log-groups', {
        kind: target.kind,
        name: logGroupName ?? target.label,
        ...(cluster ? { cluster } : {}),
        ...(ctx.profile ? { profile: ctx.profile } : {}),
        ...(ctx.region ? { region: ctx.region } : {}),
      })
      groups.value = res.groups
      basis.value = res.basis
      error.value = res.error
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      resolving.value = false
    }
  }

  /**
   * ĐỌC dòng lỗi gần đây — câu trả lời cho "5 phút qua có lỗi gì".
   *
   * MỘT LỜI GỌI CHO MỖI NHÓM LOG, và đó không phải lựa chọn: `filter-log-events`
   * chỉ nhận `--log-group-name` SỐ ÍT (khác `start-query` của Insights vốn nhận số
   * nhiều), nên `tailWindow` lấy nhóm đầu và bỏ qua phần còn lại. Một task ECS
   * nhiều container thì ghi ra nhiều nhóm, và im lặng đọc mỗi nhóm đầu là bỏ sót
   * đúng những lỗi ở sidecar. `MAX_READ_GROUPS` chặn số lời gọi.
   *
   * KHÔNG CÓ HỘP DUYỆT Ở ĐÂY, và đó là đúng: lệnh này tính tiền theo số request chứ
   * không theo GB quét, nên nó cùng hạng với mọi lời gọi đọc khác của màn. Cú bấm
   * của người dùng chính là sự cho phép — hệt tab Nhật ký.
   *
   * MỘT NHÓM HỎNG KHÔNG LÀM HỎNG CẢ LƯỢT: thiếu quyền trên một nhóm là chuyện
   * thường, và trả về rỗng sẽ đọc ra thành "không có lỗi nào".
   */
  async function readRecent(spanSeconds: RecentSpan, ctx: InfraContextWire): Promise<void> {
    if (reading.value || groups.value.length === 0) return
    reading.value = true
    readError.value = ''
    const endMs = Date.now()
    const startMs = endMs - spanSeconds * 1000

    try {
      const picked = groups.value.slice(0, MAX_READ_GROUPS)
      const results = await Promise.all(
        picked.map(async (group): Promise<TailWire> => {
          try {
            return await sc.request<TailWire>('infra.logs-tail', {
              logGroups: [group],
              startMs,
              endMs,
              filterPattern: ERROR_FILTER_PATTERN,
              limit: TAIL_LIMIT,
              ...(ctx.profile ? { profile: ctx.profile } : {}),
              ...(ctx.region ? { region: ctx.region } : {}),
            })
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) }
          }
        }),
      )

      const lines: ErrorLine[] = []
      const errs: string[] = []
      let truncated = false
      for (const res of results) {
        if (!res.ok) {
          errs.push(res.error)
          continue
        }
        lines.push(...res.events)
        if (res.truncated) truncated = true
      }

      const folded = groupErrorLines(lines)
      recent.value = folded.groups
      readDropped.value = folded.dropped
      readSpan.value = spanSeconds
      readTruncated.value = truncated
      // MỌI nhóm hỏng ⇒ đó là lỗi của cả lượt. Một phần hỏng thì hiện phần đọc được
      // và vẫn nói ra phần hỏng — danh sách thiếu mà im lặng là kết luận sai.
      readError.value = errs.length > 0 ? [...new Set(errs)].join(' · ') : ''
      read.value = errs.length < picked.length
    } finally {
      reading.value = false
    }
  }

  /**
   * Chạy lượt đếm. Ba bước, và bước giữa KHÔNG bỏ qua được (luật 2 ở đầu file):
   * ước lượng → người dùng duyệt kèm con số → `start-query` → poll.
   */
  async function run(
    window: { startMs: number; endMs: number },
    periodSeconds: number,
    ctx: InfraContextWire,
  ): Promise<void> {
    if (running.value || groups.value.length === 0) return
    const query = errorCountQuery(periodSeconds)

    running.value = true
    error.value = ''
    try {
      const est = await sc.request<EstimateWire>('infra.logs-estimate', {
        logGroups: groups.value,
        query,
        ...(ctx.profile ? { profile: ctx.profile } : {}),
        ...(ctx.region ? { region: ctx.region } : {}),
      })
      if (!est.ok) {
        error.value = est.error
        return
      }

      const ok = await confirm({
        kind: 'infra',
        action: t('infra.monitoring.logErrors.confirmAction'),
        target: groups.value.join(', '),
        consequence: t('infra.monitoring.logErrors.confirmCost', {
          gb: (est.bytes / 1024 ** 3).toFixed(2),
          usd: est.usd.toFixed(3),
        }),
        command: `aws logs start-query --log-group-names ${groups.value.join(' ')} --query-string '${query}'`,
        context: { ...ctx },
        accountKind: 'normal',
        class: 'read',
      })
      if (!ok) return

      const started = await sc.request<StartWire>('infra.logs-query-start', {
        logGroups: groups.value,
        query,
        startMs: window.startMs,
        endMs: window.endMs,
        estimatedUsd: est.usd,
        ...(ctx.profile ? { profile: ctx.profile } : {}),
        ...(ctx.region ? { region: ctx.region } : {}),
      })
      if (!started.ok) {
        error.value = started.error
        return
      }

      for (let i = 0; i < MAX_POLLS; i += 1) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        const poll = await sc.request<PollWire>('infra.logs-query-status', {
          queryId: started.queryId,
          ...(ctx.profile ? { profile: ctx.profile } : {}),
          ...(ctx.region ? { region: ctx.region } : {}),
        })
        if (!poll.ok) {
          error.value = poll.error
          return
        }
        if (poll.status === 'Scheduled' || poll.status === 'Running') continue
        if (poll.status !== 'Complete') {
          error.value = t('infra.monitoring.logErrors.queryFailed', { status: poll.status })
          return
        }
        points.value = rowsToPoints(poll.rows)
        bytesScanned.value = poll.bytesScanned
        ran.value = true
        return
      }
      // Hết lượt hỏi mà chưa xong: nói ra, KHÔNG hiện một biểu đồ rỗng trông như
      // "không có lỗi nào".
      error.value = t('infra.monitoring.logErrors.timeout')
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      toast.add({ title: t('infra.monitoring.logErrors.failed'), color: 'error' })
    } finally {
      running.value = false
    }
  }

  return {
    groups,
    basis,
    resolving,
    ready,
    reset,
    resolveGroups,
    // đọc — rẻ, trả lời "có lỗi gì"
    reading,
    recent,
    recentTotal,
    read,
    readSpan,
    readTruncated,
    readDropped,
    readError,
    readRecent,
    // đếm — tốn tiền, trả lời "rải ra thế nào theo thời gian"
    running,
    points,
    ran,
    bytesScanned,
    error,
    run,
  }
}
