// Mốc 6 — CloudWatch metrics (6.1 · 6.2).
//
// Điều đáng đo ở file này KHÔNG phải "AWS trả gì" (đó là việc của AWS), mà là ba
// luật AWOG tự đặt quanh bề mặt TÍNH TIỀN THEO METRIC × ĐIỂM:
//   · một lời gọi mang NHIỀU metric (chia lô) — số lời gọi CLI phải theo số LÔ,
//     không theo số metric;
//   · trúng cache thì KHÔNG spawn CLI, và `force` mới là thứ xoá bỏ đường tắt đó;
//   · điểm thiếu (`null`) là dữ liệu có nghĩa, không được lọc im lặng thành "0".
//
// `runInfra` bị mock — không ca nào spawn `aws` thật.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runInfra } = vi.hoisted(() => ({ runInfra: vi.fn() }))
vi.mock('../../run.js', () => ({ runInfra }))

import {
  MAX_METRICS_PER_CALL,
  awsQueryId,
  buildMetricDataQueries,
  chunkQueries,
  clearMetricCache,
  getMetricData,
  isValidPeriod,
  isValidStat,
  lowerFirstKeys,
  metricCacheKey,
  metricCacheSize,
  parseMetricData,
  validateQuery,
  type MetricQuery,
} from '../metrics.js'

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

/** Một response `get-metric-data` giả, tên trường viết HOA chữ đầu như CLI thật
 *  in ra (CloudWatch là giao thức `query`) — cố ý để test bắt được việc hạ khoá. */
function cwResponse(
  results: {
    Id: string
    Label?: string
    Timestamps: string[]
    Values: (number | null)[]
    StatusCode?: string
  }[],
) {
  return { MetricDataResults: results, Messages: [] }
}

function query(over: Partial<MetricQuery> = {}): MetricQuery {
  return {
    key: 'k1',
    namespace: 'AWS/EC2',
    metricName: 'CPUUtilization',
    stat: 'Average',
    periodSeconds: 300,
    ...over,
  }
}

/** Cửa sổ 1 giờ nằm trong quá khứ, hợp lệ với `checkWindow`. */
const NOW = Date.now()
const START_MS = NOW - 60 * 60_000
const END_MS = NOW

function fetch(over: Partial<Parameters<typeof getMetricData>[0]> = {}) {
  return getMetricData({
    queries: [query()],
    startMs: START_MS,
    endMs: END_MS,
    surface: 'explorer',
    ...over,
  })
}

/** Giá trị của một cờ dạng `--flag=value` trong argv của lượt gọi CLI đã gửi. */
function flagSent(callIndex: number, flag: string): string | null {
  const call = runInfra.mock.calls[callIndex]?.[0] as { args: string[] } | undefined
  const prefix = `${flag}=`
  return call?.args.find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? null
}

beforeEach(() => {
  runInfra.mockReset()
  clearMetricCache()
})

// ─── Hạ khoá: hai họ CloudWatch nói hai thứ tiếng ──────────────────────────

describe('lowerFirstKeys', () => {
  it('hạ chữ đầu ở mọi tầng, kể cả trong mảng', () => {
    expect(
      lowerFirstKeys({
        MetricDataResults: [{ Id: 'm0', Timestamps: ['2026-01-01T00:00:00Z'], Values: [1] }],
        Messages: [],
      }),
    ).toEqual({
      metricDataResults: [{ id: 'm0', timestamps: ['2026-01-01T00:00:00Z'], values: [1] }],
      messages: [],
    })
  })

  it('là no-op với khoá đã ở dạng thường và với giá trị không phải object', () => {
    expect(lowerFirstKeys({ alarmName: 'a', threshold: 5 })).toEqual({ alarmName: 'a', threshold: 5 })
    expect(lowerFirstKeys('x')).toBe('x')
    expect(lowerFirstKeys(null)).toBe(null)
    expect(lowerFirstKeys(7)).toBe(7)
  })
})

// ─── Bảng kiểm đầu vào ──────────────────────────────────────────────────────

describe('isValidPeriod', () => {
  it.each([
    [1, true],
    [5, true],
    [10, true],
    [30, true],
    [60, true],
    [300, true],
    [3600, true],
    [86400, true],
    [2, false],
    [45, false],
    [90, false],
    [0, false],
    [-60, false],
    [86401, false],
    [300.5, false],
  ])('%i ⇒ %s', (period, expected) => {
    expect(isValidPeriod(period)).toBe(expected)
  })
})

describe('isValidStat', () => {
  it.each(['Average', 'Sum', 'Minimum', 'Maximum', 'SampleCount', 'p95', 'p99.9', 'p50'])(
    '%s hợp lệ',
    (s) => {
      expect(isValidStat(s)).toBe(true)
    },
  )
  it.each(['', 'avg', 'percentile95', 'p', 'p1000', 'p95,5'])('%s không hợp lệ', (s) => {
    expect(isValidStat(s)).toBe(false)
  })
})

describe('validateQuery', () => {
  it('trả null cho một query đủ trường', () => {
    expect(validateQuery(query())).toBe(null)
  })

  it('trả mã lỗi CỤ THỂ cho từng trường hỏng (UI dịch được câu lỗi)', () => {
    expect(validateQuery(query({ key: 'has space' }))).toBe('BAD_QUERY_KEY')
    expect(validateQuery(query({ namespace: '' }))).toBe('BAD_NAMESPACE')
    expect(validateQuery(query({ metricName: 'bad name' }))).toBe('BAD_METRIC_NAME')
    expect(validateQuery(query({ stat: 'avg' }))).toBe('BAD_STAT')
    expect(validateQuery(query({ periodSeconds: 7 }))).toBe('BAD_PERIOD')
    expect(validateQuery(query({ unit: 'B1' }))).toBe('BAD_UNIT')
    expect(validateQuery(query({ dimensions: [{ name: '1bad', value: 'x' }] }))).toBe('BAD_DIMENSION')
  })

  it('chặn hơn 30 dimension', () => {
    const dims = Array.from({ length: 31 }, (_, i) => ({ name: `D${String(i)}`, value: 'v' }))
    expect(validateQuery(query({ dimensions: dims }))).toBe('TOO_MANY_DIMENSIONS')
  })
})

// ─── Dựng payload: Id của AWS tách khỏi key của người gọi ───────────────────

describe('buildMetricDataQueries', () => {
  it('dùng Id đánh theo vị trí, KHÔNG dùng key (key có thể chứa `.`/`:` AWS từ chối)', () => {
    const built = buildMetricDataQueries([
      query({ key: 'ec2.cpu:avg' }),
      query({ key: 'other', metricName: 'NetworkIn' }),
    ])
    expect(built.map((q) => q.Id)).toEqual([awsQueryId(0), awsQueryId(1)])
    expect(built[0]?.MetricStat.Metric.MetricName).toBe('CPUUtilization')
  })

  it('bỏ hẳn khoá Dimensions khi rỗng, giữ đúng thứ tự dimension khi có', () => {
    const noDims = buildMetricDataQueries([query({ dimensions: [] })])
    expect('Dimensions' in (noDims[0]?.MetricStat.Metric ?? {})).toBe(false)

    const withDims = buildMetricDataQueries([
      query({
        dimensions: [
          { name: 'InstanceId', value: 'i-1' },
          { name: 'AutoScalingGroupName', value: 'asg-1' },
        ],
      }),
    ])
    expect(withDims[0]?.MetricStat.Metric.Dimensions).toEqual([
      { Name: 'InstanceId', Value: 'i-1' },
      { Name: 'AutoScalingGroupName', Value: 'asg-1' },
    ])
  })
})

describe('chunkQueries', () => {
  it('giữ nguyên thứ tự và độ dài lô', () => {
    expect(chunkQueries([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
  it('kẹp size ≤ 0 về 1 thay vì ném', () => {
    expect(chunkQueries([1, 2], 0)).toEqual([[1], [2]])
    expect(chunkQueries([1, 2], -3)).toEqual([[1], [2]])
  })
  it('mảng rỗng ⇒ không lô nào', () => {
    expect(chunkQueries([], 12)).toEqual([])
  })
})

// ─── Bóc kết quả ────────────────────────────────────────────────────────────

describe('parseMetricData', () => {
  const idMap = new Map([
    ['m0', 'a'],
    ['m1', 'b'],
  ])

  it('đọc được tên trường HOA chữ đầu của giao thức query', () => {
    const parsed = parseMetricData(
      JSON.stringify(
        cwResponse([
          {
            Id: 'm0',
            Label: 'CPU',
            Timestamps: ['2026-01-01T00:01:00Z', '2026-01-01T00:00:00Z'],
            Values: [2, 1],
          },
        ]),
      ),
      idMap,
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value[0]?.key).toBe('a')
    expect(parsed.value[0]?.label).toBe('CPU')
    // Sắp theo thời gian, không theo thứ tự AWS trả.
    expect(parsed.value[0]?.points.map((p) => p.v)).toEqual([1, 2])
    expect(parsed.value[0]?.full).toBe(true)
  })

  it('BỎ điểm null/NaN chứ không biến chúng thành 0', () => {
    const parsed = parseMetricData(
      JSON.stringify(
        cwResponse([
          {
            Id: 'm0',
            Timestamps: ['2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', '2026-01-01T00:02:00Z'],
            Values: [1, null, 3],
          },
        ]),
      ),
      idMap,
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value[0]?.points).toEqual([
      { t: Date.parse('2026-01-01T00:00:00Z'), v: 1 },
      { t: Date.parse('2026-01-01T00:02:00Z'), v: 3 },
    ])
  })

  it('`PartialData` ⇒ full = false (UI phải nói ra, không vẽ im)', () => {
    const parsed = parseMetricData(
      JSON.stringify(
        cwResponse([
          {
            Id: 'm0',
            Timestamps: ['2026-01-01T00:00:00Z'],
            Values: [1],
            StatusCode: 'PartialData',
          },
        ]),
      ),
      idMap,
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value[0]?.full).toBe(false)
  })

  it('Id lạ bị BỎ, không đoán — gán nhầm là vẽ số của metric khác', () => {
    const parsed = parseMetricData(
      JSON.stringify(cwResponse([{ Id: 'm9', Timestamps: [], Values: [] }])),
      idMap,
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value).toEqual([])
  })

  it('JSON hỏng ⇒ BAD_OUTPUT chứ không ném', () => {
    expect(parseMetricData('not json', idMap)).toEqual({ ok: false, error: 'BAD_OUTPUT' })
  })
})

// ─── Cache ──────────────────────────────────────────────────────────────────

describe('metricCacheKey', () => {
  const scope = { profile: 'p1', region: 'ap-southeast-1' }

  it('ổn định trước thứ tự dimension (đổi thứ tự không tạo entry thứ hai)', () => {
    const a = metricCacheKey(scope, 1, 2, query({
      dimensions: [
        { name: 'InstanceId', value: 'i-1' },
        { name: 'Env', value: 'prod' },
      ],
    }))
    const b = metricCacheKey(scope, 1, 2, query({
      dimensions: [
        { name: 'Env', value: 'prod' },
        { name: 'InstanceId', value: 'i-1' },
      ],
    }))
    expect(a).toBe(b)
  })

  it.each([
    ['profile', { ...scope, profile: 'p2' }],
    ['region', { ...scope, region: 'us-east-1' }],
  ])('đổi %s ⇒ khoá khác', (_label, other) => {
    expect(metricCacheKey(scope, 1, 2, query())).not.toBe(metricCacheKey(other, 1, 2, query()))
  })

  it('cửa sổ nằm TRONG khoá (cùng độ dài, khác vị trí ⇒ khác khoá)', () => {
    const oneHour = 3600_000
    expect(metricCacheKey(scope, 0, oneHour, query())).not.toBe(
      metricCacheKey(scope, oneHour, 2 * oneHour, query()),
    )
  })

  it('đổi stat/period/unit ⇒ khoá khác', () => {
    const base = metricCacheKey(scope, 1, 2, query())
    expect(metricCacheKey(scope, 1, 2, query({ stat: 'Sum' }))).not.toBe(base)
    expect(metricCacheKey(scope, 1, 2, query({ periodSeconds: 60 }))).not.toBe(base)
    expect(metricCacheKey(scope, 1, 2, query({ unit: 'Percent' }))).not.toBe(base)
  })
})

// ─── Nạp: chia lô, cache, không tự làm mới ──────────────────────────────────

describe('getMetricData', () => {
  it('nhiều metric ⇒ số lời gọi CLI theo LÔ, không theo metric', async () => {
    const many = Array.from({ length: MAX_METRICS_PER_CALL + 2 }, (_, i) =>
      query({ key: `k${String(i)}`, metricName: `M${String(i)}` }),
    )
    runInfra.mockImplementation((call: { args: string[] }) => {
      const payload = JSON.parse(
        call.args.find((a) => a.startsWith('--metric-data-queries='))?.split('=').slice(1).join('=') ??
          '[]',
      ) as { Id: string }[]
      return Promise.resolve(
        ok(
          cwResponse(
            payload.map((q) => ({
              Id: q.Id,
              Timestamps: ['2026-01-01T00:00:00Z'],
              Values: [1],
            })),
          ),
        ),
      )
    })

    const res = await fetch({ queries: many })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(runInfra).toHaveBeenCalledTimes(2)
    expect(res.value.calls).toBe(2)
    expect(res.value.series).toHaveLength(many.length)
    // Thứ tự trả về = thứ tự người gọi đưa vào.
    expect(res.value.series.map((s) => s.key)).toEqual(many.map((q) => q.key))
  })

  it('lượt hai cùng cửa sổ KHÔNG spawn CLI; `force` mới đi lại', async () => {
    runInfra.mockResolvedValue(
      ok(cwResponse([{ Id: 'm0', Timestamps: ['2026-01-01T00:00:00Z'], Values: [42] }])),
    )

    const first = await fetch()
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.fromCache).toBe(0)
    expect(first.value.calls).toBe(1)
    expect(metricCacheSize()).toBe(1)

    runInfra.mockClear()
    const second = await fetch()
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(runInfra).not.toHaveBeenCalled()
    expect(second.value.calls).toBe(0)
    expect(second.value.fromCache).toBe(1)
    expect(second.value.series[0]?.points).toEqual([
      { t: Date.parse('2026-01-01T00:00:00Z'), v: 42 },
    ])

    const forced = await fetch({ force: true })
    expect(forced.ok).toBe(true)
    expect(runInfra).toHaveBeenCalledTimes(1)
  })

  it('cửa sổ khác ⇒ cache riêng (không dùng số của khoảng này cho khoảng kia)', async () => {
    runInfra.mockResolvedValue(ok(cwResponse([{ Id: 'm0', Timestamps: [], Values: [] }])))
    await fetch()
    runInfra.mockClear()
    const other = await fetch({ startMs: START_MS - 3600_000 })
    expect(other.ok).toBe(true)
    if (!other.ok) return
    expect(runInfra).toHaveBeenCalledTimes(1)
    expect(other.value.fromCache).toBe(0)
    expect(metricCacheSize()).toBe(2)
  })

  it('metric KHÔNG có điểm nào vẫn trả về một series rỗng (đó là "thiếu dữ liệu")', async () => {
    runInfra.mockResolvedValue(ok(cwResponse([])))
    const res = await fetch()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.series).toHaveLength(1)
    expect(res.value.series[0]?.points).toEqual([])
  })

  it('cửa sổ hỏng / quá dài bị chặn TRƯỚC khi spawn', async () => {
    const tooLong = await getMetricData({
      queries: [query()],
      startMs: NOW - 40 * 24 * 3600_000,
      endMs: NOW,
      surface: 'explorer',
    })
    expect(tooLong).toEqual({ ok: false, error: 'WINDOW_TOO_LONG' })

    const reversed = await getMetricData({
      queries: [query()],
      startMs: END_MS,
      endMs: START_MS,
      surface: 'explorer',
    })
    expect(reversed).toEqual({ ok: false, error: 'INVALID_WINDOW' })
    expect(runInfra).not.toHaveBeenCalled()
  })

  it('một query hỏng làm hỏng CẢ lượt (không vẽ thiếu metric trong im lặng)', async () => {
    const res = await fetch({ queries: [query(), query({ key: 'k2', stat: 'avg' })] })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBe('BAD_STAT')
    expect(runInfra).not.toHaveBeenCalled()
  })

  it('vượt trần số series bị chặn ở biên', async () => {
    const tooMany = Array.from({ length: 25 }, (_, i) => query({ key: `k${String(i)}` }))
    const res = await fetch({ queries: tooMany })
    expect(res).toEqual({ ok: false, error: 'TOO_MANY_SERIES' })
    expect(runInfra).not.toHaveBeenCalled()
  })

  it('lỗi CLI trả về nguyên văn (đã cắt) chứ không ném', async () => {
    runInfra.mockResolvedValue(fail('An error occurred (AccessDenied) when calling GetMetricData'))
    const res = await fetch()
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('AccessDenied')
  })

  it('gửi cửa sổ bằng epoch GIÂY và mang đúng payload JSON của lô', async () => {
    runInfra.mockResolvedValue(ok(cwResponse([])))
    await fetch()
    const start = flagSent(0, '--start-time')
    const end = flagSent(0, '--end-time')
    expect(Number(start)).toBe(Math.floor(START_MS / 1000))
    expect(Number(end)).toBe(Math.floor(END_MS / 1000))
    const payload = JSON.parse(flagSent(0, '--metric-data-queries') ?? '[]') as {
      MetricStat: { Metric: { Namespace: string } }
    }[]
    expect(payload[0]?.MetricStat.Metric.Namespace).toBe('AWS/EC2')
  })
})
