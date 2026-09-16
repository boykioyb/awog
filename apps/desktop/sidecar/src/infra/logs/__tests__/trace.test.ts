// L5 — lần theo một request.
//
// Thứ đáng đo ở đây KHÔNG phải "có gọi CLI không" (`runInfra` đã có test riêng) mà
// là bốn luật quyết định dòng thời gian đúng hay sai:
//   (a) id nào đi nhánh nào, và id rác bị chặn TRƯỚC khi thành argv;
//   (b) `@timestamp` của Insights là UTC không hậu tố — đọc sai là cả timeline lệch
//       đúng bằng offset máy, mà lệch đều thì nhìn vẫn "hợp lý";
//   (c) gộp theo log group (một request quay lại cùng hàm = MỘT chặng, count 2);
//   (d) segment X-Ray cho timing THẬT, còn nhánh log thì không được giả vờ có.
import { describe, expect, it } from 'vitest'

import {
  buildTraceQuery,
  classifyTraceId,
  hopsFromRows,
  hopsFromXrayJson,
  logGroupOfRow,
  messageLooksFailed,
  parseInsightsTime,
  serviceOfLogGroup,
  serviceOfXraySegment,
  traceOf,
  TRACE_ROWS_PER_HOP,
} from '../trace.js'

describe('classifyTraceId', () => {
  it('nhận đúng X-Ray trace id', () => {
    const got = classifyTraceId('1-5f84c7a1-1a2b3c4d5e6f708192a3b4c5')
    expect(got).toEqual({ ok: true, kind: 'xray', id: '1-5f84c7a1-1a2b3c4d5e6f708192a3b4c5' })
  })

  it('nhận UUID là request id', () => {
    const got = classifyTraceId('7C1B4B4E-9F2A-4E62-8D0B-1A2B3C4D5E6F')
    expect(got.ok && got.kind).toBe('request')
  })

  it('id tự đặt vẫn dùng được (nhánh log)', () => {
    const got = classifyTraceId('order-2026-09-16.42')
    expect(got.ok && got.kind).toBe('free')
  })

  it('cắt khoảng trắng thừa hai đầu', () => {
    const got = classifyTraceId('  abc123  ')
    expect(got.ok && got.id).toBe('abc123')
  })

  it.each([
    ['rỗng', '   ', 'EMPTY_TRACE_ID'],
    ['có dấu nháy kép', 'a"b', 'INVALID_TRACE_ID'],
    ['có khoảng trắng giữa', 'a b', 'INVALID_TRACE_ID'],
    // ⚠ Ca quan trọng nhất: `/` bị cấm nên `file://` không bao giờ thành argv.
    ['là đường file://', 'file:///etc/passwd', 'INVALID_TRACE_ID'],
    ['có gạch chéo', 'a/b', 'INVALID_TRACE_ID'],
    ['có xuống dòng', 'a\nb', 'INVALID_TRACE_ID'],
  ])('từ chối id %s', (_name, raw, error) => {
    expect(classifyTraceId(raw)).toEqual({ ok: false, error })
  })

  it('từ chối id quá dài', () => {
    expect(classifyTraceId('a'.repeat(201))).toEqual({ ok: false, error: 'TRACE_ID_TOO_LONG' })
  })
})

describe('buildTraceQuery', () => {
  it('so khớp CHUỖI CON (nháy kép), không phải regex', () => {
    const q = buildTraceQuery('req.1+2')
    expect(q).toContain('filter @message like "req.1+2"')
    expect(q).not.toContain('like /')
  })

  it('luôn mang @log — nếu không thì không biết dòng thuộc nhóm nào', () => {
    expect(buildTraceQuery('abc')).toContain('@log')
  })

  it('kẹp limit vào trần', () => {
    expect(buildTraceQuery('abc', 99_999)).toContain('limit 200')
    expect(buildTraceQuery('abc', 10)).toContain('limit 10')
  })
})

describe('parseInsightsTime', () => {
  it('đọc dạng của Insights là UTC, không phải giờ máy', () => {
    expect(parseInsightsTime('2026-09-16 10:00:00.123')).toBe(Date.UTC(2026, 8, 16, 10, 0, 0, 123))
  })

  it('đọc được epoch mili-giây và epoch giây', () => {
    expect(parseInsightsTime('1789560000000')).toBe(1_789_560_000_000)
    expect(parseInsightsTime('1789560000')).toBe(1_789_560_000_000)
  })

  it('trả null thay vì NaN khi không đọc được', () => {
    expect(parseInsightsTime('không phải thời gian')).toBeNull()
    expect(parseInsightsTime(undefined)).toBeNull()
  })
})

describe('logGroupOfRow + serviceOfLogGroup', () => {
  it('cắt accountId khỏi @log', () => {
    expect(logGroupOfRow({ '@log': '123456789012:/aws/lambda/checkout' })).toBe(
      '/aws/lambda/checkout',
    )
  })

  it('không có @log thì nói null, không đoán', () => {
    expect(logGroupOfRow({ '@message': 'x' })).toBeNull()
  })

  it.each([
    ['/aws/lambda/checkout', 'lambda'],
    ['API-Gateway-Execution-Logs_ab12cd/prod', 'apigateway'],
    ['/ecs/web', 'ecs'],
    ['/aws/eks/cluster/cluster', 'eks'],
    ['/tự/đặt/tên', 'logs'],
  ])('%s → %s', (group, service) => {
    expect(serviceOfLogGroup(group)).toBe(service)
  })
})

describe('messageLooksFailed', () => {
  it.each([
    'ERROR request failed',
    'Task timed out after 3.00 seconds',
    '{"level":"error","msg":"boom"}',
    '{"statusCode":502}',
    '{"statusCode": "503"}',
    'status=500 upstream gone',
    'http_status: 504',
    '10.0.0.1 - - "GET /orders HTTP/1.1" 502 120',
  ])('bắt lỗi trong %s', (msg) => {
    expect(messageLooksFailed(msg)).toBe(true)
  })

  // ⚠ Bốn ca ĐẦU là lỗi thật đã có trong bản ship 2026-09-16: vị từ cũ hỏi hai câu
  // RỜI NHAU ("có 5xx đứng riêng" VÀ "có chữ status/code ở đâu đó"), nên một dòng
  // log JSON khoẻ mạnh có `statusCode: 200` cạnh bất kỳ con số 5xx nào (latency,
  // byte, số dòng) đều bị tô đỏ — và node tương ứng trên sơ đồ đỏ theo.
  it.each([
    '{"statusCode":200,"latencyMs":512}',
    '{"statusCode":200,"durationMs":530}',
    '{"status":"ok","bytes":599}',
    'request_code=abc took 599 ms',
    'INFO handled ok',
    // Số 5xx nằm trong một con số dài hơn KHÔNG phải mã trạng thái.
    'processed 15002 items',
    // Không có khoá trạng thái nào thì một con số 5xx lẻ loi cũng không đủ.
    'took 502 ms',
  ])('không tô đỏ nhầm %s', (msg) => {
    expect(messageLooksFailed(msg)).toBe(false)
  })
})

describe('hopsFromRows', () => {
  const row = (group: string, time: string, message: string) => ({
    '@log': `123456789012:${group}`,
    '@timestamp': time,
    '@message': message,
  })

  it('gộp theo log group và xếp theo mốc thấy lần đầu', () => {
    const hops = hopsFromRows([
      row('API-Gateway-Execution-Logs_ab12cd/prod', '2026-09-16 10:00:00.000', 'start'),
      row('/aws/lambda/checkout', '2026-09-16 10:00:00.250', 'begin'),
      row('/aws/lambda/checkout', '2026-09-16 10:00:00.900', 'done'),
    ])
    expect(hops.map((h) => h.service)).toEqual(['apigateway', 'lambda'])
    expect(hops[1]?.count).toBe(2)
    expect(hops[1]?.firstAt).toBe(Date.UTC(2026, 8, 16, 10, 0, 0, 250))
    expect(hops[1]?.lastAt).toBe(Date.UTC(2026, 8, 16, 10, 0, 0, 900))
  })

  it('một request quay lại cùng hàm là MỘT chặng, không phải hai', () => {
    const hops = hopsFromRows([
      row('/aws/lambda/a', '2026-09-16 10:00:00.000', 'first'),
      row('/aws/lambda/b', '2026-09-16 10:00:01.000', 'middle'),
      row('/aws/lambda/a', '2026-09-16 10:00:02.000', 'again'),
    ])
    expect(hops).toHaveLength(2)
    expect(hops[0]?.count).toBe(2)
  })

  it('đo khoảng cách tới chặng sau, chặng cuối để null', () => {
    const hops = hopsFromRows([
      row('/aws/lambda/a', '2026-09-16 10:00:00.000', 'x'),
      row('/aws/lambda/b', '2026-09-16 10:00:00.400', 'y'),
    ])
    expect(hops[0]?.gapToNextMs).toBe(400)
    expect(hops[1]?.gapToNextMs).toBeNull()
  })

  // ⚠ Lỗi thật của bản ship 2026-09-16: khoảng cách đo từ mốc ĐẦU tới mốc đầu, mà
  // các lần ghé lại cùng một nhóm đã bị gộp làm MỘT chặng — một vòng retry 10 giây
  // vì thế báo "cách chặng sau 10 s" trong khi cú bàn giao thật mất 100 ms.
  it('khoảng cách đo từ dòng CUỐI của chặng, không phải dòng đầu', () => {
    const hops = hopsFromRows([
      row('/aws/lambda/a', '2026-09-16 10:00:00.000', 'thử lần 1'),
      row('/aws/lambda/a', '2026-09-16 10:00:10.000', 'thử lần 2'),
      row('/aws/lambda/b', '2026-09-16 10:00:10.100', 'nhận'),
    ])
    expect(hops[0]?.gapToNextMs).toBe(100)
  })

  it('hai chặng chồng lấn thì nói null, không trả số âm', () => {
    const hops = hopsFromRows([
      row('/aws/lambda/a', '2026-09-16 10:00:00.000', 'mở'),
      row('/aws/lambda/b', '2026-09-16 10:00:01.000', 'con chạy'),
      row('/aws/lambda/a', '2026-09-16 10:00:09.000', 'đóng'),
    ])
    // `a` kết thúc SAU khi `b` bắt đầu ⇒ không có khoảng cách nào để nói.
    expect(hops[0]?.gapToNextMs).toBeNull()
  })

  it('KHÔNG bịa độ trễ xử lý ở nhánh log', () => {
    const hops = hopsFromRows([row('/aws/lambda/a', '2026-09-16 10:00:00.000', 'x')])
    expect(hops[0]?.durationMs).toBeNull()
  })

  it('một dòng lỗi làm cả chặng thành lỗi', () => {
    const hops = hopsFromRows([
      row('/aws/lambda/a', '2026-09-16 10:00:00.000', 'INFO ok'),
      row('/aws/lambda/a', '2026-09-16 10:00:00.100', 'ERROR boom'),
    ])
    expect(hops[0]?.status).toBe('error')
  })

  it('giữ tối đa TRACE_ROWS_PER_HOP dòng nhưng vẫn đếm đủ', () => {
    const rows = Array.from({ length: TRACE_ROWS_PER_HOP + 5 }, (_, i) =>
      row('/aws/lambda/a', `2026-09-16 10:00:0${i % 10}.000`, `line ${i}`),
    )
    const hops = hopsFromRows(rows)
    expect(hops[0]?.rows).toHaveLength(TRACE_ROWS_PER_HOP)
    expect(hops[0]?.rowsTruncated).toBe(true)
    expect(hops[0]?.count).toBe(TRACE_ROWS_PER_HOP + 5)
  })

  it('dòng đầu không đọc được mốc thời gian không ghim chặng vào số 0', () => {
    const hops = hopsFromRows([
      { '@log': 'acc:/aws/lambda/a', '@message': 'không có timestamp' },
      row('/aws/lambda/a', '2026-09-16 10:00:05.000', 'có mốc'),
    ])
    expect(hops[0]?.firstAt).toBe(Date.UTC(2026, 8, 16, 10, 0, 5))
  })
})

describe('nhánh X-Ray', () => {
  const doc = (body: Record<string, unknown>) => JSON.stringify(body)

  const payload = (segments: string[]) =>
    JSON.stringify({
      Traces: [
        {
          Id: '1-5f84c7a1-1a2b3c4d5e6f708192a3b4c5',
          Segments: segments.map((Document, i) => ({ Id: `seg${i}`, Document })),
        },
      ],
      UnprocessedTraceIds: [],
    })

  it('dựng chặng có TIMING THẬT từ start_time/end_time', () => {
    const got = hopsFromXrayJson(
      payload([
        doc({
          id: 'a1',
          name: 'checkout',
          origin: 'AWS::Lambda::Function',
          start_time: 1_789_560_000.0,
          end_time: 1_789_560_000.25,
        }),
      ]),
    )
    expect(got?.hops).toHaveLength(1)
    expect(got?.hops[0]?.durationMs).toBe(250)
    expect(got?.hops[0]?.service).toBe('lambda')
    // Segment Lambda suy ra được log group theo khuôn cố định của AWS.
    expect(got?.hops[0]?.logGroup).toBe('/aws/lambda/checkout')
  })

  it('fault/error/throttle và 5xx đều là chặng hỏng', () => {
    const got = hopsFromXrayJson(
      payload([
        doc({ id: 'a', name: 'api', origin: 'AWS::ApiGateway::Stage', fault: true }),
        doc({
          id: 'b',
          name: 'svc',
          origin: 'AWS::ECS::Container',
          http: { response: { status: 503 } },
        }),
      ]),
    )
    expect(got?.hops.map((h) => h.status)).toEqual(['error', 'error'])
    expect(got?.hops[1]?.note).toBe('HTTP 503')
  })

  it('đi vào subsegment nhưng dừng ở trần độ sâu', () => {
    const deep = doc({
      id: 'root',
      name: 'root',
      start_time: 1,
      end_time: 2,
      subsegments: [
        {
          id: 'l1',
          name: 'l1',
          start_time: 1,
          end_time: 2,
          subsegments: [
            {
              id: 'l2',
              name: 'l2',
              start_time: 1,
              end_time: 2,
              subsegments: [
                {
                  id: 'l3',
                  name: 'l3',
                  start_time: 1,
                  end_time: 2,
                  subsegments: [{ id: 'l4', name: 'l4' }],
                },
              ],
            },
          ],
        },
      ],
    })
    const got = hopsFromXrayJson(payload([deep]))
    expect(got?.hops.map((h) => h.label)).toEqual(['root', 'l1', 'l2', 'l3'])
  })

  it('JSON hỏng trả null thay vì ném', () => {
    expect(hopsFromXrayJson('{không phải json')).toBeNull()
  })

  it('segment Document hỏng thì bỏ qua đúng segment đó', () => {
    const got = hopsFromXrayJson(
      payload(['{hỏng', doc({ id: 'ok', name: 'ok', start_time: 1, end_time: 2 })]),
    )
    expect(got?.hops.map((h) => h.label)).toEqual(['ok'])
  })

  it('trace rỗng là rỗng, không phải lỗi', () => {
    expect(hopsFromXrayJson(JSON.stringify({ Traces: [] }))).toEqual({ hops: [], truncated: false })
  })

  it.each([
    [{ origin: 'AWS::Lambda::Function' }, 'lambda'],
    [{ origin: 'AWS::ApiGateway::Stage' }, 'apigateway'],
    [{ namespace: 'remote' }, 'remote'],
    [{}, 'xray'],
  ])('suy dịch vụ từ segment %o', (seg, service) => {
    expect(serviceOfXraySegment(seg)).toBe(service)
  })
})

describe('traceOf', () => {
  // ⚠ Lỗi thật của bản ship 2026-09-16: tổng lấy `lastAt` của PHẦN TỬ CUỐI mảng, mà
  // mảng sắp theo mốc BẮT ĐẦU — segment bao ngoài (API Gateway mở đầu, đóng sau
  // cùng) không bao giờ là phần tử cuối, nên tổng ra NGẮN HƠN chính `durationMs`
  // đang hiện trên hàng đó.
  it('tổng bao trọn chặng kết thúc muộn nhất, kể cả khi nó bắt đầu sớm nhất', () => {
    const hops = hopsFromRows([
      { '@log': 'a:/aws/apigw', '@timestamp': '2026-09-16 10:00:00.000', '@message': 'vào' },
      { '@log': 'a:/aws/lambda/x', '@timestamp': '2026-09-16 10:00:00.200', '@message': 'chạy' },
      { '@log': 'a:/aws/apigw', '@timestamp': '2026-09-16 10:00:05.000', '@message': 'ra' },
    ])
    expect(traceOf('abc', 'free', 'logs', hops, false, []).totalMs).toBe(5000)
  })

  it('tổng thời gian đo từ mốc đầu tới mốc cuối', () => {
    const hops = hopsFromRows([
      { '@log': 'a:/aws/lambda/a', '@timestamp': '2026-09-16 10:00:00.000', '@message': 'x' },
      { '@log': 'a:/aws/lambda/b', '@timestamp': '2026-09-16 10:00:01.500', '@message': 'y' },
    ])
    expect(traceOf('abc', 'free', 'logs', hops, false, []).totalMs).toBe(1500)
  })

  it('không đủ mốc thì nói null chứ không trả 0', () => {
    expect(traceOf('abc', 'free', 'logs', [], false, []).totalMs).toBeNull()
  })
})
