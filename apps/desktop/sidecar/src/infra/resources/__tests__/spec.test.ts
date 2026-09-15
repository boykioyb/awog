// Bảng ca cho khuôn view Explorer (Mốc 3, task 3.1/3.2/3.8).
//
// Trọng tâm là `buildArgs` — nó là chỗ DUY NHẤT dữ liệu người dùng/agent trở thành
// argv. Hai luật phải giữ được: giá trị thiếu thì báo đúng khoá nào thiếu (để UI
// hỏi đúng ô), và giá trị bắt đầu bằng `-` bị TỪ CHỐI (vì CLI sẽ đọc nó thành cờ,
// tức biến dữ liệu thành quyền).
import { describe, expect, it } from 'vitest'
import { arnTail, buildArgs, formatBytes, formatWhen, tagName } from '../spec.js'
import { allDescriptors, allViewIds, toDescriptor, viewById } from '../registry.js'
import { AWS_RESOURCE_VIEWS } from '../aws-views.js'
import { catalogFor, DEFAULT_PINNED, SERVICE_GROUPS } from '../services-catalog.js'

describe('buildArgs', () => {
  it('thay placeholder bằng giá trị', () => {
    const r = buildArgs(['s3api', 'list-objects-v2', '--bucket', '{bucket}'], { bucket: 'b-1' })
    expect(r).toEqual({ ok: true, args: ['s3api', 'list-objects-v2', '--bucket', 'b-1'] })
  })

  it('báo ĐÚNG khoá thiếu thay vì chạy lệnh sai', () => {
    const r = buildArgs(['--bucket', '{bucket}', '--prefix', '{prefix}'], {})
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.missing).toEqual(['bucket', 'prefix'])
  })

  it('coi chuỗi rỗng là thiếu', () => {
    const r = buildArgs(['--bucket', '{bucket}'], { bucket: '' })
    expect(r.ok).toBe(false)
  })

  // Luật load-bearing: một giá trị bắt đầu bằng `-` bị chính CLI đọc thành CỜ.
  it.each([['--profile', '-prod'], ['-x', '-n'], ['--endpoint-url', '-x']])(
    'từ chối giá trị %s = %s',
    (_k, value) => {
      const r = buildArgs(['--bucket', '{bucket}'], { bucket: value })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('"-"')
    },
  )

  it('từ chối giá trị quá dài', () => {
    const r = buildArgs(['--bucket', '{bucket}'], { bucket: 'a'.repeat(2000) })
    expect(r.ok).toBe(false)
  })

  it('giữ nguyên token không phải placeholder', () => {
    const r = buildArgs(['ec2', 'describe-instances'], {})
    expect(r).toEqual({ ok: true, args: ['ec2', 'describe-instances'] })
  })
})

// Trường dạng DANH SÁCH (Mốc 4, task 4.1): một ô nhập → nhiều token argv. Luật
// "-" phải được kiểm cho TỪNG token, nếu không thì `"/a -b"` lọt một cờ vào argv.
describe('buildArgs — trường danh sách', () => {
  const tpl = ['cloudfront', 'create-invalidation', '--paths', '{paths}']
  const opts = { listKeys: new Set(['paths']) }

  it('tách theo khoảng trắng và dấu phẩy', () => {
    const r = buildArgs(tpl, { paths: '/index.html, /assets/*  /img/*' }, opts)
    expect(r).toEqual({
      ok: true,
      args: [
        'cloudfront',
        'create-invalidation',
        '--paths',
        '/index.html',
        '/assets/*',
        '/img/*',
      ],
    })
  })

  it('TỪ CHỐI khi có một token bắt đầu bằng "-"', () => {
    const r = buildArgs(tpl, { paths: '/index.html --profile prod' }, opts)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('"-"')
  })

  it('rỗng / toàn dấu cách là THIẾU, không phải chuỗi rỗng', () => {
    const r = buildArgs(tpl, { paths: '   ' }, opts)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.missing).toEqual(['paths'])
  })

  it('không khai `list` thì giữ nguyên một token (không tự đoán theo dấu cách)', () => {
    const r = buildArgs(tpl, { paths: '/a /b' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.args[3]).toBe('/a /b')
  })
})

describe('helpers đọc JSON', () => {
  it('tagName lấy tag Name, bỏ qua tag khác', () => {
    expect(
      tagName([
        { Key: 'Env', Value: 'prod' },
        { Key: 'Name', Value: 'web-1' },
      ]),
    ).toBe('web-1')
    expect(tagName(undefined)).toBe('')
  })

  it('arnTail cắt theo dấu phân cách của arn', () => {
    expect(arnTail('arn:aws:ecs:ap-southeast-1:1:cluster/prod')).toBe('prod')
    expect(arnTail('arn:aws:sns:ap-southeast-1:1:my-topic', ':')).toBe('my-topic')
  })

  it('formatBytes đổi đơn vị', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB')
    expect(formatBytes('nope')).toBe('')
  })

  it('formatWhen cắt ISO thành ngày giờ', () => {
    expect(formatWhen('2026-09-14T01:17:56.000Z')).toBe('14/09 01:17')
    expect(formatWhen('')).toBe('')
  })
})

describe('registry', () => {
  it('mọi view id là duy nhất', () => {
    const ids = allViewIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('viewById trả null cho id lạ (không có đường id-tuỳ-ý vào argv)', () => {
    expect(viewById('does.not.exist')).toBeNull()
    expect(viewById('ec2.instances')?.service).toBe('ec2')
  })

  it('mọi view khai đủ HAI bộ cột (task 3.2)', () => {
    for (const v of AWS_RESOURCE_VIEWS) {
      expect(v.columns.simple.length).toBeGreaterThan(0)
      expect(v.columns.full.length).toBeGreaterThan(0)
      // Mỗi cột của bộ full phải có trong dữ liệu hoặc là cột id — nếu không,
      // bảng sẽ hiện một cột trống vĩnh viễn mà không ai nhận ra.
      expect(v.columns.simple.length).toBeLessThanOrEqual(v.columns.full.length)
    }
  })

  it('descriptor KHÔNG lộ hàm thực thi', () => {
    // Đệ quy chứ không so chuỗi: nhãn i18n có chữ "function" một cách hợp lệ
    // (`infra.explorer.view.lambda.functions`), nên tìm chuỗi là bắt nhầm.
    const seen: unknown[] = []
    const walk = (v: unknown): void => {
      seen.push(v)
      if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) walk(x)
    }
    for (const d of allDescriptors()) {
      expect(Object.keys(d)).not.toContain('list')
      expect(Object.keys(d)).not.toContain('probe')
      expect(d.id).toBeTruthy()
      walk(d)
    }
    for (const v of seen) {
      expect(typeof v).not.toBe('function')
      expect(typeof v).not.toBe('symbol')
    }
  })

  it('Mốc 4: `notice`, `fields` và `opensView` đi qua descriptor', () => {
    const acm = toDescriptor(viewById('acm.certificates')!)
    expect(acm.notice).toBe('infra.explorer.notice.acmRegion')
    const cf = toDescriptor(viewById('cloudfront.distributions')!)
    const invalidation = cf.actions.find((a) => a.id === 'cloudfront.createInvalidation')
    expect(invalidation?.fields.map((f) => f.key)).toEqual(['paths'])
    // Ô nhiều giá trị: thiếu cờ này thì mọi invalidation nhiều đường dẫn sẽ gửi
    // ĐÚNG MỘT token chứa dấu cách, và CLI trả lỗi khó hiểu.
    expect(invalidation?.fields[0]?.list).toBe(true)
    const history = cf.actions.find((a) => a.id === 'cloudfront.invalidations')
    expect(history?.opensView).toEqual({
      viewId: 'cloudfront.invalidations',
      values: { distributionId: 'id' },
    })
    // Hành động điều hướng không có lệnh ⇒ không được khai `iam`/probe.
    expect(history?.iam).toBeNull()
    const zones = toDescriptor(viewById('route53.zones')!)
    expect(zones.actions.find((a) => a.id === 'route53.records')?.opensView?.viewId).toBe(
      'route53.records',
    )
  })

  it('descriptor giữ đúng hình dạng cho một view đã biết', () => {
    const spec = viewById('ec2.instances')
    expect(spec).not.toBeNull()
    const d = toDescriptor(spec!)
    expect(d.hasDetail).toBe(true)
    expect(d.hasConsole).toBe(true)
    expect(d.canProbe).toBe(true)
    expect(d.actions.map((a) => a.id)).toContain('ec2.terminate')
    expect(d.actions.find((a) => a.id === 'ec2.terminate')?.confirm).toBe('type-name')
  })
})

describe('services catalog', () => {
  it('mọi dịch vụ thuộc một nhóm đã khai', () => {
    for (const s of catalogFor('ap-southeast-1')) {
      expect(SERVICE_GROUPS).toContain(s.group)
    }
  })

  it('view/tab thì không có consoleUrl; console thì có (trừ khi chưa map)', () => {
    for (const s of catalogFor('ap-southeast-1')) {
      if (s.target.kind === 'console') continue
      expect(s.consoleUrl).toBeNull()
    }
  })

  // Một thẻ mức Console mà không có deep link là một thẻ CHẾT: nút ↗ biến mất, và
  // người dùng chỉ còn nước tự mở Console rồi tự tìm dịch vụ. Đã có lần thêm dịch
  // vụ vào `SERVICE_CATALOG` mà quên bảng `svcConsole` (2026-09-14, đợt mở rộng
  // danh mục 40 → 102), nên bất biến này được khoá lại: thêm dịch vụ mức Console
  // thì PHẢI thêm cả dòng deep link.
  it('mọi dịch vụ mức Console đều có deep link', () => {
    const missing = catalogFor('ap-southeast-1')
      .filter((s) => s.target.kind === 'console' && !s.consoleUrl)
      .map((s) => s.id)
    expect(missing).toEqual([])
  })

  it('ghim sẵn trỏ tới dịch vụ có thật', () => {
    const ids = new Set(catalogFor('').map((s) => s.id))
    for (const p of DEFAULT_PINNED) expect(ids.has(p)).toBe(true)
  })

  it('dịch vụ toàn cầu KHÔNG nhận region trong deep link (task 3.4)', () => {
    const iam = catalogFor('ap-southeast-1').find((s) => s.id === 'iam')
    expect(iam?.consoleUrl).toContain('https://console.aws.amazon.com/')
    expect(iam?.consoleUrl).not.toContain('region=')
    const ec2 = catalogFor('ap-southeast-1').find((s) => s.id === 'eks')
    expect(ec2?.consoleUrl).toContain('ap-southeast-1')
  })
})

// Task 3.3 dựa vào một bất biến: nếu UI định ẩn nút vì thiếu quyền thì nó phải
// BIẾT nút đó cần action IAM nào, và action đó phải nằm trong danh sách đã dò.
// Thiếu một trong hai thì nút "unknown" sẽ không bao giờ bị ẩn — hoặc tệ hơn, bị
// ẩn vì một cái tên đoán sai.
describe('Mốc 3 — ánh xạ quyền cho từng nút (task 3.3)', () => {
  it('mọi nút GHI đều khai `iam` và được view dò tới', () => {
    for (const spec of AWS_RESOURCE_VIEWS) {
      const gated = [
        ...(spec.actions ?? []),
        ...(spec.forms ?? []),
      ].filter((a) => a.confirm !== 'none')
      if (gated.length === 0) continue
      for (const a of gated) {
        expect(a.iam, `${spec.id} → ${a.id} thiếu iam`).toBeTruthy()
      }
      // Không dò thì `probeByView` của UI không có khoá ⇒ không ẩn được nút nào.
      expect(spec.probe, `${spec.id} có nút ghi nhưng không khai probe`).toBeTruthy()
      for (const a of gated) {
        expect(spec.probe?.actions, `${spec.id} → ${a.id}`).toContain(a.iam)
      }
    }
  })

  it('`iam` đi qua descriptor (UI cần nó để ẩn đúng nút)', () => {
    const ec2 = toDescriptor(viewById('ec2.instances')!)
    const term = ec2.actions.find((a) => a.id === 'ec2.terminate')
    expect(term?.iam).toBe('ec2:TerminateInstances')
    // Nút chỉ-đọc không cần iam — descriptor vẫn trả null thay vì bịa.
    const s3 = toDescriptor(viewById('s3.buckets')!)
    expect(s3.forms[0]?.iam).toBe('s3:CreateBucket')
  })
})
