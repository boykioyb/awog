// Mốc 6 — CloudWatch alarms (6.3 · 6.4).
//
// Hai luật đáng đo ở đây:
//   · BA trạng thái, và "thiếu dữ liệu" là MỘT trong đó — một `StateValue` lạ
//     KHÔNG bao giờ được đọc thành "bình thường" (đèn xanh không ai kiểm);
//   · `put-metric-alarm` là GHI ⇒ mọi lượt gọi phải đi qua `runGated()`, và argv
//     phải đúng (percentile đi bằng `--extended-statistic`, dimension là cờ LẶP).
//
// `runInfra` + `runGated` đều bị mock — không ca nào spawn `aws` thật.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runInfra, runGated } = vi.hoisted(() => ({
  runInfra: vi.fn(),
  runGated: vi.fn(),
}))
vi.mock('../../run.js', () => ({ runInfra }))
vi.mock('../../gated.js', () => ({ runGated }))

import {
  MAX_ALARM_LIMIT,
  alarmHistory,
  awsStateValue,
  buildPutAlarmArgs,
  checkPutDimensions,
  classifyAlarmState,
  isComparisonOperator,
  isValidAlarmName,
  isValidArn,
  listAlarms,
  putAlarm,
  toAlarmSummary,
  type PutAlarmInput,
} from '../alarms.js'
import { lowerFirstKeys } from '../metrics.js'

function ok(stdout: unknown) {
  return {
    ok: true,
    exitCode: 0,
    stdout: JSON.stringify(stdout),
    stderr: '',
    durationMs: 5,
    truncated: false,
    class: 'read',
  }
}

function fail(stderr: string) {
  return {
    ok: false,
    exitCode: 254,
    stdout: '',
    stderr,
    durationMs: 5,
    truncated: false,
    class: 'read',
  }
}

/** Một `MetricAlarm` thô của CLI: tên trường HOA chữ đầu (giao thức `query`). */
function rawAlarm(over: Record<string, unknown> = {}) {
  return {
    AlarmName: 'HighCPU',
    AlarmArn: 'arn:aws:cloudwatch:ap-southeast-1:123456789012:alarm:HighCPU',
    StateValue: 'ALARM',
    StateReason: 'Threshold Crossed',
    StateUpdatedTimestamp: '2026-01-01T00:00:00Z',
    MetricName: 'CPUUtilization',
    Namespace: 'AWS/EC2',
    Dimensions: [{ Name: 'InstanceId', Value: 'i-1' }],
    Statistic: 'Average',
    Period: 300,
    ComparisonOperator: 'GreaterThanThreshold',
    Threshold: 80,
    EvaluationPeriods: 2,
    TreatMissingData: 'missing',
    ActionsEnabled: true,
    ...over,
  }
}

function putInput(over: Partial<PutAlarmInput> = {}): PutAlarmInput {
  return {
    name: 'HighCPU',
    namespace: 'AWS/EC2',
    metricName: 'CPUUtilization',
    stat: 'Average',
    periodSeconds: 300,
    evaluationPeriods: 2,
    threshold: 80,
    comparisonOperator: 'GreaterThanThreshold',
    treatMissingData: 'missing',
    context: {},
    surface: 'explorer',
    ...over,
  }
}

/** `toAlarmSummary` đọc khoá ĐÃ HẠ chữ đầu — đúng thứ `parseCloudWatchJson` trao
 *  cho nó trong production. Đưa thẳng object HOA chữ đầu vào là bỏ qua ranh giới. */
function summaryOf(raw: Record<string, unknown>) {
  return toAlarmSummary(lowerFirstKeys(raw) as Record<string, unknown>)
}

function argSent(args: string[], flag: string): string[] {
  const prefix = `${flag}=`
  return args.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length))
}

beforeEach(() => {
  runInfra.mockReset()
  runGated.mockReset()
})

// ─── Ba trạng thái ──────────────────────────────────────────────────────────

describe('classifyAlarmState', () => {
  it.each([
    ['ALARM', 'alarm'],
    ['OK', 'ok'],
    ['INSUFFICIENT_DATA', 'insufficient'],
    ['alarm', 'alarm'],
    ['ok', 'ok'],
  ])('%s ⇒ %s', (raw, expected) => {
    expect(classifyAlarmState(raw)).toBe(expected)
  })

  it('giá trị LẠ hoặc thiếu rơi về `insufficient`, KHÔNG BAO GIỜ về `ok`', () => {
    for (const raw of [undefined, '', 'PENDING', 'SOMETHING_NEW']) {
      expect(classifyAlarmState(raw)).toBe('insufficient')
    }
  })

  it('ba trạng thái của ta đi ngược lên AWS bằng tên AWS', () => {
    expect(awsStateValue('alarm')).toBe('ALARM')
    expect(awsStateValue('ok')).toBe('OK')
    expect(awsStateValue('insufficient')).toBe('INSUFFICIENT_DATA')
  })
})

// ─── Bảng kiểm đầu vào ──────────────────────────────────────────────────────

describe('kiểm tên/ARN', () => {
  it.each(['HighCPU', 'app/api-5xx', 'team.metric_1', ''])('tên %s', (name) => {
    expect(isValidAlarmName(name)).toBe(name.length > 0)
  })
  it('chặn ký tự lạ trong tên alarm', () => {
    expect(isValidAlarmName('name with space')).toBe(false)
    expect(isValidAlarmName('name;rm -rf')).toBe(false)
  })
  it.each([
    ['arn:aws:cloudwatch:ap-southeast-1:123456789012:alarm:x', true],
    ['arn:aws:sns:us-east-1:1:topic', true],
    ['not-an-arn', false],
    ['arn:aws:sns:us-east-1:1:', false],
  ])('%s ⇒ %s', (arn, expected) => {
    expect(isValidArn(arn)).toBe(expected)
  })
  it('chỉ nhận 4 toán tử so sánh của CloudWatch', () => {
    expect(isComparisonOperator('GreaterThanThreshold')).toBe(true)
    expect(isComparisonOperator('EqualTo')).toBe(false)
  })
})

describe('checkPutDimensions', () => {
  it('nhận dimension thường', () => {
    expect(checkPutDimensions([{ name: 'InstanceId', value: 'i-0123456789abcdef0' }])).toBe(null)
  })

  it('CHẶN giá trị chứa dấu phẩy — argv ngăn bằng phẩy nên cảnh báo sẽ gắn nhầm metric', () => {
    expect(checkPutDimensions([{ name: 'InstanceId', value: 'i-1,i-2' }])).toBe(
      'DIMENSION_VALUE_UNSUPPORTED',
    )
  })

  it('chặn giá trị chứa khoảng trắng và tên không hợp lệ', () => {
    expect(checkPutDimensions([{ name: 'InstanceId', value: 'i 1' }])).toBe(
      'DIMENSION_VALUE_UNSUPPORTED',
    )
    expect(checkPutDimensions([{ name: '1bad', value: 'x' }])).toBe('BAD_DIMENSION')
    expect(checkPutDimensions([{ name: 'Ok', value: '' }])).toBe('BAD_DIMENSION')
  })

  it('chặn hơn 30 dimension', () => {
    const dims = Array.from({ length: 31 }, (_, i) => ({ name: `D${String(i)}`, value: 'v' }))
    expect(checkPutDimensions(dims)).toBe('TOO_MANY_DIMENSIONS')
  })
})

// ─── Đọc: danh sách ─────────────────────────────────────────────────────────

describe('toAlarmSummary', () => {
  it('đọc tên trường HOA chữ đầu và chuẩn hoá trạng thái', () => {
    const s = summaryOf(rawAlarm())
    expect(s).not.toBe(null)
    expect(s?.name).toBe('HighCPU')
    expect(s?.state).toBe('alarm')
    expect(s?.threshold).toBe(80)
    expect(s?.stat).toBe('Average')
    expect(s?.dimensions).toEqual([{ name: 'InstanceId', value: 'i-1' }])
    expect(s?.stateUpdatedAt).toBe(Date.parse('2026-01-01T00:00:00Z'))
    expect(s?.actionsEnabled).toBe(true)
  })

  it('trường thiếu để null chứ KHÔNG bịa mặc định (ngưỡng 0 sẽ vẽ đường ở đáy biểu đồ)', () => {
    const s = summaryOf({ AlarmName: 'Plain', StateValue: 'OK' })
    expect(s?.threshold).toBe(null)
    expect(s?.periodSeconds).toBe(null)
    expect(s?.namespace).toBe(null)
    expect(s?.comparisonOperator).toBe(null)
    expect(s?.stateUpdatedAt).toBe(null)
    expect(s?.actionsEnabled).toBe(false)
  })

  it('extended-statistic được dùng khi không có statistic', () => {
    expect(summaryOf(rawAlarm({ Statistic: undefined, ExtendedStatistic: 'p95' }))?.stat).toBe('p95')
  })

  it('tên alarm không hợp lệ ⇒ bỏ bản ghi', () => {
    expect(summaryOf(rawAlarm({ AlarmName: 'bad name' }))).toBe(null)
    expect(summaryOf({})).toBe(null)
  })
})

describe('listAlarms', () => {
  it('sắp theo tên và báo `truncated` khi AWS còn trang', async () => {
    runInfra.mockResolvedValue(
      ok({
        MetricAlarms: [rawAlarm({ AlarmName: 'b' }), rawAlarm({ AlarmName: 'a' })],
        NextToken: 'more',
      }),
    )
    const res = await listAlarms({ surface: 'explorer' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.alarms.map((a) => a.name)).toEqual(['a', 'b'])
    expect(res.value.truncated).toBe(true)
  })

  it('không có nextToken ⇒ không truncated', async () => {
    runInfra.mockResolvedValue(ok({ MetricAlarms: [rawAlarm()] }))
    const res = await listAlarms({ surface: 'explorer' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.truncated).toBe(false)
  })

  it('dịch bộ lọc trạng thái sang `--state-value` của AWS', async () => {
    runInfra.mockResolvedValue(ok({ MetricAlarms: [] }))
    await listAlarms({ surface: 'explorer', stateFilter: 'insufficient' })
    const args = (runInfra.mock.calls[0]?.[0] as { args: string[] }).args
    expect(argSent(args, '--state-value')).toEqual(['INSUFFICIENT_DATA'])
  })

  it('kẹp `--max-items` vào trần của module', async () => {
    runInfra.mockResolvedValue(ok({ MetricAlarms: [] }))
    await listAlarms({ surface: 'explorer', limit: 10_000 })
    const args = (runInfra.mock.calls[0]?.[0] as { args: string[] }).args
    expect(argSent(args, '--max-items')).toEqual([String(MAX_ALARM_LIMIT)])
  })

  it('tên prefix xấu bị chặn trước khi spawn', async () => {
    const res = await listAlarms({ surface: 'explorer', namePrefix: 'bad prefix' })
    expect(res).toEqual({ ok: false, error: 'BAD_ALARM_PREFIX' })
    expect(runInfra).not.toHaveBeenCalled()
  })

  it('đầu ra không parse được ⇒ BAD_OUTPUT, không ném', async () => {
    runInfra.mockResolvedValue({ ...ok({}), stdout: 'not json' })
    expect(await listAlarms({ surface: 'explorer' })).toEqual({ ok: false, error: 'BAD_OUTPUT' })
  })

  it('lỗi CLI trả nguyên văn (đã cắt)', async () => {
    runInfra.mockResolvedValue(fail('An error occurred (AccessDenied)'))
    const res = await listAlarms({ surface: 'explorer' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('AccessDenied')
  })
})

// ─── Đọc: lịch sử ───────────────────────────────────────────────────────────

describe('alarmHistory', () => {
  it('sắp MỚI NHẤT trước (câu hỏi của màn này luôn là "vừa rồi nó làm gì")', async () => {
    runInfra.mockResolvedValue(
      ok({
        AlarmHistoryItems: [
          { Timestamp: '2026-01-01T00:00:00Z', HistoryItemType: 'StateUpdate', HistorySummary: 'old' },
          { Timestamp: '2026-01-02T00:00:00Z', HistoryItemType: 'Action', HistorySummary: 'new' },
        ],
      }),
    )
    const res = await alarmHistory({ alarmName: 'HighCPU', surface: 'explorer' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.entries.map((e) => e.summary)).toEqual(['new', 'old'])
  })

  it('tên xấu bị chặn trước khi spawn', async () => {
    const res = await alarmHistory({ alarmName: 'bad name', surface: 'explorer' })
    expect(res).toEqual({ ok: false, error: 'BAD_ALARM_NAME' })
    expect(runInfra).not.toHaveBeenCalled()
  })
})

// ─── Ghi: dựng argv ─────────────────────────────────────────────────────────

describe('buildPutAlarmArgs', () => {
  it('bốn thống kê cơ bản đi bằng `--statistic`', () => {
    const args = buildPutAlarmArgs(putInput({ stat: 'Average' }))
    expect(argSent(args, '--statistic')).toEqual(['Average'])
    expect(argSent(args, '--extended-statistic')).toEqual([])
  })

  it.each(['p50', 'p95', 'p99.9'])('%s đi bằng `--extended-statistic` (AWS từ chối nó ở --statistic)', (stat) => {
    const args = buildPutAlarmArgs(putInput({ stat }))
    expect(argSent(args, '--extended-statistic')).toEqual([stat])
    expect(argSent(args, '--statistic')).toEqual([])
  })

  it('mỗi dimension là một cờ LẶP, giá trị ghép Name=…,Value=…', () => {
    const args = buildPutAlarmArgs(
      putInput({
        dimensions: [
          { name: 'InstanceId', value: 'i-1' },
          { name: 'Env', value: 'prod' },
        ],
      }),
    )
    expect(argSent(args, '--dimensions')).toEqual([
      'Name=InstanceId,Value=i-1',
      'Name=Env,Value=prod',
    ])
  })

  it('không có dimension ⇒ không gửi cờ nào', () => {
    expect(argSent(buildPutAlarmArgs(putInput()), '--dimensions')).toEqual([])
  })

  it('mô tả rỗng/trắng không sinh cờ thừa', () => {
    expect(argSent(buildPutAlarmArgs(putInput({ alarmDescription: '   ' })), '--alarm-description')).toEqual(
      [],
    )
    expect(argSent(buildPutAlarmArgs(putInput({ alarmDescription: ' watch ' })), '--alarm-description')).toEqual(
      ['watch'],
    )
  })

  it('chặn trần 5 action ARN', () => {
    const arns = Array.from({ length: 8 }, (_, i) => `arn:aws:sns:us-east-1:1:t${String(i)}`)
    expect(argSent(buildPutAlarmArgs(putInput({ alarmActions: arns })), '--alarm-actions')).toHaveLength(5)
  })

  it('mang đủ ngưỡng/chu kỳ/số chu kỳ và treat-missing-data', () => {
    const args = buildPutAlarmArgs(putInput({ threshold: 12.5, periodSeconds: 60, evaluationPeriods: 3 }))
    expect(argSent(args, '--threshold')).toEqual(['12.5'])
    expect(argSent(args, '--period')).toEqual(['60'])
    expect(argSent(args, '--evaluation-periods')).toEqual(['3'])
    expect(argSent(args, '--treat-missing-data')).toEqual(['missing'])
    expect(args.slice(0, 3)).toEqual(['cloudwatch', 'put-metric-alarm', '--output'])
  })
})

// ─── Ghi: đi qua CỔNG QUYỀN ─────────────────────────────────────────────────

describe('putAlarm', () => {
  it('mọi lời gọi hợp lệ đi qua runGated với toolName `alarm_put`, KHÔNG gọi runInfra', async () => {
    runGated.mockResolvedValue({
      blocked: true,
      requiresApproval: true,
      approvalTicket: 'ticket-1',
      command: 'aws cloudwatch put-metric-alarm',
      class: 'write',
      accountKind: 'normal',
      mode: 'ask',
      reason: 'write requires approval',
    })
    const res = await putAlarm(putInput({ approvalTicket: 'old' }))
    expect(runGated).toHaveBeenCalledTimes(1)
    expect(runInfra).not.toHaveBeenCalled()
    const call = runGated.mock.calls[0]?.[0] as { toolName: string; tool: string; surface: string; approvalTicket?: string }
    expect(call.toolName).toBe('alarm_put')
    expect(call.tool).toBe('aws')
    expect(call.surface).toBe('explorer')
    expect(call.approvalTicket).toBe('old')
    expect(res.blocked).toBe(true)
  })

  it('đầu vào sai bị từ chối TRƯỚC cổng quyền, dạng `block` để UI chỉ có một đường xử lý', async () => {
    for (const bad of [
      putInput({ name: 'bad name' }),
      putInput({ stat: 'avg' }),
      putInput({ periodSeconds: 7 }),
      putInput({ threshold: Number.NaN }),
      putInput({ namespace: 'bad namespace' }),
      putInput({ dimensions: [{ name: 'InstanceId', value: 'a,b' }] }),
      putInput({ alarmActions: ['not-an-arn'] }),
    ]) {
      runGated.mockClear()
      const res = await putAlarm(bad)
      expect(res.blocked).toBe(true)
      if (!res.blocked) return
      expect(res.mode).toBe('block')
      expect(res.requiresApproval).toBe(false)
      expect(runGated).not.toHaveBeenCalled()
    }
  })

  it('vé duyệt được chuyển tiếp nguyên vẹn khi gọi lại', async () => {
    runGated.mockResolvedValue({
      blocked: false,
      command: 'aws cloudwatch put-metric-alarm',
      class: 'write',
      accountKind: 'normal',
      decision: 'approved',
      result: { ok: true, exitCode: 0, stdout: '{}', stderr: '', durationMs: 5, truncated: false, class: 'write' },
    })
    const res = await putAlarm(putInput({ approvalTicket: 'ticket-9', sessionId: 's1', messageId: 'm1' }))
    const call = runGated.mock.calls[0]?.[0] as { approvalTicket?: string; sessionId?: string; messageId?: string }
    expect(call.approvalTicket).toBe('ticket-9')
    expect(call.sessionId).toBe('s1')
    expect(call.messageId).toBe('m1')
    expect(res.blocked).toBe(false)
  })
})
