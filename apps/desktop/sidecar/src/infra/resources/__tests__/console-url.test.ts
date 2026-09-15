// Bảng ca cho deep link Console (task 3.4). Hai luật được ghim ở đây:
//   · profile SSO ⇒ đích bị bọc trong `goto` của cổng (nếu không, trình duyệt đứng
//     ở trang đăng nhập dù người dùng đã có phiên);
//   · view không khai Console ⇒ `null` (UI ẩn nút, không mở URL đoán mò).
import { describe, expect, it } from 'vitest'
import { buildConsoleUrl, wrapSsoStartUrl } from '../console-url.js'
import { viewById } from '../registry.js'

describe('wrapSsoStartUrl', () => {
  it('nhét đích vào `goto` và giữ nguyên start URL', () => {
    const out = wrapSsoStartUrl(
      'https://d-1234567890.awsapps.com/start',
      'https://ap-southeast-1.console.aws.amazon.com/ec2/home',
    )
    const u = new URL(out)
    expect(u.host).toBe('d-1234567890.awsapps.com')
    expect(u.searchParams.get('goto')).toBe(
      'https://ap-southeast-1.console.aws.amazon.com/ec2/home',
    )
  })

  it('start URL rỗng ⇒ trả về đích (không bịa cổng)', () => {
    expect(wrapSsoStartUrl('  ', 'https://x.test/a')).toBe('https://x.test/a')
  })

  it('start URL hỏng ⇒ KHÔNG nuốt đích', () => {
    expect(wrapSsoStartUrl('khong-phai-url', 'https://x.test/a')).toBe('https://x.test/a')
  })
})

describe('buildConsoleUrl', () => {
  it('view không khai console ⇒ null', () => {
    const spec = viewById('s3.objects')!
    // `s3.objects` là view duyệt trong một bucket — spec của nó không khai consoleUrl.
    expect(spec.consoleUrl).toBeUndefined()
    expect(buildConsoleUrl({ row: {}, region: 'ap-southeast-1' })).toBeNull()
  })

  it('dùng đúng hàm của spec cho đối tượng đang chọn', () => {
    const spec = viewById('ec2.instances')!
    const url = buildConsoleUrl({
      build: spec.consoleUrl,
      row: { id: 'i-0abc' },
      region: 'ap-southeast-1',
    })
    expect(url).toContain('ap-southeast-1.console.aws.amazon.com')
    expect(url).toContain('i-0abc')
  })

  it('có SSO start-url ⇒ bọc, và đích vẫn còn nguyên trong `goto`', () => {
    const spec = viewById('ec2.instances')!
    const wrapped = buildConsoleUrl({
      build: spec.consoleUrl,
      row: { id: 'i-0abc' },
      region: 'ap-southeast-1',
      ssoStartUrl: 'https://d-1.awsapps.com/start',
    })!
    const goto = new URL(wrapped).searchParams.get('goto')!
    expect(goto).toContain('i-0abc')
  })
})
