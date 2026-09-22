// Dựng báo cáo ngày công ở ba dạng — phần tính toán của modal "Báo cáo ngày" trên
// `/logtime` (ADR 0091). Hàm THUẦN, không Vue, không RPC, không `t`: mọi thứ ở đây
// test được bằng một mảng dòng và một kỳ vọng.
//
// VÌ SAO KHÔNG CÓ `t`. `utils/kube-report.ts` giữ luật này và nó đúng ở đây nữa:
// hàm thuần không được biết ngôn ngữ của app. Nhãn đi vào qua `labels` — người gọi
// (composable) đã có `t`, file này thì không.
//
// LUẬT CHUNG CỦA FILE: dạng JSON là PAYLOAD GỬI ĐI nên nó không được bịa. Một dòng
// chưa nối dự án PMS thì không có `projectId` để gửi — nó vào `excluded` kèm lý do,
// KHÔNG thành một payload với `projectId: ''` trông như gửi được. Hai dạng chữ thì
// vẫn kể ĐỦ mọi dòng: báo cáo là báo cáo của NGÀY, không phải của riêng phần đẩy được.

export type LogtimeReportForm = 'brief' | 'markdown' | 'json'

/** Trạng thái một dòng trong báo cáo. `unlinked` là suy từ link, không nằm ở entry. */
export type ReportStatus = 'draft' | 'posted' | 'locked' | 'unlinked'

/**
 * Một dòng công đã RESOLVE — đủ để dựng báo cáo mà không cần tra store thêm.
 * Song song với `KubeRow` của `useInfraKube`: util tự khai shape, người gọi map.
 */
export type ReportLine = {
  /** Nhãn dự án người đọc thấy (`pmsProjectName` → `label` → `projectKey`). */
  project: string
  note: string
  hours: number
  status: ReportStatus
  /** Số issue GitHub — chỉ có khi dòng gắn task kèm số. */
  issue?: number
  /** Link issue đầy đủ — chỉ dựng được khi link dự án khai `githubRepo`. */
  issueUrl?: string
  /** Hai khoá dưới đây quyết định dòng có vào được `calls` của dạng JSON không. */
  sourceId?: string
  pmsProjectId?: string
  taskId?: string
}

export type ReportInput = {
  date: string
  /** "Thứ Sáu, 18/09/2026" — composable dựng (đã i18n); util không biết ngôn ngữ. */
  dateLabel: string
  /** Mức giờ/ngày — mẫu số của dòng tổng kết. */
  budget: number
  /** Mọi dòng của ngày, giữ nguyên thứ tự người dùng thấy. */
  lines: ReportLine[]
  /** "h" — hậu tố giờ, đi vào từ `logtime.hoursShort`. */
  hoursShort: string
}

export type ReportLabels = {
  /**
   * "{n} dòng" — người gọi truyền `(n) => t('logtime.month.rows', { n })`. Là HÀM
   * chứ không phải chuỗi vì util biết số dòng còn người gọi thì không.
   */
  count: (n: number) => string
  colProject: string
  colNote: string
  colIssue: string
  colHours: string
  colStatus: string
  statusDraft: string
  statusPosted: string
  statusLocked: string
  statusUnlinked: string
}

/** Lý do một dòng không vào được `calls` của dạng JSON. */
export type ReportExclusion = 'unlinked' | 'alreadyOnPms' | 'noHours'

export type Report = {
  /** Nội dung để chép — sẵn sàng vào clipboard. */
  text: string
  /**
   * Dòng bị loại khỏi `calls` kèm lý do. Hai dạng chữ kể đủ mọi dòng nên luôn rỗng;
   * modal PHẢI hiện danh sách này khi khác rỗng, kẻo dạng JSON lặng lẽ rút 7 dòng
   * của ngày xuống 5 mà người dùng tưởng đã chép đủ.
   */
  excluded: { line: ReportLine; reason: ReportExclusion }[]
}

// Trùng chuỗi với `CREATE_TOOL` của `LogtimeDay.vue` và tên tool ở `logtime/mcp.ts`.
// Cố ý KHÔNG suy từ `cap.tools`: dạng JSON là tài liệu về thứ AWOG sẽ gọi, không
// phải bản sao lời gọi đã dò được ở Thiết lập.
const WORKLOG_CREATE_TOOL = 'worklog_create'

// Một chữ số thập phân, khớp `fmt` của `useLogtimeManager` — hai chỗ in cùng một
// con số thì phải in giống nhau.
const fmtHours = (n: number): string => n.toFixed(1)

// Tổng của nhiều số lẻ ra `5.500000000000001`; đi qua đây trước khi vào JSON.
const round2 = (n: number): number => Math.round(n * 100) / 100

const sumOf = (lines: ReportLine[]): number => lines.reduce((s, l) => s + l.hours, 0)

// Note là văn bản tự do (người dùng gõ, agent ghi) nên PHẢI có newline trong đó.
// Mọi chỗ dựng chuỗi ở file này đi qua đây trước.
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

// Ô bảng markdown: `|` trong note tách hàng thành nhiều ô và bảng lệch cột trong
// im lặng. Chỉ escape `|` — escape cả `\` sẽ nhân đôi dấu trong đường dẫn Windows.
const mdCell = (s: string): string => oneLine(s).replace(/\|/g, '\\|')

function statusOf(line: ReportLine, labels: ReportLabels): string {
  if (line.status === 'unlinked') return labels.statusUnlinked
  if (line.status === 'posted') return labels.statusPosted
  if (line.status === 'locked') return labels.statusLocked
  return labels.statusDraft
}

// `—` chứ không để trống: ô rỗng thì người đọc tưởng bảng thiếu dữ liệu, còn `—`
// nói rõ "dòng này không gắn issue nào". Cùng quy ước với trang Giám sát.
function issueCell(line: ReportLine): string {
  if (line.issue === undefined) return '—'
  const n = `#${line.issue}`
  return line.issueUrl ? `[${n}](${line.issueUrl})` : n
}

// ─── DẠNG GỌN ───────────────────────────────────────────────────────────────
// Để dán vào chat: không cú pháp, mỗi dòng công một gạch đầu dòng.

function summaryLine(input: ReportInput, labels: ReportLabels): string {
  const h = `${fmtHours(sumOf(input.lines))}/${fmtHours(input.budget)}${input.hoursShort}`
  return `${input.dateLabel} · ${labels.count(input.lines.length)} · ${h}`
}

function briefLine(line: ReportLine, hoursShort: string): string {
  const what = `${line.project} · ${oneLine(line.note)}`
  const ref = line.issue === undefined ? '' : ` (#${line.issue})`
  return `${what}${ref} — ${fmtHours(line.hours)}${hoursShort}`
}

function brief(input: ReportInput, labels: ReportLabels): string {
  return [
    summaryLine(input, labels),
    ...input.lines.map((l) => `- ${briefLine(l, input.hoursShort)}`),
  ].join('\n')
}

// ─── DẠNG BẢNG MARKDOWN ─────────────────────────────────────────────────────
// Để dán vào PR / trang wiki: có tiêu đề, có bảng, có dòng tổng kết.

function markdown(input: ReportInput, labels: ReportLabels): string {
  const cols = [
    labels.colProject,
    labels.colNote,
    labels.colIssue,
    labels.colHours,
    labels.colStatus,
  ]
  const rows = input.lines.map((line) => [
    mdCell(line.project),
    mdCell(line.note),
    issueCell(line),
    `${fmtHours(line.hours)}${input.hoursShort}`,
    mdCell(statusOf(line, labels)),
  ])
  const total = `${fmtHours(sumOf(input.lines))} / ${fmtHours(input.budget)}${input.hoursShort} · ${labels.count(input.lines.length)}`
  return [
    `### ${input.dateLabel}`,
    '',
    `| ${cols.join(' | ')} |`,
    '| --- | --- | --- | ---: | --- |',
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '',
    total,
  ].join('\n')
}

// ─── DẠNG JSON ──────────────────────────────────────────────────────────────
// Payload thật: đúng những lời gọi `logtime.push` SẼ thực hiện cho ngày này, nên
// chỉ dòng NHÁP mới vào `calls` (dòng đã đẩy rồi mà gửi lại là nhân đôi worklog
// bên PMS). Khoá và thứ tự khoá khớp `firstPayload` của `LogtimePushModal.vue`.

function callOf(line: ReportLine, date: string): Record<string, unknown> {
  return {
    tool: WORKLOG_CREATE_TOOL,
    source: line.sourceId,
    projectId: line.pmsProjectId,
    date,
    hours: line.hours,
    note: line.note,
    taskIds: line.taskId ? [line.taskId] : [],
    githubIssueUrls: line.issueUrl ? [line.issueUrl] : [],
  }
}

function jsonReport(input: ReportInput): Report {
  const calls: Record<string, unknown>[] = []
  const excluded: { line: ReportLine; reason: ReportExclusion }[] = []
  for (const line of input.lines) {
    // THỨ TỰ QUAN TRỌNG: hỏi link trước `status`. Dòng chưa nối PMS mang status
    // `unlinked`, nên xét status trước sẽ gán cho nó lý do `alreadyOnPms` — một câu
    // sai, và là câu khiến người dùng đi tìm worklog không tồn tại bên PMS.
    if (!line.sourceId || !line.pmsProjectId) excluded.push({ line, reason: 'unlinked' })
    else if (line.status !== 'draft') excluded.push({ line, reason: 'alreadyOnPms' })
    else if (!(line.hours > 0)) excluded.push({ line, reason: 'noHours' })
    else calls.push(callOf(line, input.date))
  }
  const payload = {
    date: input.date,
    // Số của `calls`, KHÔNG phải của ngày — hai dạng chữ đã lo phần "cả ngày".
    count: calls.length,
    hours: round2(calls.reduce((s, c) => s + Number(c.hours), 0)),
    calls,
    excluded: excluded.map(({ line, reason }) => ({
      project: line.project,
      note: oneLine(line.note),
      reason,
    })),
  }
  return { text: JSON.stringify(payload, null, 2), excluded }
}

export function buildLogtimeReport(
  form: LogtimeReportForm,
  input: ReportInput,
  labels: ReportLabels,
): Report {
  if (form === 'json') return jsonReport(input)
  if (form === 'markdown') return { text: markdown(input, labels), excluded: [] }
  return { text: brief(input, labels), excluded: [] }
}
