// Mốc 2 — CloudWatch Logs (2.1 · 2.6 · 2.9).
//
// Thứ đáng đo ở đây không phải "AWS trả gì" (đó là việc của AWS) mà là những luật
// AWOG tự đặt quanh một bề mặt VỪA TỐN TIỀN VỪA CHỨA PII:
//   · ước lượng phải chạy TRƯỚC khi tiêu tiền, và phải nói rõ cơ sở của nó;
//   · `bytesScanned` của một lần chạy BỊ HUỶ không được dạy app rằng câu đó rẻ;
//   · cửa sổ thời gian / câu lệnh / tên group xấu phải bị chặn TRƯỚC khi spawn;
//   · vòng poll không được ghi nhật ký, nhưng lệnh tốn tiền thì phải ghi.
//
// `runInfra` bị mock — không ca nào spawn `aws` thật.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { runInfra } = vi.hoisted(() => ({ runInfra: vi.fn() }))
vi.mock('../../run.js', () => ({ runInfra }))

import {
  checkLogGroups,
  checkQueryString,
  checkWindow,
  estimateScan,
  flagValue,
  insightsCostUsd,
  INSIGHTS_USD_PER_GB,
  isValidLogGroup,
  isValidQueryId,
  listLogGroups,
  startInsightsQuery,
  getInsightsResults,
  tailWindow,
} from '../logs.js'

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

/** `n` group giả, tên tăng dần — để test phân trang kiểm được cả thứ tự sắp xếp. */
function manyGroups(n: number, from: number) {
  return Array.from({ length: n }, (_, i) => ({
    logGroupName: `/aws/lambda/g${String(from + i).padStart(3, '0')}`,
    storedBytes: 1,
  }))
}

function flagSent(call: { args: string[] }, flag: string): string | null {
  const prefix = `${flag}=`
  return call.args.find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? null
}

/** Giá trị `--limit` của từng lượt gọi CLI, theo thứ tự. */
function limitsSent(): string[] {
  return runInfra.mock.calls.map((call) => flagSent(call[0] as { args: string[] }, '--limit') ?? '')
}

/** `--next-token` của từng lượt gọi CLI (`null` = không gửi cờ). */
function nextTokensSent(): (string | null)[] {
  return runInfra.mock.calls.map((call) => flagSent(call[0] as { args: string[] }, '--next-token'))
}

beforeEach(() => {
  runInfra.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('kiểm tra đầu vào (thuần)', () => {
  it('nhận tên log group hợp lệ và từ chối phần còn lại', () => {
    expect(isValidLogGroup('/aws/lambda/my-fn')).toBe(true)
    expect(isValidLogGroup('my.app_1#x')).toBe(true)
    expect(isValidLogGroup('')).toBe(false)
    expect(isValidLogGroup('has space')).toBe(false)
    expect(isValidLogGroup('has$(cmd)')).toBe(false)
    expect(isValidLogGroup('a'.repeat(513))).toBe(false)
  })

  it('queryId chỉ nhận dạng AWS sinh ra', () => {
    expect(isValidQueryId('6f5d3c1a-1111-2222-3333-444455556666')).toBe(true)
    expect(isValidQueryId('../etc/passwd')).toBe(false)
    expect(isValidQueryId('')).toBe(false)
  })

  it('cửa sổ thời gian: đảo ngược · quá dài · ở tương lai đều bị chặn', () => {
    const now = Date.parse('2026-09-13T10:00:00Z')
    expect(checkWindow(now - 3_600_000, now, now).ok).toBe(true)
    expect(checkWindow(now, now - 1000, now)).toEqual({ ok: false, error: 'INVALID_WINDOW' })
    expect(checkWindow(now - 31 * 24 * 3600_000, now, now)).toEqual({
      ok: false,
      error: 'WINDOW_TOO_LONG',
    })
    expect(checkWindow(now + 3600_000, now + 7200_000, now)).toEqual({
      ok: false,
      error: 'WINDOW_IN_FUTURE',
    })
  })

  // ⚠ LỖI CÓ THẬT, ship 2026-09-16, người dùng báo 2026-09-17: màn "Dòng mới nhất"
  // luôn trả 0 dòng dù CloudWatch có log. `checkWindow` chỉ trả GIÂY (đúng cho
  // `start-query` của Insights) nhưng `tailWindow` dùng thẳng cho
  // `filter-log-events`, mà API đó đo bằng MILI-GIÂY — tài liệu của chính AWS CLI
  // ghi `(long) ... milliseconds`. Cửa sổ "1 giờ gần đây" vì thế biến thành
  // 21-01-1970, hợp lệ nhưng rỗng, và không có lỗi nào hiện ra.
  it('trả CẢ HAI đơn vị, và giây đúng bằng 1/1000 mili-giây', () => {
    const now = Date.parse('2026-09-17T08:00:00Z')
    const got = checkWindow(now - 3_600_000, now, now)
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.startMs).toBe(now - 3_600_000)
    expect(got.endMs).toBe(now)
    expect(got.startSec).toBe(Math.floor((now - 3_600_000) / 1000))
    expect(got.endSec).toBe(Math.floor(now / 1000))
    // Nhầm đơn vị ⇒ lệch 1000 lần, tức rơi về 1970 — đây là con số biến lỗi này
    // thành "im lặng không có dòng nào" thay vì một thông báo lỗi.
    expect(new Date(got.startSec).getUTCFullYear()).toBe(1970)
    expect(new Date(got.startMs).getUTCFullYear()).toBe(2026)
  })

  it('câu lệnh: rỗng · quá dài · chứa file:// đều bị chặn', () => {
    expect(checkQueryString('fields @timestamp | limit 1').ok).toBe(true)
    expect(checkQueryString('   ')).toEqual({ ok: false, error: 'EMPTY_QUERY' })
    expect(checkQueryString('x'.repeat(5000)).ok).toBe(false)
    // `file://` biến tham số thành đường đọc file tuỳ ý (invariant #1/#2).
    expect(checkQueryString('fields @message | filter @message like /file:\/\//')).toEqual({
      ok: false,
      error: 'QUERY_NOT_ALLOWED',
    })
  })

  it('danh sách log group: rỗng · quá trần · tên bẩn', () => {
    expect(checkLogGroups(['/aws/lambda/a']).ok).toBe(true)
    expect(checkLogGroups([])).toEqual({ ok: false, error: 'NO_LOG_GROUP' })
    expect(checkLogGroups(Array.from({ length: 26 }, (_, i) => `g${String(i)}`))).toEqual({
      ok: false,
      error: 'TOO_MANY_LOG_GROUPS',
    })
    expect(checkLogGroups(['bad name'])).toEqual({ ok: false, error: 'INVALID_LOG_GROUP' })
  })

  it('cờ mang giá trị dùng dạng `--cờ=giá trị` để giá trị không bao giờ thành cờ', () => {
    expect(flagValue('--filter-pattern', '-"INFO"')).toBe('--filter-pattern=-"INFO"')
  })
})

describe('chi phí', () => {
  it('quy đổi GB quét theo đơn giá CloudWatch và làm tròn 4 chữ số', () => {
    expect(insightsCostUsd(0)).toBe(0)
    expect(insightsCostUsd(1024 ** 3)).toBe(INSIGHTS_USD_PER_GB)
    expect(insightsCostUsd(1024 ** 3 * 2.5)).toBe(0.0125)
  })
})

describe('listLogGroups', () => {
  it('nối trang, lọc pattern phía AWOG, sắp xếp theo tên', async () => {
    runInfra.mockResolvedValueOnce(
      ok({
        logGroups: [
          { logGroupName: '/aws/lambda/beta', storedBytes: 10 },
          { logGroupName: '/aws/lambda/alpha', storedBytes: 20, retentionInDays: 7 },
          { logGroupName: '/other/thing', storedBytes: 1 },
        ],
        nextToken: 'tok',
      }),
    )
    runInfra.mockResolvedValueOnce(ok({ logGroups: [{ logGroupName: '/aws/lambda/gamma' }] }))

    const result = await listLogGroups({ surface: 'logs', pattern: 'LAMBDA' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.groups.map((g) => g.name)).toEqual([
      '/aws/lambda/alpha',
      '/aws/lambda/beta',
      '/aws/lambda/gamma',
    ])
    expect(result.value.groups[0]?.retentionDays).toBe(7)
    expect(result.value.nextToken).toBe(null)
  })

  it('exit code khác 0 là KẾT QUẢ hợp lệ (có câu lỗi của AWS), không phải crash', async () => {
    runInfra.mockResolvedValue(fail('An error occurred (AccessDeniedException)'))
    const result = await listLogGroups({ surface: 'logs' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('AccessDeniedException')
  })

  // Lỗi thật đã gặp: `--limit 100` của màn Logs ⇒ AWS trả
  // `InvalidParameterException … Member must have value less than or equal to 50`.
  // Trần 50 là của TỪNG LƯỢT GỌI, không phải của cả lần nạp danh sách — nên nó
  // phải được trải qua nhiều trang, và không lượt nào được vượt 50.
  it('chia trang: mỗi lượt `--limit` ≤ 50, nối tiếp bằng nextToken tới đủ limit', async () => {
    runInfra
      .mockResolvedValueOnce(ok({ logGroups: manyGroups(50, 0), nextToken: 'tok' }))
      .mockResolvedValueOnce(ok({ logGroups: manyGroups(50, 50) }))

    const result = await listLogGroups({ surface: 'logs', limit: 100 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.groups).toHaveLength(100)
    expect(result.value.groups[0]?.name).toBe('/aws/lambda/g000')
    // Trang cuối đã hết token ⇒ UI biết danh sách này là đủ, không phải bị cắt.
    expect(result.value.nextToken).toBe(null)
    expect(limitsSent()).toEqual(['50', '50'])
    expect(nextTokensSent()).toEqual([null, 'tok'])
  })

  it('limit bị kẹp xuống trần TỔNG, và mọi lượt gọi vẫn ≤ 50', async () => {
    // Mỗi trang luôn còn token: vòng lặp chỉ dừng được nhờ trần số lượt gọi.
    runInfra.mockResolvedValue(ok({ logGroups: manyGroups(50, 0), nextToken: 'tok' }))

    const result = await listLogGroups({ surface: 'logs', limit: 99_999 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(runInfra).toHaveBeenCalledTimes(10)
    expect(Math.max(...limitsSent().map(Number))).toBe(50)
    expect(result.value.nextToken).toBe('tok')
  })

  it('trang cụt (AWS hết group) thì dừng ngay, không gọi lượt thừa', async () => {
    runInfra.mockResolvedValueOnce(ok({ logGroups: manyGroups(3, 0) }))

    const result = await listLogGroups({ surface: 'logs', limit: 100 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.groups).toHaveLength(3)
    expect(runInfra).toHaveBeenCalledTimes(1)
  })

  it('một trang lỗi giữa chừng làm hỏng CẢ lời gọi — không trả danh sách cụt', async () => {
    runInfra
      .mockResolvedValueOnce(ok({ logGroups: manyGroups(50, 0), nextToken: 'tok' }))
      .mockResolvedValueOnce(fail('An error occurred (ThrottlingException)'))

    const result = await listLogGroups({ surface: 'logs', limit: 100 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('ThrottlingException')
  })
})

describe('estimateScan — ước lượng TRƯỚC khi tiêu tiền (2.6)', () => {
  it('có số đo lịch sử thì dùng số ĐO, không gọi describe-log-groups', async () => {
    const result = await estimateScan({
      logGroups: ['/aws/lambda/a'],
      historyBytes: 1024 ** 3,
      surface: 'logs',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.basis).toBe('history')
    expect(result.value.usd).toBe(INSIGHTS_USD_PER_GB)
    expect(runInfra).not.toHaveBeenCalled()
  })

  it('chưa có lịch sử thì cộng storedBytes — một TRẦN TRÊN, và nói rõ là trần trên', async () => {
    runInfra.mockResolvedValue(
      ok({ logGroups: [{ logGroupName: '/aws/lambda/a', storedBytes: 1024 ** 3 }] }),
    )
    const result = await estimateScan({ logGroups: ['/aws/lambda/a'], surface: 'logs' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.basis).toBe('stored')
    expect(result.value.bytes).toBe(1024 ** 3)
    expect(result.value.usd).toBe(INSIGHTS_USD_PER_GB)
  })
})

describe('startInsightsQuery', () => {
  it('gửi cờ dạng `=` cho mọi giá trị, và ghi chi phí ước lượng vào nhật ký', async () => {
    runInfra.mockResolvedValue(ok({ queryId: 'abc-123' }))
    const now = Date.now()
    const result = await startInsightsQuery({
      logGroups: ['/aws/lambda/a', '/aws/lambda/b'],
      query: 'fields @timestamp | limit 10',
      startMs: now - 60_000,
      endMs: now,
      estimatedUsd: 0.25,
      surface: 'logs',
    })
    expect(result.ok).toBe(true)
    const call = runInfra.mock.calls[0]?.[0] as { args: string[]; cost?: { estimatedUsd?: number } }
    expect(call.args).toContain('--log-group-names=/aws/lambda/a')
    expect(call.args).toContain('--log-group-names=/aws/lambda/b')
    expect(call.args.some((a: string) => a.startsWith('--query-string='))).toBe(true)
    expect(call.cost?.estimatedUsd).toBe(0.25)
  })

  it('câu lệnh hoặc cửa sổ xấu bị chặn TRƯỚC khi spawn', async () => {
    const now = Date.now()
    const bad = await startInsightsQuery({
      logGroups: ['/aws/lambda/a'],
      query: '   ',
      startMs: now - 60_000,
      endMs: now,
      surface: 'logs',
    })
    expect(bad).toEqual({ ok: false, error: 'EMPTY_QUERY' })
    expect(runInfra).not.toHaveBeenCalled()
  })
})

describe('getInsightsResults', () => {
  it('KHÔNG ghi nhật ký cho vòng poll (audit:false) — poll do app sinh, không phải người bấm', async () => {
    runInfra.mockResolvedValue(
      ok({
        status: 'Complete',
        results: [
          [
            { field: '@timestamp', value: '2026-09-13 10:00:00.000' },
            { field: '@message', value: 'hello' },
          ],
        ],
        statistics: { bytesScanned: 2048, recordsMatched: 1, recordsScanned: 5 },
      }),
    )
    const result = await getInsightsResults({ queryId: 'abc-123', surface: 'logs' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('Complete')
    expect(result.value.rows[0]?.['@message']).toBe('hello')
    expect(result.value.bytesScanned).toBe(2048)
    const call = runInfra.mock.calls[0]?.[0] as { audit?: boolean }
    expect(call.audit).toBe(false)
  })

  it('trạng thái lạ ⇒ `Unknown`, KHÔNG suy diễn thành Complete', async () => {
    runInfra.mockResolvedValue(ok({ status: 'SomethingNew', results: [] }))
    const result = await getInsightsResults({ queryId: 'abc-123', surface: 'logs' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('Unknown')
  })

  it('queryId không hợp lệ bị chặn trước khi spawn', async () => {
    const result = await getInsightsResults({ queryId: '../etc/passwd', surface: 'logs' })
    expect(result).toEqual({ ok: false, error: 'INVALID_QUERY_ID' })
    expect(runInfra).not.toHaveBeenCalled()
  })
})

describe('tailWindow (2.9)', () => {
  it('không truyền --filter-pattern khi pattern rỗng, và báo truncated khi CLI còn nextToken', async () => {
    runInfra.mockResolvedValue(
      ok({
        events: [{ logStreamName: 's1', timestamp: 1_700_000_000_000, message: 'line' }],
        nextToken: 'more',
      }),
    )
    const now = Date.now()
    const result = await tailWindow({
      logGroups: ['/aws/lambda/a'],
      startMs: now - 60_000,
      endMs: now,
      filterPattern: '   ',
      surface: 'logs',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.events).toHaveLength(1)
    expect(result.value.truncated).toBe(true)
    const call = runInfra.mock.calls[0]?.[0] as { args: string[] }
    expect(call.args.some((a: string) => a.startsWith('--filter-pattern'))).toBe(false)
    // `nextToken` phải đi RA, không chỉ gập thành một cờ boolean: đó là thứ duy nhất
    // đọc tiếp được.
    expect(result.value.nextToken).toBe('more')
  })

  // Màn này tên là "Dòng mới nhất". Mặc định của CloudWatch là `startFromHead = true`
  // (cũ trước), nên thiếu cờ này thì 200 dòng nhận được là 200 dòng CŨ NHẤT của cửa
  // sổ — và UI sắp giảm dần bên trong đúng 200 dòng sai đó, nên trông vẫn "hợp lý".
  it('xin dòng MỚI NHẤT trước, không phải đầu cửa sổ', async () => {
    runInfra.mockResolvedValue(ok({ events: [] }))
    const now = Date.now()
    await tailWindow({
      logGroups: ['/aws/lambda/a'],
      startMs: now - 3_600_000,
      endMs: now,
      surface: 'logs',
    })
    const call = runInfra.mock.calls[0]?.[0] as { args: string[] }
    expect(call.args).toContain('--no-start-from-head')
  })

  // CloudWatch: "Setting startFromHead to false is supported only when startTime is
  // on or after Jan 1, 2024 00:00:00 UTC" — sớm hơn thì nó ném InvalidParameterException.
  // Khoảng Tuỳ chọn cho người dùng chọn ngày bất kỳ, nên mốc này phải được KIỂM.
  it('bỏ cờ mới-nhất-trước khi cửa sổ bắt đầu trước 2024', async () => {
    runInfra.mockResolvedValue(ok({ events: [] }))
    await tailWindow({
      logGroups: ['/aws/lambda/a'],
      startMs: Date.UTC(2023, 11, 31),
      endMs: Date.UTC(2023, 11, 31) + 3_600_000,
      surface: 'logs',
    })
    const call = runInfra.mock.calls[0]?.[0] as { args: string[] }
    expect(call.args).not.toContain('--no-start-from-head')
  })

  it('đọc tiếp bằng --next-token, và KHÔNG gửi kèm cờ hướng', async () => {
    runInfra.mockResolvedValue(ok({ events: [] }))
    const now = Date.now()
    await tailWindow({
      logGroups: ['/aws/lambda/a'],
      startMs: now - 60_000,
      endMs: now,
      nextToken: 'Bxxx-1_abc=',
      surface: 'logs',
    })
    const call = runInfra.mock.calls[0]?.[0] as { args: string[] }
    expect(call.args).toContain('--next-token=Bxxx-1_abc=')
    // `--starting-token` sẽ bị CLI từ chối khi đã có `--limit` (nó tự bật
    // `--no-paginate`), và hướng sắp xếp ở lượt sau do chính token quyết định.
    expect(call.args.some((a: string) => a.startsWith('--starting-token'))).toBe(false)
    expect(call.args).not.toContain('--no-start-from-head')
  })

  it('từ chối nextToken có ký tự ngoài bộ base64url (đầu vào L1 đi vòng qua UI)', async () => {
    runInfra.mockClear()
    const now = Date.now()
    const result = await tailWindow({
      logGroups: ['/aws/lambda/a'],
      startMs: now - 60_000,
      endMs: now,
      nextToken: 'abc; rm -rf /',
      surface: 'logs',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('INVALID_NEXT_TOKEN')
    // Chặn TRƯỚC khi spawn, không phải để AWS từ chối hộ.
    expect(runInfra).not.toHaveBeenCalled()
  })
})
