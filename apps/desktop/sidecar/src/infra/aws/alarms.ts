// CloudWatch alarms — Mốc 6 (6.3 · 6.4).
//
// BA LỆNH, HAI LỚP QUYỀN:
//   · `describe-alarms` / `describe-alarm-history` là ĐỌC — đi thẳng `runInfra`,
//     cùng khuôn `logs.ts` (bề mặt con người, mỗi lượt đứng sau một cú bấm).
//   · `put-metric-alarm` là GHI và nó ĐỔI HÀNH VI CỦA TÀI KHOẢN (một cảnh báo
//     mới sẽ tự bắn thông báo cho người trực lúc 3 giờ sáng) ⇒ mọi lượt gọi đi
//     qua `runGated()` — cùng cổng quyền, cùng dòng nhật ký, cùng cơ chế VÉ mà
//     Explorer/Logs/kubectl dùng. File này KHÔNG tự spawn `aws`: nó khai argv rồi
//     để cổng quyết định.
//
// BA TRẠNG THÁI, KHÔNG PHẢI HAI. AWS trả `StateValue` ∈ {OK, ALARM,
// INSUFFICIENT_DATA}. Spec (`infra-monitoring-reports.md` §"Màn Giám sát") nói rõ
// "Thiếu dữ liệu" là trạng thái RIÊNG, không phải "ổn" — nên `classifyAlarmState()`
// dưới đây KHÔNG bao giờ trả `ok` cho một giá trị nó không nhận ra. Đây là hàng
// rào chống đúng lỗi mà màn Tổng quan của Mốc 2 đã ghi lại: đèn xanh cho một thứ
// chưa kiểm là nói dối.
//
// TRẦN CỨNG: không giá trị secret nào rời sidecar. Cả ba lệnh chỉ trả metadata
// (tên, ngưỡng, trạng thái) — không có credential nào đi qua đây.

import { z } from 'zod'
import { runInfra } from '../run.js'
import { runGated } from '../gated.js'
import { flagValue } from './logs.js'
import {
  isValidPeriod,
  isValidStat,
  lowerFirstKeys,
  type MetricDimension,
} from './metrics.js'
import type { InfraSurface } from '../audit/store.js'
import type { InfraContext } from '../run.js'
import type { InfraGatedResult } from '../gated.js'

const QUERY_TIMEOUT_MS = 45_000

/** Trần mỗi lượt `describe-alarms` (AWS cho 100/trang; ta lấy tối đa 2 trang). */
const DEFAULT_ALARM_LIMIT = 100
export const MAX_ALARM_LIMIT = 200

/** Trần mỗi lượt `describe-alarm-history`. */
const DEFAULT_HISTORY_LIMIT = 50
export const MAX_HISTORY_LIMIT = 200

// ─── Trạng thái cảnh báo ────────────────────────────────────────────────────

export const ALARM_STATES = ['alarm', 'ok', 'insufficient'] as const
export type AlarmState = (typeof ALARM_STATES)[number]

/**
 * `StateValue` của AWS ⇒ một trong ba trạng thái của màn Giám sát.
 *
 * Giá trị LẠ rơi về `insufficient`, KHÔNG rơi về `ok`: một trạng thái AWS mới
 * thêm (hoặc một trường bị thiếu vì lý do gì đó) mà được đọc thành "bình thường"
 * là một đèn xanh không ai kiểm.
 */
export function classifyAlarmState(raw: string | undefined): AlarmState {
  switch ((raw ?? '').toUpperCase()) {
    case 'ALARM':
      return 'alarm'
    case 'OK':
      return 'ok'
    case 'INSUFFICIENT_DATA':
      return 'insufficient'
    default:
      return 'insufficient'
  }
}

// ─── Kiểu công khai ─────────────────────────────────────────────────────────

export type AlarmSummary = {
  name: string
  arn: string
  state: AlarmState
  /** Câu AWS đưa ra — lý do đổi trạng thái. */
  stateReason: string
  /** Lúc trạng thái hiện tại bắt đầu (ms). `null` khi AWS không trả. */
  stateUpdatedAt: number | null
  metricName: string | null
  namespace: string | null
  dimensions: MetricDimension[]
  stat: string | null
  periodSeconds: number | null
  comparisonOperator: string | null
  threshold: number | null
  evaluationPeriods: number | null
  treatMissingData: string | null
  actionsEnabled: boolean
}

export type AlarmHistoryEntry = {
  at: number | null
  type: string
  summary: string
}

export type AlarmsOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

// ─── Kiểm tra đầu vào (thuần, test bằng bảng) ───────────────────────────────

/** Tên alarm: AWS cho chữ, số, `-`, `_`, `.`, `/`. Ký tự điều khiển bị chặn. */
const ALARM_NAME_RE = /^[\w./-]{1,255}$/
/** ARN: chỉ cần đủ hình dạng để không thành một chuỗi tuỳ ý đi vào argv. */
const ARN_RE = /^arn:aws[a-z-]*:[a-z0-9-]+:[a-z0-9-]*:[0-9]{0,12}:[^\s,]{1,1024}$/
const COMPARISON_OPERATORS = [
  'GreaterThanThreshold',
  'GreaterThanOrEqualToThreshold',
  'LessThanThreshold',
  'LessThanOrEqualToThreshold',
] as const
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number]

const TREAT_MISSING_DATA = ['breaching', 'notBreaching', 'ignore', 'missing'] as const
export type TreatMissingData = (typeof TREAT_MISSING_DATA)[number]

export function isValidAlarmName(name: string): boolean {
  return ALARM_NAME_RE.test(name)
}

export function isValidArn(arn: string): boolean {
  return ARN_RE.test(arn)
}

export function isComparisonOperator(v: string): v is ComparisonOperator {
  return (COMPARISON_OPERATORS as readonly string[]).includes(v)
}

export function isTreatMissingData(v: string): v is TreatMissingData {
  return (TREAT_MISSING_DATA as readonly string[]).includes(v)
}

/**
 * Dimension của `put-metric-alarm` đi vào argv theo DẤU PHẨY ngăn cách
 * (`--dimensions Name=x,Value=y`), nên một giá trị chứa `,` sẽ bị AWS cắt thành
 * hai dimension và lệnh hoặc hỏng hoặc — tệ hơn — đặt cảnh báo lên metric khác.
 * Chặn ở biên, và nói thẳng ra vì sao.
 */
export function checkPutDimensions(dims: readonly MetricDimension[]): string | null {
  if (dims.length > 30) return 'TOO_MANY_DIMENSIONS'
  for (const d of dims) {
    if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,254}$/.test(d.name)) return 'BAD_DIMENSION'
    if (d.value.length === 0 || d.value.length > 1024) return 'BAD_DIMENSION'
    if (/[,\s]/.test(d.value)) return 'DIMENSION_VALUE_UNSUPPORTED'
  }
  return null
}

// ─── Đọc: danh sách cảnh báo ────────────────────────────────────────────────

export type ListAlarmsInput = {
  profile?: string | undefined
  region?: string | undefined
  surface: InfraSurface
  actor?: string | undefined
  /** Lọc phía AWS — rẻ, và đúng thứ danh sách này dùng để làm. */
  stateFilter?: AlarmState | undefined
  namePrefix?: string | undefined
  limit?: number | undefined
}

/** Ba trạng thái của ta ⇒ `--state-value` của AWS. `insufficient` là
 *  `INSUFFICIENT_DATA`; giá trị này KHÁC chuỗi hiện trên UI. */
export function awsStateValue(state: AlarmState): string {
  if (state === 'alarm') return 'ALARM'
  if (state === 'ok') return 'OK'
  return 'INSUFFICIENT_DATA'
}

const AlarmsResponse = z.object({
  metricAlarms: z.array(z.record(z.string(), z.unknown())).default([]),
  nextToken: z.string().max(8192).optional(),
})

/** `parseJson` + hạ chữ đầu khoá (CloudWatch là giao thức `query` — xem
 *  `lowerFirstKeys` ở `metrics.ts`). */
function parseCloudWatchJson(text: string): unknown {
  try {
    return lowerFirstKeys(JSON.parse(text))
  } catch {
    return null
  }
}

export async function listAlarms(input: ListAlarmsInput): Promise<AlarmsOutcome<{
  alarms: AlarmSummary[]
  truncated: boolean
}>> {
  if (input.namePrefix !== undefined && !ALARM_NAME_RE.test(input.namePrefix)) {
    return { ok: false, error: 'BAD_ALARM_PREFIX' }
  }
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_ALARM_LIMIT, 1), MAX_ALARM_LIMIT)

  const args = ['cloudwatch', 'describe-alarms', '--output', 'json']
  if (input.stateFilter !== undefined) {
    args.push(flagValue('--state-value', awsStateValue(input.stateFilter)))
  }
  if (input.namePrefix !== undefined) args.push(flagValue('--alarm-name-prefix', input.namePrefix))
  // `--max-items` chứ không `--page-size`: nó cho phép CLI gộp trang, nhưng khi
  // gộp thì đầu ra mang `nextToken` riêng của nó — vì vậy phải trả về cờ "còn nữa"
  // thay vì im lặng cắt, nếu không người dùng tưởng tài khoản chỉ có chừng ấy alarm.
  args.push(flagValue('--max-items', String(limit)))

  const run = await runInfra({
    tool: 'aws',
    args,
    context: {
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.region ? { region: input.region } : {}),
    },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'alarm_list',
    decision: 'approved',
    timeoutMs: QUERY_TIMEOUT_MS,
  })
  if (!run.ok) return { ok: false, error: cliError(run) }

  const parsed = AlarmsResponse.safeParse(parseCloudWatchJson(run.stdout))
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }

  const alarms = parsed.data.metricAlarms
    .map(toAlarmSummary)
    .filter((a): a is AlarmSummary => a !== null)
    .sort((a, b) => a.name.localeCompare(b.name))

  return { ok: true, value: { alarms, truncated: parsed.data.nextToken !== undefined } }
}

/**
 * Một `MetricAlarm` thô ⇒ `AlarmSummary`.
 *
 * Trường nào AWS không trả thì để `null` — KHÔNG bịa mặc định. Một `threshold`
 * mặc định 0 sẽ vẽ một đường ngưỡng ở đáy biểu đồ như thể đó là cấu hình thật.
 */
export function toAlarmSummary(raw: Record<string, unknown>): AlarmSummary | null {
  const name = str(raw.alarmName)
  if (name === null || !isValidAlarmName(name)) return null
  const dims = Array.isArray(raw.dimensions)
    ? raw.dimensions.flatMap((d) => {
        if (typeof d !== 'object' || d === null) return []
        const dn = str((d as Record<string, unknown>).name)
        const dv = str((d as Record<string, unknown>).value)
        return dn !== null && dv !== null ? [{ name: dn, value: dv }] : []
      })
    : []
  return {
    name,
    arn: str(raw.alarmArn) ?? '',
    state: classifyAlarmState(str(raw.stateValue) ?? undefined),
    stateReason: str(raw.stateReason) ?? '',
    stateUpdatedAt: ms(raw.stateUpdatedTimestamp),
    metricName: str(raw.metricName),
    namespace: str(raw.namespace),
    dimensions: dims,
    stat: str(raw.statistic) ?? str(raw.extendedStatistic),
    periodSeconds: num(raw.period),
    comparisonOperator: str(raw.comparisonOperator),
    threshold: num(raw.threshold),
    evaluationPeriods: num(raw.evaluationPeriods),
    treatMissingData: str(raw.treatMissingData),
    actionsEnabled: raw.actionsEnabled === true,
  }
}

// ─── Đọc: lịch sử cảnh báo ──────────────────────────────────────────────────

export type AlarmHistoryInput = {
  alarmName: string
  profile?: string | undefined
  region?: string | undefined
  surface: InfraSurface
  actor?: string | undefined
  historyItemType?: 'StateUpdate' | 'Action' | 'ConfigurationUpdate' | undefined
  limit?: number | undefined
}

const HistoryResponse = z.object({
  alarmHistoryItems: z
    .array(
      z.object({
        timestamp: z.string().max(64).optional(),
        historyItemType: z.string().max(32).optional(),
        historySummary: z.string().max(4096).optional(),
      }),
    )
    .default([]),
  nextToken: z.string().max(8192).optional(),
})

export async function alarmHistory(input: AlarmHistoryInput): Promise<AlarmsOutcome<{
  entries: AlarmHistoryEntry[]
  truncated: boolean
}>> {
  if (!isValidAlarmName(input.alarmName)) return { ok: false, error: 'BAD_ALARM_NAME' }
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT)
  const args = ['cloudwatch', 'describe-alarm-history', '--output', 'json']
  args.push(flagValue('--alarm-name', input.alarmName))
  if (input.historyItemType !== undefined) {
    args.push(flagValue('--history-item-type', input.historyItemType))
  }
  args.push(flagValue('--max-items', String(limit)))

  const run = await runInfra({
    tool: 'aws',
    args,
    context: {
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.region ? { region: input.region } : {}),
    },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'alarm_history',
    decision: 'approved',
    timeoutMs: QUERY_TIMEOUT_MS,
  })
  if (!run.ok) return { ok: false, error: cliError(run) }

  const parsed = HistoryResponse.safeParse(parseCloudWatchJson(run.stdout))
  if (!parsed.success) return { ok: false, error: 'BAD_OUTPUT' }

  return {
    ok: true,
    value: {
      entries: parsed.data.alarmHistoryItems
        .map((h) => ({
          at: ms(h.timestamp),
          type: h.historyItemType ?? 'Unknown',
          summary: h.historySummary ?? '',
        }))
        // Mới nhất trước: câu hỏi người dùng hỏi màn này luôn là "vừa rồi nó làm gì".
        .sort((a, b) => (b.at ?? 0) - (a.at ?? 0)),
      truncated: parsed.data.nextToken !== undefined,
    },
  }
}

// ─── Ghi: đặt cảnh báo (đi qua CỔNG QUYỀN) ──────────────────────────────────

export type PutAlarmInput = {
  name: string
  namespace: string
  metricName: string
  dimensions?: readonly MetricDimension[] | undefined
  stat: string
  periodSeconds: number
  evaluationPeriods: number
  threshold: number
  comparisonOperator: ComparisonOperator
  treatMissingData: TreatMissingData
  alarmDescription?: string | undefined
  /** ARN nhận thông báo (SNS). Không có ⇒ cảnh báo chỉ đổi trạng thái, không ai được báo. */
  alarmActions?: readonly string[] | undefined
  context: InfraContext
  surface: InfraSurface
  approvalTicket?: string | undefined
  sessionId?: string | undefined
  messageId?: string | undefined
}

/** Trần số action ARN — chặn một payload IPC bịa ra hàng nghìn ARN. */
const MAX_ALARM_ACTIONS = 5

/**
 * Dựng argv của `put-metric-alarm`. Xuất ra ngoài để test được phần đáng test:
 * percentile phải đi bằng `--extended-statistic` chứ KHÔNG phải `--statistic`
 * (AWS từ chối `p95` ở cờ sau), và dimension phải là một cờ LẶP.
 */
export function buildPutAlarmArgs(input: PutAlarmInput): string[] {
  const args = [
    'cloudwatch',
    'put-metric-alarm',
    '--output',
    'json',
    flagValue('--alarm-name', input.name),
    flagValue('--namespace', input.namespace),
    flagValue('--metric-name', input.metricName),
    flagValue('--comparison-operator', input.comparisonOperator),
    flagValue('--period', String(input.periodSeconds)),
    flagValue('--evaluation-periods', String(input.evaluationPeriods)),
    flagValue('--threshold', String(input.threshold)),
    flagValue('--treat-missing-data', input.treatMissingData),
  ]
  // p50/p95/p99 là `ExtendedStatistic`; bốn thống kê còn lại là `Statistic`. Gửi
  // sai cờ thì AWS trả `ValidationError` chứ không âm thầm bỏ qua, nhưng câu lỗi
  // nói về một cờ người dùng không hề gõ — nên chọn đúng ngay ở đây.
  if (isPercentile(input.stat)) args.push(flagValue('--extended-statistic', input.stat))
  else args.push(flagValue('--statistic', input.stat))
  if (input.alarmDescription !== undefined && input.alarmDescription.trim().length > 0) {
    args.push(flagValue('--alarm-description', input.alarmDescription.trim().slice(0, 1024)))
  }
  for (const d of input.dimensions ?? []) {
    args.push(flagValue('--dimensions', `Name=${d.name},Value=${d.value}`))
  }
  for (const arn of (input.alarmActions ?? []).slice(0, MAX_ALARM_ACTIONS)) {
    args.push(flagValue('--alarm-actions', arn))
  }
  return args
}

export function isPercentile(stat: string): boolean {
  return /^p\d{1,2}(\.\d{1,2})?$/.test(stat)
}

/**
 * Đặt (hoặc ghi đè) một cảnh báo metric. Trả NGUYÊN kết quả của cổng quyền để UI
 * mở hộp duyệt rồi gọi lại kèm vé — cùng khuôn `infra.kube`/`infra.cicd-action`.
 */
export async function putAlarm(input: PutAlarmInput): Promise<InfraGatedResult> {
  if (!isValidAlarmName(input.name)) {
    return refuse('BAD_ALARM_NAME')
  }
  const dimProblem = checkPutDimensions(input.dimensions ?? [])
  if (dimProblem !== null) return refuse(dimProblem)
  if (!isValidStat(input.stat)) return refuse('BAD_STAT')
  if (!isValidPeriod(input.periodSeconds)) return refuse('BAD_PERIOD')
  if (!Number.isInteger(input.evaluationPeriods) || input.evaluationPeriods < 1) {
    return refuse('BAD_EVALUATION_PERIODS')
  }
  if (!Number.isFinite(input.threshold)) return refuse('BAD_THRESHOLD')
  if (!isComparisonOperator(input.comparisonOperator)) return refuse('BAD_COMPARISON_OPERATOR')
  if (!isTreatMissingData(input.treatMissingData)) return refuse('BAD_TREAT_MISSING_DATA')
  if (!/^[A-Za-z0-9/_.-]{1,255}$/.test(input.namespace)) return refuse('BAD_NAMESPACE')
  if (!/^[A-Za-z0-9/_.:%-]{1,255}$/.test(input.metricName)) return refuse('BAD_METRIC_NAME')
  for (const arn of input.alarmActions ?? []) {
    if (!isValidArn(arn)) return refuse('BAD_ALARM_ACTION')
  }

  return runGated({
    tool: 'aws',
    args: buildPutAlarmArgs(input),
    context: input.context,
    surface: input.surface,
    toolName: 'alarm_put',
    ...(input.approvalTicket !== undefined ? { approvalTicket: input.approvalTicket } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
    timeoutMs: QUERY_TIMEOUT_MS,
  })
}

/**
 * Từ chối TRƯỚC khi tới cổng quyền, dạng `InfraGatedResult` để UI chỉ có một
 * đường xử lý. `mode: 'block'` vì đây là lời gọi SAI, không phải một lệnh cần
 * người duyệt — mở hộp duyệt cho nó là mời người dùng bấm một nút không có tác
 * dụng. `class: 'write'` phản ánh đúng lời gọi sẽ chạy nếu nó hợp lệ.
 */
function refuse(reason: string): InfraGatedResult {
  return {
    blocked: true,
    requiresApproval: false,
    command: 'aws cloudwatch put-metric-alarm',
    class: 'write',
    accountKind: 'normal',
    mode: 'block',
    reason,
  }
}

// ─── Dùng chung ─────────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function ms(v: unknown): number | null {
  if (typeof v !== 'string' || v.length === 0) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

function cliError(run: { stderr: string; exitCode: number | null }): string {
  const detail = run.stderr.trim() || `aws exited with code ${String(run.exitCode)}`
  return detail.slice(0, 600)
}
