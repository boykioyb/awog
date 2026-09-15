// `open-private` — đo phần THUẦN của đường thoát 400 Bad Request
// (aws/aws-cli#10186): hàng rào URL, chọn trình duyệt, và argv của `open`.
//
// Việc mở cửa sổ thật không đo được ở đây (cần người dùng thật + tài khoản AWS
// thật); mọi ca dưới đây tiêm `run`/`exists` giả nên KHÔNG mở trình duyệt nào
// của người chạy test. Ca "mở được cửa sổ ẩn danh rồi hoàn tất đăng nhập" vẫn là
// chưa đo, ghi rõ ở docs/features/aws-profile-manager.md.
import { describe, expect, it, vi } from 'vitest'
import {
  buildPrivateOpenArgs,
  candidateDirs,
  isAuthorizeUrl,
  openInPrivateWindow,
  parseDefaultBrowserBundleId,
  pickPrivateBrowser,
  type PrivateBrowser,
} from '../open-private.js'

/** URL uỷ quyền thật, rút gọn phần query — đúng hình dạng CLI in ra. */
const URL_VN =
  'https://ap-southeast-1.signin.aws.amazon.com/v1/authorize?response_type=code' +
  '&client_id=arn%3Aaws%3Asignin%3A%3A%3Adevtools%2Fsame-device&state=abc&redirect_uri=' +
  'http%3A%2F%2F127.0.0.1%3A52140%2Foauth%2Fcallback'

describe('isAuthorizeUrl', () => {
  it('nhận URL uỷ quyền của các partition', () => {
    expect(isAuthorizeUrl(URL_VN)).toBe(true)
    expect(isAuthorizeUrl('https://signin.aws.amazon.com/v1/authorize?x=1')).toBe(true)
    expect(isAuthorizeUrl('https://signin.amazonaws-us-gov.com/v1/authorize?x=1')).toBe(true)
    expect(isAuthorizeUrl('https://signin.amazonaws.cn/v1/authorize?x=1')).toBe(true)
  })

  it('từ chối mọi thứ không phải trang đăng nhập AWS', () => {
    // `signin.evil.com` là ca đáng sợ nhất: host trông đúng nhưng không phải AWS.
    expect(isAuthorizeUrl('https://signin.evil.com/v1/authorize?x=1')).toBe(false)
    expect(isAuthorizeUrl('https://evil.com/ap-southeast-1.signin.aws.amazon.com/v1/authorize')).toBe(
      false,
    )
    // http (không phải https) và scheme khác.
    expect(isAuthorizeUrl('http://ap-southeast-1.signin.aws.amazon.com/v1/authorize?x=1')).toBe(false)
    expect(isAuthorizeUrl('file:///etc/passwd')).toBe(false)
    // Đúng host nhưng sai đường dẫn.
    expect(isAuthorizeUrl('https://signin.aws.amazon.com/v1/authorize')).toBe(false)
    expect(isAuthorizeUrl('https://signin.aws.amazon.com/')).toBe(false)
    expect(isAuthorizeUrl('')).toBe(false)
    expect(isAuthorizeUrl(`https://signin.aws.amazon.com/v1/authorize?x=${'a'.repeat(5000)}`)).toBe(
      false,
    )
  })
})

describe('parseDefaultBrowserBundleId', () => {
  // Hình dạng thật lấy từ máy macOS 2026-09-13 (`plutil -convert json`).
  const real = JSON.stringify({
    LSHandlers: [
      { LSHandlerURLScheme: 'https', LSHandlerRoleAll: 'com.google.chrome' },
      { LSHandlerURLScheme: 'http', LSHandlerRoleAll: 'com.google.chrome' },
    ],
  })

  it('đọc được trình duyệt mặc định', () => {
    expect(parseDefaultBrowserBundleId(real)).toBe('com.google.chrome')
  })

  it('trả null thay vì ném khi dữ liệu hỏng hoặc trống', () => {
    expect(parseDefaultBrowserBundleId('')).toBeNull()
    expect(parseDefaultBrowserBundleId('not json')).toBeNull()
    expect(parseDefaultBrowserBundleId('{}')).toBeNull()
    // `-` là "chưa chọn" của LaunchServices, không phải bundle id.
    expect(
      parseDefaultBrowserBundleId(
        JSON.stringify({ LSHandlers: [{ LSHandlerURLScheme: 'http', LSHandlerRoleAll: '-' }] }),
      ),
    ).toBeNull()
  })

  it('dùng được cả khoá của trình xem và xét https trước http', () => {
    expect(
      parseDefaultBrowserBundleId(
        JSON.stringify({
          LSHandlers: [
            { LSHandlerURLScheme: 'https', LSHandlerRoleViewer: 'org.mozilla.firefox' },
            { LSHandlerURLScheme: 'http', LSHandlerRoleAll: 'com.google.chrome' },
          ],
        }),
      ),
    ).toBe('org.mozilla.firefox')
  })
})

describe('pickPrivateBrowser', () => {
  const dirs = ['/Apps']
  const installed = (...apps: string[]): ((p: string) => boolean) => {
    const set = new Set(apps.map((a) => `/Apps/${a}.app`))
    return (p) => set.has(p)
  }

  it('ưu tiên ĐÚNG trình duyệt mặc định khi nó mở được cửa sổ riêng tư', () => {
    const got = pickPrivateBrowser({
      bundleId: 'com.brave.Browser',
      dirs,
      exists: installed('Google Chrome', 'Brave Browser'),
    })
    expect(got?.app).toBe('Brave Browser')
  })

  it('rơi về thứ tự mặc định khi trình duyệt mặc định không mở được riêng tư', () => {
    // Safari là mặc định nhưng không có cờ dòng lệnh ⇒ dùng Chrome nếu có.
    const got = pickPrivateBrowser({
      bundleId: 'com.apple.Safari',
      dirs,
      exists: installed('Google Chrome'),
    })
    expect(got?.app).toBe('Google Chrome')
  })

  it('trả null khi chỉ có Safari — UI phải giữ đường "sao chép URL"', () => {
    expect(pickPrivateBrowser({ bundleId: 'com.apple.Safari', dirs, exists: () => false })).toBeNull()
  })

  it('tìm trong ~/Applications trước /Applications', () => {
    const seen: string[] = []
    const got = pickPrivateBrowser({
      dirs: ['/home/u/Applications', '/Applications'],
      exists: (p) => {
        seen.push(p)
        return p === '/home/u/Applications/Google Chrome.app'
      },
    })
    expect(got?.path).toBe('/home/u/Applications/Google Chrome.app')
    expect(seen).toContain('/home/u/Applications/Google Chrome.app')
  })

  it('candidateDirs đặt bản cài của người dùng lên trước', () => {
    expect(candidateDirs('/home/u')).toEqual(['/home/u/Applications', '/Applications'])
  })
})

describe('buildPrivateOpenArgs', () => {
  const chrome: PrivateBrowser = {
    app: 'Google Chrome',
    path: '/Applications/Google Chrome.app',
    flags: ['--incognito'],
  }

  it('truyền cờ riêng tư qua `--args` của `open`', () => {
    expect(buildPrivateOpenArgs(chrome, URL_VN)).toEqual([
      '-n',
      '-a',
      '/Applications/Google Chrome.app',
      '--args',
      '--incognito',
      URL_VN,
    ])
  })

  it('luôn có `-n`: thiếu nó thì `open` bỏ qua `--args` và mất cờ ẩn danh', () => {
    // Đây là hồi quy dễ xảy ra nhất của hàm này — khoá lại bằng test.
    expect(buildPrivateOpenArgs(chrome, URL_VN)).toContain('-n')
  })

  it('dùng cờ riêng của Firefox', () => {
    const firefox: PrivateBrowser = {
      app: 'Firefox',
      path: '/Applications/Firefox.app',
      flags: ['-private-window'],
    }
    expect(buildPrivateOpenArgs(firefox, URL_VN).slice(-2)).toEqual(['-private-window', URL_VN])
  })
})

describe('openInPrivateWindow', () => {
  it('chặn URL không phải trang đăng nhập AWS TRƯỚC khi chạm trình duyệt', async () => {
    const run = vi.fn()
    expect(await openInPrivateWindow('https://example.com/v1/authorize?x=1', { run })).toEqual({
      ok: false,
      error: 'BAD_URL',
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('nói ra mã NO_BROWSER khi máy không có trình duyệt mở được cửa sổ riêng tư', async () => {
    const run = vi.fn()
    expect(await openInPrivateWindow(URL_VN, { pick: () => null, run })).toEqual({
      ok: false,
      error: 'NO_BROWSER',
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('mở bằng argv đã dựng và trả tên trình duyệt cho UI', async () => {
    const run = vi.fn(async (_args: string[]) => {})
    const got = await openInPrivateWindow(URL_VN, {
      pick: () => ({ app: 'Google Chrome', path: '/Applications/Google Chrome.app', flags: ['--incognito'] }),
      run,
    })
    expect(got).toEqual({ ok: true, browser: 'Google Chrome' })
    expect(run).toHaveBeenCalledWith(buildPrivateOpenArgs(
      { app: 'Google Chrome', path: '/Applications/Google Chrome.app', flags: ['--incognito'] },
      URL_VN,
    ))
  })

  it('đổi lỗi của `open` thành LAUNCH_FAILED thay vì ném lên UI', async () => {
    const run = vi.fn(async () => {
      throw new Error('open: not found')
    })
    const got = await openInPrivateWindow(URL_VN, {
      pick: () => ({ app: 'Firefox', path: '/Applications/Firefox.app', flags: ['-private-window'] }),
      run,
    })
    expect(got).toEqual({ ok: false, error: 'LAUNCH_FAILED' })
  })
})
