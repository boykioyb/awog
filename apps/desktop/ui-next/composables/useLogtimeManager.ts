import { computed, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useConfirm } from '~/composables/useConfirm'
import { copyText } from '~/utils/clipboard'
import {
  buildLogtimeReport,
  type LogtimeReportForm,
  type ReportLabels,
  type ReportLine,
} from '~/utils/logtime-report'
import {
  monthOfDate,
  todayKey,
  useLogtimeStore,
  type LogtimeEntry,
  type LogtimePushResult,
  type LogtimeSuggestion,
  type PmsOption,
} from '~/stores/logtime'

// Page-controller cho `/logtime` (ADR 0091). Toàn bộ state + handler của trang ở
// đây; `pages/logtime.vue` chỉ còn template — xem quy ước page-controller trong
// .claude/rules/nuxt-vue.md.
//
// Luật giờ KHÔNG nằm ở đây mà ở store (`addEntry`): composable chỉ dịch kết quả
// của cổng đó thành thông báo cho người dùng.

export type LogtimeView = 'day' | 'week' | 'setup'

/** Một ô trong bảng tuần: giờ của một dự án trong một ngày, tách nháp / đã đẩy. */
export type WeekCell = { draft: number; posted: number; total: number }

/** Một hàng dự án của bảng tuần: 7 ô ngày + tổng. */
export type WeekRow = {
  projectKey: string
  label: string
  color: string
  sourceName: string
  cells: WeekCell[]
  total: number
}

/** Bốn tile tổng của màn tuần. */
export type WeekTiles = {
  total: number
  posted: number
  draft: number
  topLabel: string
  topHours: number
  topPct: number
  shortDays: number
  shortDayLabel: string
}

/** Một dải màu trong thanh dự án — dùng chung cho dải ngày ở cột tháng và tile ngày. */
export type DaySegment = { key: string; hours: number; pct: number; color: string }

/** Một dòng trong cột ngày của tháng. */
export type MonthDay = {
  date: string
  total: number
  entries: number
  drafts: number
  /** "N dòng" / "chưa khai gì" — phần đầu của dòng phụ. */
  sub: string
  /** "N nháp" / "đã đẩy" — phần cuối; rỗng khi ngày chưa khai gì. */
  tail: string
  /** `tail` đang nói về nháp ⇒ tô amber. */
  tailDraft: boolean
  /** Giờ còn thiếu cho đủ mức ngày — dải xám cuối thanh. */
  rest: number
  segments: DaySegment[]
}

const fmt = (n: number): string => n.toFixed(1)

// Ngày địa phương từ khoá `YYYY-MM-DD`. `new Date('2026-09-18')` là UTC nên ở múi
// giờ âm sẽ lùi mất một ngày — luôn dựng qua các thành phần số.
function localDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

function keyOf(dt: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

function shiftDate(date: string, deltaDays: number): string {
  const dt = localDate(date)
  dt.setDate(dt.getDate() + deltaDays)
  return keyOf(dt)
}

// Thứ Hai của tuần chứa `date` (tuần bắt đầu từ T2 như bản phác). `getDay()` trả 0=CN,
// nên lùi về T2 là `(day + 6) % 7` ngày.
function mondayOf(date: string): string {
  const dt = localDate(date)
  const back = (dt.getDay() + 6) % 7
  return shiftDate(date, -back)
}

// Số tuần ISO-8601 của `date` — tuần chứa Thứ Năm quyết định năm/tuần. Chỉ để hiện
// "Tuần 38", không tham gia tính toán giờ.
function isoWeek(date: string): number {
  const dt = localDate(date)
  // Về Thứ Năm cùng tuần (ISO: T2=1..CN=7).
  const day = (dt.getDay() + 6) % 7
  dt.setDate(dt.getDate() - day + 3)
  const firstThursday = new Date(dt.getFullYear(), 0, 4)
  const ft = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - ft + 3)
  return 1 + Math.round((dt.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
}

// Rút SỐ ISSUE từ tiêu đề khi phiên không mang link `/issues/` (aboutGhUrl). CHỈ nhận
// tín hiệu rõ ràng — "#123" hoặc "issue 123" — KHÔNG bắt số trần ("590" không tự thành
// issue) và KHÔNG bắt "PR 123"/"pull 123" (PR không auto-link được). Deterministic, và
// người dùng vẫn thấy chip issue để gỡ nếu sai trước khi đẩy.
function detectIssueFromTitle(title: string): number | undefined {
  // "PR #12" / "pull request #12" ⇒ bỏ qua (đằng trước số là dấu hiệu PR).
  if (/\b(pr|pull\s*request)\b[^0-9]{0,6}#?\d+/i.test(title)) return undefined
  const m = /(?:#|\bissue\s+#?)(\d{1,7})\b/i.exec(title)
  return m ? Number(m[1]) : undefined
}

// Giờ:phút ĐỊA PHƯƠNG của một mốc ISO — thẻ gợi ý hiện "16:30" bên phải để người dùng
// nhận ra buổi làm nào. Đây là giờ đồng hồ, KHÔNG phải số giờ công: chúng cố ý là hai
// thứ khác nhau (xem `LogtimeSuggestion`). Chuỗi hỏng ⇒ Date invalid ⇒ trả rỗng, không
// hiện "NaN:NaN".
function clockOf(at: string): string {
  const ms = Date.parse(at)
  if (Number.isNaN(ms)) return ''
  const dt = new Date(ms)
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

// Tên thứ / tên tháng đi qua i18n chứ không qua `Intl`: nhãn phải theo ngôn ngữ của
// APP (Settings), không theo locale hệ điều hành. Liệt kê khoá thành mảng literal
// để chúng còn greppable — `t('logtime.wd.' + i)` thì không ai kiểm được.
const WEEKDAY_KEYS = [
  'logtime.wd.0',
  'logtime.wd.1',
  'logtime.wd.2',
  'logtime.wd.3',
  'logtime.wd.4',
  'logtime.wd.5',
  'logtime.wd.6',
] as const

// Thứ viết tắt cho đầu cột bảng tuần ("T2".."CN" / "Mon".."Sun"). getDay(): 0=CN.
const SHORT_WEEKDAY_KEYS = [
  'logtime.wds.0',
  'logtime.wds.1',
  'logtime.wds.2',
  'logtime.wds.3',
  'logtime.wds.4',
  'logtime.wds.5',
  'logtime.wds.6',
] as const

const MONTH_KEYS = [
  'logtime.mn.1',
  'logtime.mn.2',
  'logtime.mn.3',
  'logtime.mn.4',
  'logtime.mn.5',
  'logtime.mn.6',
  'logtime.mn.7',
  'logtime.mn.8',
  'logtime.mn.9',
  'logtime.mn.10',
  'logtime.mn.11',
  'logtime.mn.12',
] as const

// Màu để PHÂN BIỆT dải dự án, không mang nghĩa trạng thái.
const PALETTE = ['var(--violet)', 'var(--blue)', 'var(--accent)', 'var(--amber)', 'var(--pink)']

// SINGLETON cấp module: trang và các component con cùng đọc một state. Gọi
// `useLogtimeManager()` ở mỗi component thay vì chuyền 20 prop xuống — cùng kiểu
// với useGlobalTerminal / useMinimizeDock trong repo.
let instance: ReturnType<typeof createManager> | null = null

export function useLogtimeManager(): ReturnType<typeof createManager> {
  if (!instance) instance = createManager()
  return instance
}

function createManager() {
  const store = useLogtimeStore()
  const sessions = useSessionsStore()
  const { t } = useI18n()
  const { add: toast } = useToast()
  const { confirm } = useConfirm()

  const view = ref<LogtimeView>('day')
  const date = ref(todayKey())
  const pushOpen = ref(false)
  const pushConfirmed = ref(false)
  const pushResults = ref<LogtimePushResult[]>([])
  const pushing = ref(false)

  // Form nhanh
  const formProject = ref('')
  const formNote = ref('')
  const formHours = ref(1)
  const formTask = ref<{ id?: string; issue?: number; title?: string } | null>(null)
  // Gợi ý đang nằm trong form (nếu dòng này đến từ một gợi ý). `formSourceRef` theo dòng
  // xuống `addEntry` để dòng công nhớ nguồn; `stagedRef` để thẻ tô "đang ở form".
  const formSourceRef = ref('')
  // Loại nguồn của gợi ý đang ở form ('session'|'task') — cần để "Sửa bằng AI" đọc đúng
  // digest (compose-line dùng kind + refId). Rỗng = dòng gõ tay, không có nguồn.
  const formSourceKind = ref<'session' | 'task' | ''>('')
  const stagedRef = ref('')
  // refId đang được AI tóm tắt — thẻ đó hiện spinner trên nút.
  const composingRef = ref('')

  // Picker task
  const taskOpen = ref(false)
  const taskLoading = ref(false)
  const taskOptions = ref<PmsOption[]>([])
  // Ô tìm task: gõ là HỎI LẠI PMS theo `q` (worklog_list_tasks có thể cắt bớt kết quả
  // nên lọc client không đủ — task cần tìm có thể chưa nằm trong loạt đầu). Debounce ở
  // component; ở đây giữ nguồn đang mở + số thứ tự request để bỏ kết quả về trễ.
  const taskQuery = ref('')
  const taskCtx = ref<{ sourceId: string; pmsProjectId: string } | null>(null)
  let taskReqSeq = 0

  // Báo cáo ngày (modal riêng, xem LogtimeReportModal.vue). Chỉ giữ ĐANG MỞ + đang ở
  // dạng nào; nội dung là computed nên sửa một dòng công là báo cáo đổi theo ngay,
  // không có bản sao nào để lệch.
  const reportOpen = ref(false)
  const reportForm = ref<LogtimeReportForm>('brief')

  // Soạn bằng AI (modal riêng, xem LogtimeAiModal.vue). Chỉ giữ ĐANG MỞ; đề xuất +
  // context sống ở store (state của lượt gọi model).
  const aiOpen = ref(false)

  // Màn tuần: dữ liệu ngày NGOÀI tháng đang mở (tuần bắc cầu sang tháng lân cận). Nạp
  // on-demand qua `store.fetchMonthDays`, không đụng `store.days` của màn ngày.
  const weekExtra = ref<Record<string, LogtimeEntry[]>>({})

  const settings = computed(() => store.settings)
  const entries = computed(() => store.entriesOf(date.value))
  const total = computed(() => store.totalOf(date.value))
  const remaining = computed(() => store.remainingOf(date.value))
  const drafts = computed(() => store.draftsOf(date.value))
  const budget = computed(() => settings.value.dailyHours)

  const overBy = computed(() => Math.max(0, total.value - budget.value))
  const missing = computed(() => Math.max(0, budget.value - total.value))

  // MỘT hàm màu cho cả trang. Bản cũ để cột tháng và legend ngày tự bịa màu theo vị
  // trí trong ngày (`PALETTE[i % n]`), nên cùng một dự án đổi màu khi thứ tự dòng
  // đổi. Nay: màu link khai → theo thứ tự link → băm khoá dự án (ổn định).
  function colorOf(projectKey: string): string {
    const link = store.linkOf(projectKey)
    if (link?.color) return link.color
    const idx = settings.value.links.findIndex((l) => l.projectKey === projectKey)
    if (idx >= 0) return PALETTE[idx % PALETTE.length] ?? 'var(--accent)'
    let h = 0
    for (let i = 0; i < projectKey.length; i += 1) h = (h * 31 + projectKey.charCodeAt(i)) >>> 0
    return PALETTE[h % PALETTE.length] ?? 'var(--accent)'
  }

  // Mẫu số là MỨC NGÀY chứ không phải tổng thật, để mọi thanh vẽ cùng một thang;
  // ngày vượt mức thì nở theo tổng thật thay vì tràn khỏi thanh.
  function segmentsOf(list: LogtimeEntry[], budgetV: number): DaySegment[] {
    const byKey = new Map<string, number>()
    for (const e of list) byKey.set(e.projectKey, (byKey.get(e.projectKey) ?? 0) + e.hours)
    const sum = [...byKey.values()].reduce((s, h) => s + h, 0)
    const denom = Math.max(sum, budgetV) || 1
    return [...byKey.entries()].map(([key, hours]) => ({
      key,
      hours,
      pct: (hours / denom) * 100,
      color: colorOf(key),
    }))
  }

  const segments = computed(() => segmentsOf(entries.value, budget.value))

  // Cột trái: từng ngày của tháng đang mở, dừng ở HÔM NAY khi xem tháng hiện tại
  // (không ai khai được giờ cho ngày chưa tới). Xem tháng cũ thì lấy cả tháng.
  //
  // Thứ tự GIẢM dần: ngày mới nhất nằm trên cùng. Bản phác đọc như vậy và nó khớp
  // với thói quen — mở trang là thấy ngay hôm nay và mấy ngày gần nhất, không phải
  // cuộn xuống đáy. `gotoMonth` phải bù lại vì lý do này (xem ở đó).
  const monthDays = computed<MonthDay[]>(() => {
    const m = store.month
    const [y, mo] = m.split('-').map(Number)
    if (!y || !mo) return []
    const inMonth = new Date(y, mo, 0).getDate()
    const today = todayKey()
    const last = monthOfDate(today) === m ? Number(today.slice(8, 10)) : inMonth
    const out: MonthDay[] = []
    for (let d = last; d >= 1; d -= 1) {
      const key = `${m}-${String(d).padStart(2, '0')}`
      const list = store.entriesOf(key)
      const hours = list.reduce((s, e) => s + e.hours, 0)
      const drafts = list.filter((e) => e.status === 'draft').length
      const empty = list.length === 0
      out.push({
        date: key,
        total: hours,
        entries: list.length,
        drafts,
        sub: empty ? t('logtime.day.subEmpty') : t('logtime.month.rows', { n: list.length }),
        tail: empty
          ? ''
          : drafts > 0
            ? t('logtime.month.drafts', { n: drafts })
            : t('logtime.month.posted'),
        tailDraft: !empty && drafts > 0,
        // Mẫu số là mức ngày, và ngày vượt mức thì phần còn lại bằng 0 — dải màu tự
        // nở choán hết bề ngang thay vì tràn ra ngoài.
        rest: Math.max(0, budget.value - hours),
        segments: segmentsOf(list, budget.value),
      })
    }
    return out
  })

  const monthTotal = computed(() => monthDays.value.reduce((s, d) => s + d.total, 0))
  // Mức tháng = mức ngày × số ngày ĐANG CÓ trong cột. Đây là cách tôi đọc con số
  // "38.5 / 40.0h" của bản phác; bản phác không nói rõ mẫu số của nó là gì.
  const monthBudget = computed(() => monthDays.value.length * budget.value)
  const isCurrentMonth = computed(() => store.month === monthOfDate(todayKey()))

  const monthLabel = computed(() => {
    const [y, m] = store.month.split('-').map(Number)
    const name = t(MONTH_KEYS[(m ?? 1) - 1] ?? MONTH_KEYS[0])
    return t('logtime.month.label', { month: name, year: String(y ?? '') })
  })

  // Đổi tháng thì chọn luôn một ngày trong tháng mới. Tháng hiện tại → hôm nay;
  // tháng khác → ngày CUỐI tháng, vì cột xếp giảm dần nên ngày 01 nằm tận đáy và
  // cú nhảy tháng sẽ đáp xuống một chỗ trống trơn.
  function gotoMonth(delta: number): void {
    const [y, m] = store.month.split('-').map(Number)
    const dt = new Date(y ?? 1970, (m ?? 1) - 1 + delta, 1)
    const ty = dt.getFullYear()
    const tm = dt.getMonth() + 1
    const target = `${ty}-${String(tm).padStart(2, '0')}`
    const today = todayKey()
    if (monthOfDate(today) === target) {
      selectDate(today)
      return
    }
    const lastDay = new Date(ty, tm, 0).getDate()
    selectDate(`${target}-${String(lastDay).padStart(2, '0')}`)
  }

  const weekdayOf = (value: string): string =>
    t(WEEKDAY_KEYS[localDate(value).getDay()] ?? WEEKDAY_KEYS[0])

  /** "Thứ Sáu, 18/09/2026" — tiêu đề ngày. */
  const longDateOf = (value: string): string => {
    const [y, m, d] = value.split('-')
    return `${weekdayOf(value)}, ${d}/${m}/${y}`
  }

  /** "Thứ Sáu, 18/09" — dòng trong cột tháng, năm đã nằm ở tiêu đề tháng. */
  const shortDateOf = (value: string): string => {
    const [, m, d] = value.split('-')
    return `${weekdayOf(value)}, ${d}/${m}`
  }

  // "N dự án · M nguồn PMS" — đếm trên dòng của ngày đang mở. Nguồn đếm theo dự án
  // ĐÃ NỐI, không theo số nguồn bật ở Thiết lập: người dùng đọc dòng này để biết
  // hôm nay giờ sẽ chảy về mấy hệ thống.
  const dayMeta = computed(() => {
    const projects = new Set(entries.value.map((e) => e.projectKey))
    const sources = new Set<string>()
    for (const key of projects) {
      const link = store.linkOf(key)
      if (link?.sourceId) sources.add(link.sourceId)
    }
    return t('logtime.day.meta', { p: projects.size, s: sources.size })
  })

  // Ngày trước có gì để chép không — nút "Chép hôm qua" hỏi đúng câu này. Đặt ở đây
  // chứ không ở component: phép dựng khoá ngày đã có `shiftDate`, không cần bản thứ hai.
  const hasYesterday = computed(() => store.entriesOf(shiftDate(date.value, -1)).length > 0)

  // Dự án chọn được = mọi link đã khai ở Thiết lập.
  const projectOptions = computed(() =>
    settings.value.links.map((l) => ({
      label: l.pmsProjectName || l.label || l.projectKey,
      value: l.projectKey,
    })),
  )

  const labelOf = (projectKey: string): string => {
    const link = store.linkOf(projectKey)
    return link?.pmsProjectName || link?.label || projectKey
  }

  const sourceNameOf = (projectKey: string): string => {
    const link = store.linkOf(projectKey)
    if (!link) return ''
    return store.capabilities.find((c) => c.sourceId === link.sourceId)?.name ?? link.sourceId
  }

  // ─── Màn tuần ────────────────────────────────────────────────────────────────
  // Bảng dự án × 7 ngày, tổng hợp thuần từ store. Tuần bắt đầu Thứ Hai (bản phác).
  const weekDates = computed(() => {
    const mon = mondayOf(date.value)
    return Array.from({ length: 7 }, (_, i) => shiftDate(mon, i))
  })

  // Dòng của một ngày: trong tháng đang mở lấy từ `store.days` (reactive), ngoài tháng
  // lấy từ `weekExtra` (nạp on-demand). Ngày chưa nạp ⇒ rỗng, ô hiện trống.
  const entriesForDay = (key: string): LogtimeEntry[] =>
    store.days[key] ?? weekExtra.value[key] ?? []

  // Nạp tháng lân cận nếu tuần bắc cầu — gọi khi vào màn tuần / đổi ngày / tuần đổi.
  async function ensureWeekData(): Promise<void> {
    const months = [...new Set(weekDates.value.map((d) => monthOfDate(d)))]
    for (const m of months) {
      if (m === store.month) continue
      if (Object.keys(weekExtra.value).some((d) => monthOfDate(d) === m)) continue
      // Tối đa 2 tháng, tuần tự cho gọn.
      const map = await store.fetchMonthDays(m)
      weekExtra.value = { ...weekExtra.value, ...map }
    }
  }

  const POSTED = new Set(['posted', 'locked'])

  const weekRows = computed<WeekRow[]>(() => {
    // Gom theo dự án: mỗi dự án một hàng, 7 ô ngày.
    const byProject = new Map<string, WeekRow>()
    weekDates.value.forEach((key, dayIdx) => {
      for (const e of entriesForDay(key)) {
        let row = byProject.get(e.projectKey)
        if (!row) {
          row = {
            projectKey: e.projectKey,
            label: labelOf(e.projectKey),
            color: colorOf(e.projectKey),
            sourceName: sourceNameOf(e.projectKey),
            cells: Array.from({ length: 7 }, () => ({ draft: 0, posted: 0, total: 0 })),
            total: 0,
          }
          byProject.set(e.projectKey, row)
        }
        const cell = row.cells[dayIdx]
        if (!cell) continue
        if (POSTED.has(e.status)) cell.posted += e.hours
        else cell.draft += e.hours
        cell.total += e.hours
        row.total += e.hours
      }
    })
    return [...byProject.values()].sort((a, b) => b.total - a.total)
  })

  // Tổng theo NGÀY (chân bảng) — 7 số + tổng chung.
  const weekDayTotals = computed(() =>
    weekDates.value.map((key) => entriesForDay(key).reduce((s, e) => s + e.hours, 0)),
  )

  const weekTiles = computed<WeekTiles>(() => {
    const rows = weekRows.value
    const total = rows.reduce((s, r) => s + r.total, 0)
    const posted = rows.reduce((s, r) => s + r.cells.reduce((cs, c) => cs + c.posted, 0), 0)
    const top = rows[0]
    // Ngày thiếu giờ = ngày CÓ làm nhưng dưới mức (0 < total < budget). Ngày nghỉ (0h)
    // không tính thiếu — nghỉ là cố ý, không phải quên khai.
    const shortIdx = weekDayTotals.value.findIndex((h) => h > 0 && h < budget.value)
    const shortCount = weekDayTotals.value.filter((h) => h > 0 && h < budget.value).length
    return {
      total,
      posted,
      draft: total - posted,
      topLabel: top?.label ?? '—',
      topHours: top?.total ?? 0,
      topPct: total > 0 && top ? Math.round((top.total / total) * 100) : 0,
      shortDays: shortCount,
      shortDayLabel:
        shortIdx >= 0
          ? t('logtime.week.shortDay', {
              day: shortDateOf(weekDates.value[shortIdx] ?? date.value),
              h: fmt(weekDayTotals.value[shortIdx] ?? 0),
            })
          : t('logtime.week.noShortDay'),
    }
  })

  const weekTotal = computed(() => weekDayTotals.value.reduce((s, h) => s + h, 0))
  // Mức tuần = 5 ngày công × mức ngày (bản phác: 38.0 / 40.0 với mức 8h).
  const weekBudget = computed(() => 5 * budget.value)
  const weekWorkedDays = computed(() => weekDayTotals.value.filter((h) => h > 0).length)
  const weekOpenDays = computed(
    () =>
      weekDates.value.filter((key) => entriesForDay(key).some((e) => e.status === 'draft')).length,
  )

  const weekLabel = computed(() => {
    const first = weekDates.value[0] ?? date.value
    const last = weekDates.value[6] ?? date.value
    const dm = (v: string): string => {
      const [, m, d] = v.split('-')
      return `${d}/${m}`
    }
    return t('logtime.week.label', { n: isoWeek(date.value), from: dm(first), to: dm(last) })
  })

  const weekMeta = computed(() =>
    t('logtime.week.meta', {
      total: fmt(weekTotal.value),
      budget: fmt(weekBudget.value),
      worked: weekWorkedDays.value,
      open: weekOpenDays.value,
    }),
  )

  // Nhãn ngày ở đầu cột bảng tuần — "T2 14".
  const weekColLabels = computed(() =>
    weekDates.value.map((key) => {
      const [, , d] = key.split('-')
      const wd = t(SHORT_WEEKDAY_KEYS[localDate(key).getDay()] ?? SHORT_WEEKDAY_KEYS[0])
      return t('logtime.week.col', { wd, d: String(Number(d)) })
    }),
  )

  // Một chỗ duy nhất dựng URL issue: repo nằm ở LINK của dự án, số issue nằm ở dòng
  // công hoặc ở gợi ý. Chép công thức này ra lần thứ hai thì sửa một bên là bên kia
  // lặng lẽ trỏ sai.
  const issueUrl = (projectKey: string, issue: number | undefined): string => {
    const link = store.linkOf(projectKey)
    if (!link?.githubRepo || issue === undefined) return ''
    return `https://github.com/${link.githubRepo}/issues/${issue}`
  }

  const issueUrlOf = (entry: LogtimeEntry): string => issueUrl(entry.projectKey, entry.task?.issue)

  // ─── Báo cáo ngày ──────────────────────────────────────────────────────────
  // Nhãn cho util thuần. `count` là HÀM vì util biết số dòng còn ở đây thì chưa, và
  // nó dùng lại khoá `logtime.month.rows` đã có — không đẻ chuỗi thứ hai cho cùng
  // một câu. Bốn nhãn trạng thái cũng vậy: chúng là cùng trạng thái người dùng thấy
  // trên bảng dòng công, nên phải là cùng chữ.
  const reportLabels = computed<ReportLabels>(() => ({
    count: (n: number) => t('logtime.month.rows', { n }),
    colProject: t('logtime.report.col.project'),
    colNote: t('logtime.report.col.note'),
    colIssue: t('logtime.report.col.issue'),
    colHours: t('logtime.report.col.hours'),
    colStatus: t('logtime.report.col.status'),
    statusDraft: t('logtime.status.draft'),
    statusPosted: t('logtime.status.posted'),
    statusLocked: t('logtime.status.locked'),
    statusUnlinked: t('logtime.status.unlinked'),
  }))

  // Mọi thứ util cần về một dòng, tra sẵn ở đây. `githubRepo` nằm ở LINK chứ không ở
  // entry nên phép ghép URL chỉ đúng một chỗ — `issueUrlOf` ngay trên.
  // Một dòng công → dòng báo cáo. Dùng chung cho báo cáo NGÀY và TUẦN nên tách ra:
  // hai bản chép tay sẽ lệch cột Trạng thái/URL khi một bên được sửa.
  const toReportLine = (e: LogtimeEntry): ReportLine => {
    const link = store.linkOf(e.projectKey)
    const url = issueUrlOf(e)
    return {
      project: labelOf(e.projectKey),
      note: e.note,
      hours: e.hours,
      // Không có link ⇒ `unlinked`, khớp cột Trạng thái của bảng dòng công.
      status: link ? e.status : 'unlinked',
      ...(e.task?.issue === undefined ? {} : { issue: e.task.issue }),
      ...(url ? { issueUrl: url } : {}),
      ...(link ? { sourceId: link.sourceId, pmsProjectId: link.pmsProjectId } : {}),
      ...(e.task?.id ? { taskId: e.task.id } : {}),
    }
  }

  const reportLines = computed<ReportLine[]>(() => entries.value.map(toReportLine))
  // Báo cáo tuần: mọi dòng của 7 ngày, gộp phẳng (util tự gom theo dự án khi in bảng).
  const weekReportLines = computed<ReportLine[]>(() =>
    weekDates.value.flatMap((key) => entriesForDay(key).map(toReportLine)),
  )

  // 'day' | 'week' — cùng một modal báo cáo, khác nguồn dòng + nhãn. Tách state để
  // nút "Báo cáo tuần" và "Báo cáo" (ngày) không tranh nhau nội dung.
  const reportScope = ref<'day' | 'week'>('day')

  // Báo cáo là computed, KHÔNG phải state: sửa một dòng công là nội dung đổi theo
  // ngay, không có bản sao nào để lệch.
  const report = computed(() =>
    buildLogtimeReport(
      reportForm.value,
      reportScope.value === 'week'
        ? {
            date: date.value,
            dateLabel: weekLabel.value,
            budget: weekBudget.value,
            lines: weekReportLines.value,
            hoursShort: t('logtime.hoursShort'),
          }
        : {
            date: date.value,
            dateLabel: longDateOf(date.value),
            budget: budget.value,
            lines: reportLines.value,
            hoursShort: t('logtime.hoursShort'),
          },
      reportLabels.value,
    ),
  )

  function openReport(): void {
    reportScope.value = 'day'
    reportOpen.value = true
  }

  function openWeekReport(): void {
    reportScope.value = 'week'
    reportOpen.value = true
  }

  function setReportForm(form: LogtimeReportForm): void {
    reportForm.value = form
  }

  async function copyReport(): Promise<void> {
    // `copyText` trả `false` khi clipboard không ghi được (mất tiêu điểm / bị chặn).
    // Báo "Đã chép" lúc đó là nói dối, nên nhánh hỏng có câu riêng.
    const ok = await copyText(report.value.text)
    toast({
      color: ok ? 'success' : 'error',
      title: ok ? t('logtime.report.copied') : t('logtime.report.copyFailed'),
    })
  }

  // ─── Gợi ý "Hôm nay bạn đã làm" ─────────────────────────────────────────────
  // Việc AWOG TỰ ĐO được trong ngày đang mở, lấy từ RPC `logtime.suggestions`.
  //
  // Panel KHÔNG tự thêm dòng: bấm một gợi ý thì nó đổ dự án + việc vào form nhanh,
  // rồi người dùng chốt giờ và bấm "Thêm dòng". Nguồn dữ liệu cố ý KHÔNG mang `hours`
  // (xem `LogtimeSuggestion`), nên không có con số nào để tự điền — mà bịa một mặc
  // định ở đây là đẩy một phỏng đoán lên PMS như giờ công thật.
  // Mọi gợi ý ở đây ĐỀU thuộc dự án đã nối PMS — sidecar đã lọc (`trackedProjectKeys`),
  // nên không còn nhánh `linked`/`unlinked` ở UI. Việc của dự án chưa nối chỉ còn là
  // con số `store.suggestionsUntracked` để panel nói ra.
  const suggestionRows = computed(() =>
    store.suggestions.map((s) => ({
      suggestion: s,
      project: labelOf(s.projectKey),
      color: colorOf(s.projectKey),
      kindLabel: t(
        s.kind === 'session' ? 'logtime.suggest.kind.session' : 'logtime.suggest.kind.task',
      ),
      clock: clockOf(s.at),
      issueUrl: issueUrl(s.projectKey, s.issue),
      // Đã khai chưa: so theo NGUỒN (`sourceRefId`) là chính, vì note có thể đã bị AI
      // viết lại khác `s.title`. Vẫn OR thêm so-chữ để bắt các dòng cũ chưa có
      // `sourceRefId` (thêm tay khớp đúng tiêu đề).
      logged:
        store.sameEntrySource(date.value, s.refId) ||
        store.sameEntry(date.value, s.projectKey, s.title.trim()),
      // Đang ở form = thẻ này vừa được đưa vào (theo refId), và dự án trong form vẫn
      // là dự án của nó (đổi dự án tay thì thôi tô). Không so note nữa vì AI đã đổi note.
      staged: stagedRef.value === s.refId && formProject.value === s.projectKey,
      // Đang chờ AI tóm tắt note cho thẻ này.
      composing: composingRef.value === s.refId,
    })),
  )

  // Việc đang CHỜ KHAI = có gợi ý mà chưa khai. Tất cả đã nối PMS rồi nên chỉ còn xét
  // `logged`.
  const pendingSuggestions = computed(() => suggestionRows.value.filter((r) => !r.logged).length)

  // Ngày không đo được gì thì giấu hẳn khối — một cái hộp rỗng "0 việc" chỉ chiếm chỗ.
  // Nhưng ba trường hợp sau VẪN phải hiện, nếu không thì một thất bại trông y hệt một
  // ngày trống: `skippedNoProject` là việc CÓ thật mà panel không dựng nổi dòng công,
  // `suggestionsUntracked` là việc ở dự án chưa nối PMS, còn `suggestionsError` là lần
  // nạp hỏng — giấu bất kỳ cái nào cũng là nuốt lỗi.
  const hasSuggestions = computed(
    () =>
      suggestionRows.value.length > 0 ||
      store.suggestionsSkipped > 0 ||
      store.suggestionsUntracked > 0 ||
      store.suggestionsError !== '',
  )

  // Đưa một gợi ý vào form. Đổ NGAY tiêu đề thô (form không bao giờ trống), rồi gọi AI
  // tóm tắt thành một câu tiếng Việt và THAY note khi có kết quả — người dùng vẫn chốt
  // giờ và bấm "Thêm dòng". Link/issue gắn luôn từ gợi ý.
  async function useSuggestion(s: LogtimeSuggestion): Promise<void> {
    formProject.value = s.projectKey
    formNote.value = s.title
    // Gắn issue để auto-link lúc đẩy. Ưu tiên `s.issue` (từ link `/issues/` — chắc
    // chắn), thiếu thì DÒ từ tiêu đề ("#192"/"issue 192").
    const issue = s.issue ?? detectIssueFromTitle(s.title)
    formTask.value = issue === undefined ? null : { issue, title: s.title }
    formSourceRef.value = s.refId
    formSourceKind.value = s.kind
    stagedRef.value = s.refId

    // KHÔNG đổ tiêu đề thô vào ô note nữa: nháy chữ thô rồi mới đổi trông như "chả
    // generate gì". Để trống + bật cờ compose (form hiện "Đang tóm tắt bằng AI…"), khi
    // có kết quả mới điền. Lỗi/không engine ⇒ mới lùi về tiêu đề thô (không để trống).
    formNote.value = ''
    composingRef.value = s.refId
    // Chạy SONG SONG: (1) AI tóm tắt note, (2) map issue → PMS task id thật. Cả hai bảo
    // vệ theo `composingRef`/`stagedRef` — bấm gợi ý khác giữa chừng thì kết quả cũ về
    // sau KHÔNG ghi đè.
    try {
      const [note] = await Promise.all([
        store.composeLine({
          title: s.title,
          projectLabel: labelOf(s.projectKey),
          kind: s.kind,
          refId: s.refId,
          ...(s.issue !== undefined ? { issue: s.issue } : {}),
          ...(s.pr !== undefined ? { pr: s.pr } : {}),
        }),
        issue === undefined
          ? Promise.resolve()
          : attachTaskIdForIssue(s.refId, s.projectKey, issue),
      ])
      if (composingRef.value === s.refId) formNote.value = note ?? s.title
    } finally {
      if (composingRef.value === s.refId) composingRef.value = ''
    }
  }

  // Tra `worklog_list_tasks` tìm task PMS có số ĐÚNG BẰNG issue rồi gắn `id` vào form —
  // để lúc đẩy đi qua `taskIds` (task PMS thật) chứ không chỉ `githubIssueUrls`. Không
  // tìm thấy / lỗi ⇒ giữ nguyên chip issue (vẫn auto-link qua githubIssueUrls). Chỉ ghi
  // khi gợi ý này VẪN đang ở form (guard theo `stagedRef`).
  async function attachTaskIdForIssue(
    refId: string,
    projectKey: string,
    issue: number,
  ): Promise<void> {
    const link = store.linkOf(projectKey)
    if (!link) return
    // `q` = số issue để PMS thu hẹp; vẫn tự khớp CHÍNH XÁC `#<issue>` ở client vì `q`
    // có thể khớp cả chuỗi con ("19" khớp "#192").
    const list = await store.listTasks(link.sourceId, link.pmsProjectId, String(issue))
    if (!list || stagedRef.value !== refId || !formTask.value) return
    const hit = list.find((o) => /^#(\d+)\b/.exec(o.label)?.[1] === String(issue))
    if (!hit) return
    const m = /^#\d+\s*·\s*(.*)$/.exec(hit.label)
    formTask.value = {
      id: hit.value,
      issue,
      title: m?.[1] ?? formTask.value.title ?? hit.label,
    }
  }

  // Ô note của form đang chờ AI tóm tắt cho gợi ý vừa đưa vào (dùng để hiện loading +
  // khoá nút Thêm dòng). `composingRef` là refId đang soạn; nó phải khớp gợi ý đang ở
  // form (`formSourceRef`) mới tính là "form đang bận".
  const formComposing = computed(
    () => composingRef.value !== '' && composingRef.value === formSourceRef.value,
  )

  async function loadSuggestions(): Promise<void> {
    await store.loadSuggestions(date.value)
  }

  // Mở PHIÊN nguồn của một gợi ý. Chỉ có nghĩa với `kind === 'session'`: `refId` khi đó
  // CHÍNH LÀ engineId (sidecar `h.id` → UI `engineId`, xem stores/sessions.ts:1206), nên
  // `openByEngineId` mở được thẳng. Gợi ý từ task không có phiên để mở.
  async function openSession(s: LogtimeSuggestion): Promise<void> {
    if (s.kind !== 'session') return
    const ok = await sessions.openByEngineId(s.refId)
    if (!ok) {
      toast({ color: 'warning', title: t('logtime.suggest.sessionGone') })
      return
    }
    await navigateTo('/sessions')
  }

  // ─── Soạn bằng AI ────────────────────────────────────────────────────────────
  // Mở modal + gọi model. Modal đọc `store.composeLines/Context/Busy/Error` trực tiếp.
  async function openAi(): Promise<void> {
    aiOpen.value = true
    await store.compose(date.value)
  }

  // Nhận đề xuất thành DÒNG NHÁP — đi qua đúng cổng `addEntry` như thêm tay / gợi ý,
  // nên trần giờ/ngày vẫn cưỡng chế và dòng trùng vẫn bị bỏ. Model KHÔNG tự đẩy: đây
  // mới chỉ tạo nháp, đẩy PMS vẫn là nút riêng có xác nhận.
  async function acceptCompose(): Promise<void> {
    let added = 0
    let cut = false
    for (const line of store.composeLines) {
      // Tuần tự để trần ngày tính dồn đúng qua từng dòng.
      const outcome = await store.addEntry(date.value, {
        projectKey: line.projectKey,
        note: line.note,
        hours: line.hours,
        ...(line.issue !== undefined ? { task: { issue: line.issue, title: line.note } } : {}),
      })
      if (outcome.reason === 'ok') {
        added += 1
        cut = cut || outcome.cut
      }
      if (outcome.reason === 'full') break
    }
    aiOpen.value = false
    if (added === 0) {
      toast({ color: 'warning', title: t('logtime.ai.acceptedNone') })
      return
    }
    toast({
      color: cut ? 'warning' : 'success',
      title: t('logtime.ai.accepted', { n: added }),
    })
  }

  const pushableDrafts = computed(() => drafts.value.filter((e) => store.canPush(e.projectKey)))
  const blockedDrafts = computed(() => drafts.value.filter((e) => !store.canPush(e.projectKey)))

  function selectDate(next: string): void {
    date.value = next
    if (monthOfDate(next) !== store.month) void store.loadMonth(monthOfDate(next))
    // Gợi ý thuộc về NGÀY, không thuộc về tháng — đổi ngày là phải đo lại. Đổi tháng
    // thì `gotoMonth` gọi hàm này nên cũng đi qua đây.
    void store.loadSuggestions(next)
    // Nếu đang xem tuần, đổi ngày có thể sang tuần khác/tháng khác — nạp bù.
    if (view.value === 'week') void ensureWeekData()
  }

  // Đổi tab. Vào màn tuần thì nạp bù dữ liệu ngày ngoài tháng (tuần bắc cầu).
  function setView(next: LogtimeView): void {
    view.value = next
    if (next === 'week') void ensureWeekData()
  }

  // Nhảy tuần trước/sau: dời neo `date` 7 ngày (kéo theo cả tháng nếu cần).
  function gotoWeek(delta: number): void {
    selectDate(shiftDate(date.value, delta * 7))
  }

  function bumpHours(delta: number): void {
    const step = settings.value.roundStep || 0.5
    const next = Math.round((formHours.value + delta * step) * 100) / 100
    formHours.value = Math.min(budget.value || 24, Math.max(step, next))
  }

  // Dịch kết quả của cổng `addEntry` thành một câu người đọc hiểu được.
  function reportAdd(
    outcome: { added: number; cut: boolean; reason: string },
    hours: number,
  ): void {
    if (outcome.reason === 'full') {
      toast({ color: 'warning', title: t('logtime.toast.full', { h: fmt(budget.value) }) })
      return
    }
    if (outcome.reason === 'duplicate') {
      toast({ color: 'warning', title: t('logtime.toast.duplicate') })
      return
    }
    if (outcome.reason === 'invalid') {
      toast({ color: 'warning', title: t('logtime.toast.invalid') })
      return
    }
    if (outcome.cut) {
      toast({
        color: 'warning',
        title: t('logtime.toast.cut', { from: fmt(hours), to: fmt(outcome.added) }),
      })
    }
  }

  async function submitForm(): Promise<void> {
    const hours = formHours.value
    const outcome = await store.addEntry(date.value, {
      projectKey: formProject.value,
      note: formNote.value,
      hours,
      ...(formTask.value ? { task: formTask.value } : {}),
      // Nhớ gợi ý nguồn để thẻ tô "đã khai" dù note đã bị AI đổi. Dòng gõ tay không có.
      ...(formSourceRef.value ? { sourceRefId: formSourceRef.value } : {}),
    })
    reportAdd(outcome, hours)
    if (outcome.reason !== 'ok') return
    formNote.value = ''
    formTask.value = null
    formSourceRef.value = ''
    formSourceKind.value = ''
    stagedRef.value = ''
    formHours.value = settings.value.roundStep === 1 ? 1 : 1
  }

  // "Sửa bằng AI": lấy `seed` (chữ người dùng đang gõ) cho model khai thác theo hướng đó
  // (bám thêm digest nguồn nếu có `sourceRefId`) thành note nghiệp vụ đầy đủ. Trả chuỗi
  // note mới, hoặc null (nháp rỗng / không engine / lỗi) kèm toast — caller tự đổ vào ô.
  // Dùng chung cho popover của FORM và của LogtimeRow.
  async function refineText(
    seed: string,
    opts: { projectKey: string; issue?: number; sourceRefId?: string; kind?: 'session' | 'task' },
  ): Promise<string | null> {
    const s = seed.trim()
    if (!s) {
      toast({ color: 'warning', title: t('logtime.form.noteSeedEmpty') })
      return null
    }
    if (!opts.projectKey) {
      toast({ color: 'warning', title: t('logtime.toast.noLink') })
      return null
    }
    const note = await store.composeLine({
      title: s,
      seed: s,
      projectLabel: labelOf(opts.projectKey),
      kind: opts.kind ?? 'session',
      ...(opts.sourceRefId ? { refId: opts.sourceRefId } : {}),
      ...(opts.issue !== undefined ? { issue: opts.issue } : {}),
    })
    if (!note) toast({ color: 'error', title: t('logtime.form.noteRefineFailed') })
    return note
  }

  async function removeEntry(entry: LogtimeEntry): Promise<void> {
    if (entry.status === 'posted') {
      const ok = await confirm({
        title: t('logtime.confirm.removePosted.title'),
        description: t('logtime.confirm.removePosted.body'),
        confirmLabel: t('logtime.confirm.removePosted.ok'),
        kind: 'danger',
      })
      if (!ok) return
    }
    await store.removeEntry(date.value, entry.id)
  }

  // Sửa dòng đã có. Cố ý CHỈ cho note + hours: đổi `projectKey` của một dòng đã đẩy
  // là làm nó lệch khỏi worklog bên PMS, mà ở đây không có gì để đồng bộ lại.
  async function editEntry(
    entry: LogtimeEntry,
    patch: { note?: string; hours?: number },
  ): Promise<boolean> {
    const ok = await store.updateEntry(date.value, entry.id, patch)
    if (!ok) {
      toast({ color: 'warning', title: t('logtime.toast.editFailed') })
      return false
    }
    // Cổng cắt giờ nằm ở store (trần ngày) và nó cắt IM LẶNG. Nói ra, kẻo người dùng
    // gõ 5h rồi thấy ô nhảy về 3.5h mà không hiểu vì sao.
    if (patch.hours !== undefined && entry.hours < patch.hours) {
      toast({
        color: 'warning',
        title: t('logtime.toast.cut', { from: fmt(patch.hours), to: fmt(entry.hours) }),
      })
    }
    // Dòng đã lên PMS: sửa ở đây chỉ đổi bản trong máy, bản bên PMS vẫn giá trị cũ —
    // `pushDay` chỉ đẩy dòng nháp nên không có đường tự đồng bộ lại. Nói thẳng ra.
    if (entry.status === 'posted') {
      toast({ color: 'warning', title: t('logtime.toast.editPostedDrift') })
    }
    return true
  }

  async function copyYesterday(): Promise<void> {
    const from = shiftDate(date.value, -1)
    if (store.entriesOf(from).length === 0) {
      toast({ color: 'warning', title: t('logtime.toast.noYesterday') })
      return
    }
    const r = await store.copyFrom(date.value, from)
    if (r.added === 0) {
      toast({ color: 'warning', title: t('logtime.toast.copyNone') })
      return
    }
    toast({
      color: 'success',
      title: t('logtime.toast.copyDone', { n: r.added }),
      ...(r.dup || r.full || r.cut
        ? { description: t('logtime.toast.copyDetail', { dup: r.dup, full: r.full, cut: r.cut }) }
        : {}),
    })
  }

  function openPush(): void {
    pushConfirmed.value = false
    pushResults.value = []
    pushOpen.value = true
  }

  async function runPush(): Promise<void> {
    if (!pushConfirmed.value || pushing.value) return
    pushing.value = true
    try {
      const results = await store.pushDay(date.value)
      pushResults.value = results
      const ok = results.filter((r) => r.ok).length
      const failed = results.length - ok
      if (ok > 0) {
        toast({
          color: failed > 0 ? 'warning' : 'success',
          title: t('logtime.toast.pushed', { n: ok }),
          ...(failed > 0 ? { description: t('logtime.toast.pushFailed', { n: failed }) } : {}),
        })
      } else if (results.length > 0) {
        toast({
          color: 'error',
          title: t('logtime.toast.pushAllFailed'),
          description: results[0]?.error ?? '',
        })
      }
    } finally {
      pushing.value = false
    }
  }

  async function pullRange(): Promise<void> {
    const from = shiftDate(date.value, -6)
    const n = await store.pull(from, date.value)
    toast({ color: n > 0 ? 'success' : 'warning', title: t('logtime.toast.pulled', { n }) })
  }

  // Hỏi PMS danh sách task theo `q`. Seq-guard: chỉ áp kết quả của request MỚI NHẤT —
  // gõ nhanh thì các lời gọi cũ về sau không ghi đè. `null` = lỗi RPC; giữ danh sách cũ
  // + báo lỗi thay vì xoá sạch (đang gõ mà list nhấp nháy rỗng thì khó chịu).
  async function fetchTasks(q: string): Promise<void> {
    const ctx = taskCtx.value
    if (!ctx) return
    const seq = (taskReqSeq += 1)
    taskLoading.value = true
    const list = await store.listTasks(ctx.sourceId, ctx.pmsProjectId, q.trim() || undefined)
    if (seq !== taskReqSeq) return // đã có request mới hơn
    taskLoading.value = false
    if (list === null) {
      toast({ color: 'error', title: t('logtime.toast.tasksFailed'), description: store.lastError })
      return
    }
    taskOptions.value = list
  }

  // Component gọi khi ô tìm đổi (đã debounce). Rỗng ⇒ nạp lại loạt mặc định.
  async function searchTasks(q: string): Promise<void> {
    await fetchTasks(q)
  }

  async function openTaskPicker(): Promise<void> {
    const link = store.linkOf(formProject.value)
    if (!link) {
      toast({ color: 'warning', title: t('logtime.toast.noLink') })
      return
    }
    taskQuery.value = ''
    taskCtx.value = { sourceId: link.sourceId, pmsProjectId: link.pmsProjectId }
    taskOptions.value = []
    taskOpen.value = true
    // Lần mở đầu: chưa có ctx lúc gọi listTasks cũ ⇒ dùng `fetchTasks('')`. Nếu lỗi ngay
    // lần đầu (chưa có task nào từng tải) thì đóng picker — khác với lỗi giữa lúc tìm.
    const seq = (taskReqSeq += 1)
    taskLoading.value = true
    const list = await store.listTasks(link.sourceId, link.pmsProjectId)
    if (seq !== taskReqSeq) return
    taskLoading.value = false
    if (list === null) {
      taskOpen.value = false
      toast({ color: 'error', title: t('logtime.toast.tasksFailed'), description: store.lastError })
      return
    }
    taskOptions.value = list
  }

  function pickTask(option: PmsOption): void {
    // Label của PMS có dạng "#134 · tiêu đề" — tách số issue ra để dựng link.
    const m = /^#(\d+)\s*·\s*(.*)$/.exec(option.label)
    formTask.value = {
      id: option.value,
      ...(m?.[1] ? { issue: Number(m[1]) } : {}),
      title: m?.[2] ?? option.label,
    }
    taskOpen.value = false
  }

  let started = false
  // Gọi từ onMounted của trang. Singleton nên chỉ nạp một lần cho cả vòng đời app;
  // quay lại trang thì dùng `refresh()` nếu cần đọc lại đĩa.
  async function init(): Promise<void> {
    if (started) return
    started = true
    await store.loadMonth(monthOfDate(date.value))
    if (!formProject.value && projectOptions.value.length > 0) {
      formProject.value = projectOptions.value[0]?.value ?? ''
    }
    void store.loadCapabilities()
    // Song song với `loadMonth` chứ không nối tiếp: hai lời gọi độc lập, và panel gợi
    // ý không cần tháng đang mở mới dựng được.
    void store.loadSuggestions(date.value)
  }

  return {
    // state
    view,
    date,
    settings,
    entries,
    segments,
    total,
    budget,
    remaining,
    missing,
    overBy,
    drafts,
    pushableDrafts,
    blockedDrafts,
    projectOptions,
    formProject,
    formNote,
    formHours,
    formTask,
    formComposing,
    formSourceRef,
    formSourceKind,
    refineText,
    pushOpen,
    pushConfirmed,
    pushResults,
    pushing,
    taskOpen,
    taskLoading,
    taskOptions,
    taskQuery,
    searchTasks,
    reportOpen,
    reportForm,
    report,
    reportScope,
    // Soạn bằng AI
    aiOpen,
    // Màn tuần
    weekRows,
    weekDayTotals,
    weekTiles,
    weekTotal,
    weekBudget,
    weekLabel,
    weekMeta,
    weekColLabels,
    weekDates,
    // gợi ý "Hôm nay bạn đã làm"
    suggestionRows,
    pendingSuggestions,
    hasSuggestions,
    store,
    // cột tháng bên trái
    monthDays,
    monthTotal,
    monthBudget,
    isCurrentMonth,
    monthLabel,
    gotoMonth,
    // helpers
    fmt,
    labelOf,
    sourceNameOf,
    issueUrlOf,
    colorOf,
    longDateOf,
    shortDateOf,
    dayMeta,
    hasYesterday,
    // actions
    selectDate,
    bumpHours,
    submitForm,
    editEntry,
    removeEntry,
    copyYesterday,
    openPush,
    runPush,
    pullRange,
    openTaskPicker,
    pickTask,
    openReport,
    openWeekReport,
    setReportForm,
    copyReport,
    useSuggestion,
    openSession,
    loadSuggestions,
    openAi,
    acceptCompose,
    setView,
    gotoWeek,
    init,
  }
}
