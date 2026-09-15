// `aws login` — chỉ đo được phần KHÔNG cần trình duyệt: hai hàng rào thuần
// (`readLoginSession`, `assertLoginTarget`) và hai validate biên chạy TRƯỚC khi
// chạm CLI. Luồng thật (mở browser → người dùng duyệt → CLI ghi file tạm) không
// tự động hoá được trong test, nên nó được ghi rõ là chưa đo ở
// docs/features/aws-profile-manager.md §"Lấy credential ở đâu".
//
// Mọi ca trỏ `AWS_CONFIG_FILE`/`HOME` vào thư mục tạm — `consoleLogin()` đọc
// danh sách profile từ `listAwsProfiles()` trước khi spawn, nên không được để nó
// chạm `~/.aws` thật của người chạy test.
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertLoginTarget,
  consoleLogin,
  extractAuthorizeUrl,
  readLoginSession,
} from '../console-login.js'

let dir = ''
const savedEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'awog-login-'))
  await mkdir(join(dir, 'aws'), { recursive: true })
  for (const k of ['HOME', 'USERPROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE']) {
    savedEnv[k] = process.env[k]
  }
  process.env.HOME = dir
  process.env.USERPROFILE = dir
  process.env.AWS_CONFIG_FILE = join(dir, 'aws', 'config')
  process.env.AWS_SHARED_CREDENTIALS_FILE = join(dir, 'aws', 'credentials')
})

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('readLoginSession', () => {
  it('bóc login_session của profile thường và của default', () => {
    const raw = [
      '[profile console]',
      'login_session = 11112222-3333-4444-5555-666677778888',
      'region = ap-southeast-1',
      '',
      '[default]',
      'login_session = aaaabbbb-cccc-dddd-eeee-ffff00001111',
      '',
    ].join('\n')
    expect(readLoginSession(raw, 'console')).toBe('11112222-3333-4444-5555-666677778888')
    expect(readLoginSession(raw, 'default')).toBe('aaaabbbb-cccc-dddd-eeee-ffff00001111')
  })

  it('trả null khi thiếu profile, thiếu khoá, hoặc giá trị rỗng', () => {
    expect(readLoginSession('[profile a]\nregion = us-east-1\n', 'a')).toBeNull()
    expect(readLoginSession('[profile a]\nlogin_session = \n', 'a')).toBeNull()
    expect(readLoginSession('[profile a]\nlogin_session = x\n', 'b')).toBeNull()
    expect(readLoginSession('', 'a')).toBeNull()
  })

  it('không lấy nhầm login_session của profile khác (khớp theo section)', () => {
    const raw = '[profile a]\nlogin_session = A\n\n[profile ab]\nlogin_session = AB\n'
    expect(readLoginSession(raw, 'a')).toBe('A')
    expect(readLoginSession(raw, 'ab')).toBe('AB')
  })
})

describe('assertLoginTarget', () => {
  it('cho phép profile chưa có và profile đã là login (đăng nhập lại)', () => {
    expect(() => assertLoginTarget('x', undefined)).not.toThrow()
    expect(() => assertLoginTarget('x', 'login')).not.toThrow()
  })

  it('chặn mọi kiểu credential khác — đăng nhập Console không được đè lên chúng', () => {
    for (const kind of ['static', 'sso', 'assume-role', 'process', 'unknown']) {
      expect(() => assertLoginTarget('prod', kind)).toThrow(/EXISTS_OTHER_STYLE/)
    }
  })
})

describe('consoleLogin — validate biên chạy trước khi chạm CLI', () => {
  it('từ chối tên profile không hợp lệ (kể cả tên có khoảng trắng)', async () => {
    await expect(consoleLogin({ profile: 'bad name', region: 'us-east-1' })).rejects.toThrow(
      /INVALID_NAME/,
    )
  })

  it('từ chối region không hợp lệ — thiếu nó CLI sẽ prompt trên TTY và treo', async () => {
    await expect(consoleLogin({ profile: 'console', region: 'US East 1' })).rejects.toThrow(
      /INVALID_REGION/,
    )
  })
})

describe('extractAuthorizeUrl', () => {
  const line =
    'Attempting to open your default browser. If the browser does not open, open the following URL.\n' +
    '\n' +
    'https://ap-southeast-1.signin.aws.amazon.com/v1/authorize?response_type=code&client_id=arn%3Aaws%3Asignin%3A%3A%3Adevtools%2Fsame-device&state=abc-123&code_challenge_method=SHA-256&scope=openid&redirect_uri=http%3A%2F%2F127.0.0.1%3A61078%2Foauth%2Fcallback&code_challenge=ZZZ\n'

  it('bóc đúng URL uỷ quyền CLI in ra, dừng ở khoảng trắng', () => {
    expect(extractAuthorizeUrl(line)).toBe(
      'https://ap-southeast-1.signin.aws.amazon.com/v1/authorize?response_type=code&client_id=arn%3Aaws%3Asignin%3A%3A%3Adevtools%2Fsame-device&state=abc-123&code_challenge_method=SHA-256&scope=openid&redirect_uri=http%3A%2F%2F127.0.0.1%3A61078%2Foauth%2Fcallback&code_challenge=ZZZ',
    )
  })

  it('trả null khi output chưa có URL (CLI chưa mở trình duyệt)', () => {
    expect(extractAuthorizeUrl('')).toBeNull()
    expect(extractAuthorizeUrl('No AWS region has been configured.\n')).toBeNull()
    expect(extractAuthorizeUrl('https://example.com/other?x=1')).toBeNull()
  })

  it('không nhận URL thiếu query — link đó AWS trả 400 nên không được đưa cho người dùng', () => {
    expect(
      extractAuthorizeUrl('https://ap-southeast-1.signin.aws.amazon.com/v1/authorize'),
    ).toBeNull()
  })

  it('ghép được URL bị pipe cắt qua hai lần đọc (đuôi 2048 ký tự)', () => {
    const head = line.slice(0, 120)
    const rest = line.slice(120)
    expect(extractAuthorizeUrl(head)).toBeNull()
    expect(extractAuthorizeUrl((head + rest).slice(-2048))).not.toBeNull()
  })
})
