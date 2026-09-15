// Bộ DỰNG nội dung cho từng mẫu chia sẻ (mốc 6.7 + 6.6).
//
// TẦNG NÀY BIẾT NGHIỆP VỤ, `kit.ts` THÌ KHÔNG. Ở đây mới có playbook, báo cáo,
// bước, quay lui; `kit.ts` chỉ biết `ShareDoc` và hai định dạng. Ranh giới đó là
// lý do ba mẫu ("Kế hoạch để duyệt" · "Runbook kỹ thuật" · "Báo cáo sau khi chạy")
// dùng chung được một bộ xuất mà không mẫu nào phải biết mẫu kia tồn tại.
//
// BA MẪU LÀ BA CÂU HỎI KHÁC NHAU, KHÔNG PHẢI BA MỨC CHI TIẾT CỦA CÙNG MỘT THỨ.
// `playbooks.md:99` nói mẫu "Kế hoạch để duyệt" **không có dòng lệnh, không ARN**.
// Nên chỗ này không có cờ `verbose` hay tham số `includeCommands`: một playbook
// xuất cho quản lý và cùng playbook đó xuất cho người trực là HAI hàm dựng khác
// nhau, và hàm dựng cho quản lý không có nhánh nào chạm tới `step.args`. Một cờ
// bật/tắt sẽ khiến "gửi nhầm bản có lệnh cho sếp" chỉ còn cách một giá trị boolean.
//
// LỆNH TRONG BẢN RUNBOOK GIỮ NGUYÊN `{{biến}}`. Giá trị biến là thứ người dùng
// điền lúc chạy, không phải thuộc tính của playbook; thay sẵn một giá trị mẫu vào
// là biến một runbook còn dùng được thành một bản ghi của một lần chạy cụ thể.
//
// CHUỖI HIỂN THỊ ĐI THEO `lang`. Bản xuất đi ra NGOÀI app (email, PR, khách hàng)
// nên nó phải đọc được bằng ngôn ngữ của người nhận — người xuất chọn, và mặc
// định là ngôn ngữ giao diện. Chú thích kỹ thuật và mã vẫn tiếng Anh theo quy ước
// chung của repo; chỉ câu chữ của tài liệu mới đổi.

import { classify } from '../classify.js'
import { stepsOfVerb } from '../playbook/schema.js'
import type { Playbook, PlaybookStatus, PlaybookStep, PlaybookVerb } from '../playbook/schema.js'
import type { PlaybookRun, StepRunStatus } from '../playbook/runner.js'
import type { ShareBlock, ShareDiagram, ShareDoc, ShareLang, ShareSection } from './kit.js'

// ─── Mẫu chia sẻ ─────────────────────────────────────────────────────────────

export const SHARE_AUDIENCES = ['approval', 'runbook', 'post-run'] as const
export type ShareAudience = (typeof SHARE_AUDIENCES)[number]

/**
 * Mẫu bắt buộc che, không cho tắt.
 *
 * Spec nói chế độ che "mặc định BẬT cho mẫu Kế hoạch để duyệt" — nhưng đây không
 * chỉ là giá trị mặc định: mẫu đó được định nghĩa bằng việc **không có** ARN và
 * account id. Ghi chú của tác giả playbook là văn bản tự do, nên nó vẫn có thể
 * chứa một ARN; lớp che chính là thứ biến lời hứa đó thành sự thật. Cho tắt đi
 * là biến mẫu "để duyệt" thành mẫu có thể rò rỉ.
 */
export function audienceForcesMask(audience: ShareAudience): boolean {
  return audience === 'approval'
}

// ─── Nhãn hai thứ tiếng ──────────────────────────────────────────────────────

type Labels = {
  planTitle: (name: string) => string
  runbookTitle: (name: string) => string
  runTitle: (name: string) => string
  sectionSummary: string
  sectionSteps: string
  sectionVariables: string
  sectionNotes: string
  sectionOverview: string
  sectionAudit: string
  sectionBody: string
  colStep: string
  colTask: string
  colImpact: string
  colRollback: string
  colCommand: string
  colVerdict: string
  colDuration: string
  colActor: string
  colAt: string
  colName: string
  colLabel: string
  colRequired: string
  colDefault: string
  colValue: string
  colFact: string
  impactRead: string
  impactWrite: string
  impactDestructive: string
  impactContext: string
  yes: string
  no: string
  diagram: string
  verb: Record<PlaybookVerb, string>
  verdict: Record<StepRunStatus, string>
  notDeclared: string
  rowPlaybook: string
  rowSource: string
  rowStatus: string
  rowApprovedBy: string
  rowApprovedAt: string
  rowCreatedAt: string
  rowProfile: string
  rowRegion: string
  rowCluster: string
  rowNamespace: string
  auditHint: (count: number) => string
  missingRollback: string
  reportScope: string
}

const EN: Labels = {
  planTitle: (name) => `Deployment plan: ${name}`,
  runbookTitle: (name) => `Technical runbook: ${name}`,
  runTitle: (name) => `Post-run report: ${name}`,
  sectionSummary: 'Summary',
  sectionSteps: 'Steps',
  sectionVariables: 'Variables',
  sectionNotes: 'Notes',
  sectionOverview: 'Overview',
  sectionAudit: 'Activity log',
  sectionBody: 'Report',
  colStep: 'Step',
  colTask: 'What it does',
  colImpact: 'Impact',
  colRollback: 'Rollback',
  colCommand: 'Command',
  colVerdict: 'Result',
  colDuration: 'Took',
  colActor: 'Ordered by',
  colAt: 'When',
  colName: 'Name',
  colLabel: 'Label',
  colRequired: 'Required',
  colDefault: 'Default',
  colValue: 'Value',
  colFact: 'Item',
  impactRead: 'Reads only — changes nothing',
  impactWrite: 'Changes the account',
  impactDestructive: 'Destructive — cannot be undone by re-running',
  impactContext: 'Switches the working context',
  yes: 'yes',
  no: 'no',
  diagram: 'Diagram',
  verb: { check: 'Check', do: 'Do', verify: 'Verify', rollback: 'Rollback' },
  verdict: {
    pending: 'not run',
    running: 'running',
    ok: 'ok',
    failed: 'failed',
    blocked: 'blocked',
    skipped: 'skipped',
  },
  notDeclared: '(not declared)',
  rowPlaybook: 'Playbook',
  rowSource: 'Source',
  rowStatus: 'Status',
  rowApprovedBy: 'Approved by',
  rowApprovedAt: 'Approved at',
  rowCreatedAt: 'Started',
  rowProfile: 'AWS profile',
  rowRegion: 'Region',
  rowCluster: 'Cluster',
  rowNamespace: 'Namespace',
  auditHint: (count) =>
    `This run wrote ${count} ordered ${count === 1 ? 'entry' : 'entries'} to the activity log. ` +
    `Filter the log by the "Ordered by" column to line every step up against what actually ran.`,
  missingRollback: 'No rollback step is declared for this step.',
  reportScope: 'Scope',
}

const VI: Labels = {
  planTitle: (name) => `Kế hoạch triển khai: ${name}`,
  runbookTitle: (name) => `Runbook kỹ thuật: ${name}`,
  runTitle: (name) => `Báo cáo sau khi chạy: ${name}`,
  sectionSummary: 'Tóm tắt',
  sectionSteps: 'Các bước',
  sectionVariables: 'Biến',
  sectionNotes: 'Chú thích',
  sectionOverview: 'Tổng quan',
  sectionAudit: 'Nhật ký hoạt động',
  sectionBody: 'Nội dung báo cáo',
  colStep: 'Bước',
  colTask: 'Việc',
  colImpact: 'Ảnh hưởng',
  colRollback: 'Quay lui',
  colCommand: 'Lệnh',
  colVerdict: 'Kết quả',
  colDuration: 'Mất',
  colActor: 'Ai bảo',
  colAt: 'Lúc',
  colName: 'Tên',
  colLabel: 'Nhãn',
  colRequired: 'Bắt buộc',
  colDefault: 'Mặc định',
  colValue: 'Giá trị',
  colFact: 'Mục',
  impactRead: 'Chỉ đọc — không đổi gì',
  impactWrite: 'Có thay đổi trên tài khoản',
  impactDestructive: 'Phá huỷ — chạy lại không hoàn tác được',
  impactContext: 'Đổi ngữ cảnh đang làm việc',
  yes: 'có',
  no: 'không',
  diagram: 'Sơ đồ',
  verb: { check: 'Kiểm tra', do: 'Chạy', verify: 'Xác nhận', rollback: 'Quay lui' },
  verdict: {
    pending: 'chưa chạy',
    running: 'đang chạy',
    ok: 'xong',
    failed: 'lỗi',
    blocked: 'bị chặn',
    skipped: 'bỏ qua',
  },
  notDeclared: '(không khai báo)',
  rowPlaybook: 'Playbook',
  rowSource: 'Nguồn',
  rowStatus: 'Trạng thái',
  rowApprovedBy: 'Người duyệt',
  rowApprovedAt: 'Duyệt lúc',
  rowCreatedAt: 'Bắt đầu',
  rowProfile: 'Profile AWS',
  rowRegion: 'Region',
  rowCluster: 'Cluster',
  rowNamespace: 'Namespace',
  auditHint: (count) =>
    `Lượt chạy này đã ghi ${count} dòng vào nhật ký hoạt động. ` +
    `Lọc nhật ký theo cột "Ai bảo" để đối chiếu từng bước với đúng thứ đã chạy.`,
  missingRollback: 'Bước này không khai báo bước quay lui.',
  reportScope: 'Phạm vi',
}

export function labelsFor(lang: ShareLang): Labels {
  return lang === 'vi' ? VI : EN
}

// ─── Bước của một kế hoạch ───────────────────────────────────────────────────

/**
 * Một "bước" như NGƯỜI ĐỌC hiểu, không như file lưu.
 *
 * `schema.ts` lưu mỗi bước thành nhiều mục (một `check`, một `do`, một `verify`,
 * một `rollback`) và ghép chúng theo CHỈ SỐ. Mẫu xuất phải ghép lại đúng như vậy
 * — nếu không thì bản "Kế hoạch để duyệt" sẽ nói "bước 3" bằng một con số mà bản
 * runbook gọi là "bước 5", và hai tài liệu nói về cùng một việc lại đánh số khác
 * nhau.
 */
type PlanStep = {
  number: number
  title: string
  note: string
  do: PlaybookStep | undefined
  check: PlaybookStep | undefined
  verify: PlaybookStep | undefined
  rollback: PlaybookStep | undefined
}

const VERBS: readonly PlaybookVerb[] = ['check', 'do', 'verify', 'rollback']

export function planSteps(playbook: Playbook): PlanStep[] {
  const groups: Record<PlaybookVerb, PlaybookStep[]> = {
    check: stepsOfVerb(playbook, 'check'),
    do: stepsOfVerb(playbook, 'do'),
    verify: stepsOfVerb(playbook, 'verify'),
    rollback: stepsOfVerb(playbook, 'rollback'),
  }
  const count = Math.max(...VERBS.map((v) => groups[v].length))
  const out: PlanStep[] = []
  for (let i = 0; i < count; i++) {
    const check = groups.check[i]
    const doStep = groups.do[i]
    const verify = groups.verify[i]
    const rollback = groups.rollback[i]
    const anchor = doStep ?? check ?? verify ?? rollback
    if (!anchor) continue
    out.push({
      number: i + 1,
      title: anchor.title,
      // Chú thích lấy từ mục NEO của bước. `do` được ưu tiên vì đó là việc thật
      // sự xảy ra; `check`/`verify` chỉ bao quanh nó.
      note: anchor.note,
      do: doStep,
      check,
      verify,
      rollback,
    })
  }
  return out
}

function impactOf(step: PlanStep, labels: Labels): string {
  if (!step.do) return labels.impactRead
  switch (classify(step.do.tool, step.do.args)) {
    case 'read':
      return labels.impactRead
    case 'write':
      return labels.impactWrite
    case 'destructive':
      return labels.impactDestructive
    case 'context-switch':
      return labels.impactContext
  }
}

/** Nhãn Mermaid: dấu `"` đóng sớm nhãn, xuống dòng phá cú pháp. */
function mermaidLabel(text: string): string {
  return text.replace(/"/g, '#quot;').replace(/[\r\n]+/g, ' ').replace(/`/g, '#96;')
}

function planDiagram(steps: readonly PlanStep[], pattern: (step: PlanStep) => string): string {
  const lines = ['flowchart TD']
  for (const step of steps) lines.push(`  s${step.number}["${mermaidLabel(pattern(step))}"]`)
  for (const [index, step] of steps.entries()) {
    const previous = steps[index - 1]
    if (previous) lines.push(`  s${previous.number} --> s${step.number}`)
  }
  return lines.join('\n')
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s - m * 60)}s`
}

// ─── Mẫu 1+2: kế hoạch để duyệt · runbook kỹ thuật ───────────────────────────

export type PlaybookShareInput = {
  playbook: Playbook
  audience: 'approval' | 'runbook'
  generatedAt: string
  lang: ShareLang
  /** Trạng thái hiện tại của playbook (`draft`, `awaiting-approval`…). */
  status: PlaybookStatus
}

export function buildPlaybookShare(input: PlaybookShareInput): ShareDoc {
  const labels = labelsFor(input.lang)
  const steps = planSteps(input.playbook)
  const footer = {
    generatedAt: input.generatedAt,
    sourceLabel: input.playbook.name,
    sourceVersion: `${input.playbook.id} · ${input.playbook.updatedAt}`,
    status: input.status,
  }
  const diagram: ShareDiagram = {
    title: labels.diagram,
    mermaid: planDiagram(steps, (s) => `${s.number}. ${s.title}`),
  }

  if (input.audience === 'approval') {
    const rows = steps.map((s) => [
      String(s.number),
      s.title,
      impactOf(s, labels),
      s.rollback ? s.rollback.title : labels.missingRollback,
    ])
    const sections: ShareSection[] = [
      {
        title: labels.sectionSummary,
        blocks: [
          { kind: 'paragraph', text: input.playbook.description },
          {
            kind: 'table',
            columns: [labels.colStep, labels.colTask, labels.colImpact, labels.colRollback],
            rows,
          },
        ],
      },
    ]
    const notes: ShareBlock[] = steps
      .filter((s) => s.note.trim() !== '')
      .map((s) => ({ kind: 'paragraph', text: `${s.number}. ${s.note}` }))
    if (notes.length > 0) sections.push({ title: labels.sectionNotes, blocks: notes })
    return {
      title: labels.planTitle(input.playbook.name),
      subtitle: input.playbook.description,
      sections,
      diagram,
      footer,
      lang: input.lang,
    }
  }

  // Runbook: đủ thứ. Biến trước, rồi từng bước với đủ bốn verb.
  const blocks: ShareBlock[] = []
  for (const step of steps) {
    blocks.push({ kind: 'heading', level: 3, text: `${step.number}. ${step.title}` })
    if (step.note.trim() !== '') blocks.push({ kind: 'paragraph', text: step.note })
    for (const verb of VERBS) {
      const command = step[verb]
      if (!command) continue
      blocks.push({
        kind: 'code',
        language: 'bash',
        text: `${labels.verb[verb]}\n${[command.tool, ...command.args].join(' ')}`,
      })
    }
    if (!step.rollback) blocks.push({ kind: 'callout', tone: 'warn', text: labels.missingRollback })
  }

  const sections: ShareSection[] = []
  if (input.playbook.variables.length > 0) {
    sections.push({
      title: labels.sectionVariables,
      blocks: [
        {
          kind: 'table',
          columns: [labels.colName, labels.colLabel, labels.colRequired, labels.colDefault],
          rows: input.playbook.variables.map((v) => [
            v.name,
            v.label,
            v.required ? labels.yes : labels.no,
            v.default ?? '',
          ]),
        },
      ],
    })
  }
  sections.push({ title: labels.sectionSteps, blocks })

  return {
    title: labels.runbookTitle(input.playbook.name),
    subtitle: input.playbook.description,
    sections,
    diagram,
    footer,
    lang: input.lang,
  }
}

// ─── Mẫu 3: báo cáo sau khi chạy ─────────────────────────────────────────────

export type RunShareInput = {
  run: PlaybookRun
  generatedAt: string
  lang: ShareLang
}

export function buildRunShare(input: RunShareInput): ShareDoc {
  const { run } = input
  const labels = labelsFor(input.lang)
  const steps = planSteps(run.playbook)

  const facts: [string, string][] = [
    [labels.rowPlaybook, `${run.playbookName} (${run.playbookId})`],
    [labels.rowSource, run.source],
    [labels.rowStatus, run.status],
    [labels.rowCreatedAt, run.createdAt],
    [labels.rowApprovedBy, run.approvedBy ?? labels.notDeclared],
    [labels.rowApprovedAt, run.approvedAt ?? labels.notDeclared],
  ]
  if (run.context.profile) facts.push([labels.rowProfile, run.context.profile])
  if (run.context.region) facts.push([labels.rowRegion, run.context.region])
  if (run.context.cluster) facts.push([labels.rowCluster, run.context.cluster])
  if (run.context.namespace) facts.push([labels.rowNamespace, run.context.namespace])

  const rows = run.steps.map((s) => [
    s.stepId,
    s.title,
    s.command,
    labels.verdict[s.status],
    fmtDuration(s.durationMs),
    s.actor,
    s.at ?? '',
  ])

  const executed = run.steps.filter((s) => s.status === 'ok' || s.status === 'failed').length

  return {
    title: labels.runTitle(run.playbookName),
    subtitle: `${run.status} · ${run.createdAt}`,
    sections: [
      {
        title: labels.sectionOverview,
        blocks: [
          {
            kind: 'table',
            columns: [labels.colFact, labels.colValue],
            rows: facts.map(([k, v]) => [k, v]),
          },
        ],
      },
      {
        title: labels.sectionSteps,
        blocks: [
          {
            kind: 'table',
            columns: [
              labels.colStep,
              labels.colTask,
              labels.colCommand,
              labels.colVerdict,
              labels.colDuration,
              labels.colActor,
              labels.colAt,
            ],
            rows,
          },
        ],
      },
      {
        title: labels.sectionAudit,
        blocks: [{ kind: 'paragraph', text: labels.auditHint(executed) }],
      },
    ],
    diagram: {
      title: labels.diagram,
      mermaid: planDiagram(
        steps,
        (s) => `${s.number}. ${s.title} — ${labels.verdict[stepRunVerdict(run, s)]}`,
      ),
    },
    footer: {
      generatedAt: input.generatedAt,
      sourceLabel: run.playbookName,
      sourceVersion: `${run.playbookId} · run ${run.id}`,
      status: run.status,
    },
    lang: input.lang,
  }
}

/**
 * Trạng thái của một bước trong SƠ ĐỒ: lấy mục `do` làm đại diện, thiếu thì lấy
 * mục đầu tiên có mặt. Bản ghi của một lượt chạy cũ có thể không có đủ bốn verb
 * (lượt chạy dừng giữa đường), nên không được giả định `do` luôn tồn tại.
 */
function stepRunVerdict(run: PlaybookRun, step: PlanStep): StepRunStatus {
  for (const verb of VERBS) {
    const declared = step[verb]
    if (!declared) continue
    const recorded = run.steps.find((s) => s.stepId === declared.id)
    if (recorded) return recorded.status
  }
  return 'pending'
}

// ─── Báo cáo (mốc 6.6) ───────────────────────────────────────────────────────
//
// BỐN LOẠI, ĐÚNG BỐN — lấy nguyên từ `infra-monitoring-reports.md` §"Màn Báo cáo".
// Không thêm loại thứ năm cho "đủ bộ": mỗi loại ở đây tồn tại vì spec đặt tên nó,
// và mỗi loại phải có một câu lệnh đủ cụ thể để agent biết đọc nguồn nào.

export const REPORT_KINDS = ['cost-monthly', 'health-weekly', 'activity', 'incident'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

/**
 * Nhịp chạy diễn đạt được bằng lịch chạy HIỆN CÓ (ADR 0082): `interval` (≤ 7 ngày),
 * `daily`, `weekly`. Cố ý không có `once` — `schedules.upsert` chặn nó ở biên vì
 * nó là hình của lời hẹn agent tự đặt.
 */
export type ReportSchedule =
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; weekdays: readonly number[]; time: string }

export type ReportDefinition = {
  kind: ReportKind
  /** Khoá i18n cho nhãn — UI dịch, sidecar không ôm chuỗi hiển thị. */
  labelKey: string
  aboutKey: string
  /** Câu lệnh ghim vào phiên để agent viết báo cáo. */
  prompt: string
  /** Lịch đề xuất, hoặc `null` khi báo cáo chỉ chạy theo cú bấm. */
  schedule: ReportSchedule | null
  /**
   * Có nhịp trong spec nhưng KHÔNG diễn đạt được bằng lịch hiện có. UI phải NÓI RA
   * (khoá i18n) thay vì im lặng bỏ qua — người dùng đặt "hằng tháng" mà không thấy
   * gì xảy ra sẽ đi tìm lỗi ở chỗ khác.
   */
  scheduleGapKey: string | null
}

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    kind: 'cost-monthly',
    labelKey: 'infra.report.kind.cost',
    aboutKey: 'infra.report.kind.costAbout',
    prompt:
      'Produce the monthly cost report. Read the real spend for this account and region: ' +
      'cost broken down by service for this month, the same breakdown for last month, and the ' +
      'three line items that grew the most. For each of those three, say why it grew — tie it to ' +
      'a deployment, a scaling event, or an entry in the infrastructure activity log whenever the ' +
      'evidence is there. Do not guess: if you cannot explain a jump, say so and say what to check. ' +
      'End with the actions worth taking. Write in the language of this conversation.',
    // Spec: "ngày 1 hằng tháng". KHÔNG biểu diễn được: lịch chạy chỉ có interval
    // ≤ 7 ngày, daily, weekly. Xem `scheduleGapKey`.
    schedule: null,
    scheduleGapKey: 'infra.report.gap.monthly',
  },
  {
    kind: 'health-weekly',
    labelKey: 'infra.report.kind.health',
    aboutKey: 'infra.report.kind.healthAbout',
    prompt:
      'Produce the weekly health report. Cover availability, error rate, the alarms that fired, ' +
      'how many deployments happened, and what work is still open. Compare the last 7 days with ' +
      'the 7 days before them, and use the alarm history rather than only the current alarm state. ' +
      'End with what needs attention this week. Write in the language of this conversation.',
    schedule: { kind: 'weekly', weekdays: [1], time: '09:00' },
    scheduleGapKey: null,
  },
  {
    kind: 'activity',
    labelKey: 'infra.report.kind.activity',
    aboutKey: 'infra.report.kind.activityAbout',
    prompt:
      'Produce the activity report from the infrastructure activity log: who ran what, how many ' +
      'commands ran automatically versus after an approval, how many were blocked, and what they ' +
      'cost in total. Group by actor and by surface. Call out anything destructive and anything ' +
      'that failed. Write in the language of this conversation.',
    schedule: null,
    scheduleGapKey: null,
  },
  {
    kind: 'incident',
    labelKey: 'infra.report.kind.incident',
    aboutKey: 'infra.report.kind.incidentAbout',
    prompt:
      'Produce the incident report. Merge the three sources into one timeline: the action audit ' +
      'log, the application logs, and the metric charts — when the problem started, what was run, ' +
      'when a metric moved, and whether any step was rolled back. State the cause and the follow-up ' +
      'work. Include the architecture graph with the affected request path as a Mermaid diagram, ' +
      'and make every number traceable back to the point, line, or query it came from. ' +
      'Write in the language of this conversation.',
    schedule: null,
    scheduleGapKey: null,
  },
]

export function reportDefinition(kind: ReportKind): ReportDefinition {
  const found = REPORT_DEFINITIONS.find((d) => d.kind === kind)
  if (!found) throw new Error(`Unknown report kind: ${kind}`)
  return found
}

/**
 * Lịch đề xuất cho một loại báo cáo. `null` = không đặt lịch được (báo cáo chạy
 * theo cú bấm, hoặc nhịp trong spec không diễn đạt được bằng lịch hiện có).
 */
export function reportScheduleTrigger(kind: ReportKind): ReportSchedule | null {
  return reportDefinition(kind).schedule
}

// ─── Bản xuất của một báo cáo ────────────────────────────────────────────────

export type ReportShareInput = {
  kind: ReportKind
  /** Tiêu đề người dùng đặt, hoặc tiêu đề agent viết. */
  title: string
  /** Thân báo cáo — markdown do agent viết. */
  body: string
  generatedAt: string
  lang: ShareLang
  status?: string
  /** Phạm vi: profile · region · account (đã che nếu lớp che đang bật). */
  scope?: string
  diagram?: ShareDiagram
}

export function buildReportShare(input: ReportShareInput): ShareDoc {
  const labels = labelsFor(input.lang)
  const def = reportDefinition(input.kind)

  const overview: [string, string][] = [[labels.rowSource, input.kind]]
  if (input.scope) overview.push([labels.reportScope, input.scope])

  const doc: ShareDoc = {
    title: input.title,
    sections: [
      {
        title: labels.sectionOverview,
        blocks: [
          {
            kind: 'table',
            columns: [labels.colFact, labels.colValue],
            rows: overview.map(([k, v]) => [k, v]),
          },
        ],
      },
      // Thân báo cáo là markdown do agent viết. Không có bộ parse Markdown trong
      // sidecar (không thêm thư viện), nên bản Markdown nhúng nguyên văn còn bản
      // HTML đưa nó vào một khối chữ nguyên định dạng — xem `kit.ts#htmlBlock`.
      { title: labels.sectionBody, blocks: [{ kind: 'raw', text: input.body }] },
    ],
    footer: {
      generatedAt: input.generatedAt,
      sourceLabel: input.title,
      sourceVersion: def.kind,
      status: input.status ?? 'generated',
    },
    lang: input.lang,
  }
  if (input.diagram) doc.diagram = input.diagram
  return doc
}
