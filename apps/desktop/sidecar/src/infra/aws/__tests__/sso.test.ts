// A5 — khám phá SSO. Đây là module DUY NHẤT của Mốc 1 cầm credential SỐNG
// (access token), nên nó phải có test riêng.
//
// Không ca nào spawn `aws`: mọi thứ đo được ở đây là hàng rào của chính AWOG —
// validate biên, chọn đúng file cache, chà token khỏi chuỗi sắp đi ra ngoài,
// không để token vào argv, và ngữ nghĩa "ghi đè" của `ssoCreateProfiles`.
// Ca nào chạm đĩa đều đổi `HOME` + `AWS_CONFIG_FILE` + `AWS_SHARED_CREDENTIALS_FILE`
// sang thư mục tạm.
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertStartUrl,
  findAccessToken,
  scrubToken,
  ssoCreateProfiles,
  withTokenFile,
} from '../sso.js'

const TOKEN = 'aoaAAAAAEXAMPLEsso-access-token-value'
const OTHER_TOKEN = 'aoaAAAAAEXAMPLEother-token-value'
const STATIC_SECRET = 'wJalrXUtnFEMI-K7MDENG-bPxRfiCYEXAMPLEKEY'
const START_URL = 'https://corp.awsapps.com/start'

let dir = ''
let configPath = ''
let credentialsPath = ''
let cacheDir = ''
const savedEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'awog-sso-'))
  await mkdir(join(dir, 'aws'), { recursive: true })
  configPath = join(dir, 'aws', 'config')
  credentialsPath = join(dir, 'aws', 'credentials')
  cacheDir = join(dir, 'aws', 'sso', 'cache')
  await mkdir(cacheDir, { recursive: true })
  for (const k of ['HOME', 'USERPROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE']) {
    savedEnv[k] = process.env[k]
  }
  process.env.HOME = dir
  process.env.USERPROFILE = dir
  process.env.AWS_CONFIG_FILE = configPath
  process.env.AWS_SHARED_CREDENTIALS_FILE = credentialsPath
})

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

function inHours(h: number): string {
  return new Date(Date.now() + h * 3600_000).toISOString()
}

async function writeCacheFile(
  name: string,
  body: { accessToken: string; expiresAt: string; startUrl?: string },
): Promise<void> {
  await writeFile(join(cacheDir, `${name}.json`), JSON.stringify(body), { mode: 0o600 })
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

// ─── assertStartUrl ─────────────────────────────────────────────────────────

describe('assertStartUrl', () => {
  it('nhận HTTPS thường', () => {
    expect(assertStartUrl(`  ${START_URL}  `)).toBe(START_URL)
  })

  it('từ chối http, chuỗi không phải URL, và URL nhúng credential', () => {
    expect(() => assertStartUrl('http://corp.awsapps.com/start')).toThrow(/INVALID_START_URL/)
    expect(() => assertStartUrl('corp.awsapps.com/start')).toThrow(/INVALID_START_URL/)
    expect(() => assertStartUrl('https://u:p@corp.awsapps.com/start')).toThrow(
      /must not embed credentials/,
    )
    expect(() => assertStartUrl('https://u@corp.awsapps.com/start')).toThrow(
      /must not embed credentials/,
    )
  })
})

// ─── scrubToken ─────────────────────────────────────────────────────────────

describe('scrubToken', () => {
  it('thay MỌI lần xuất hiện, kể cả token nằm giữa chuỗi', () => {
    const text = `before ${TOKEN} middle ${TOKEN}-suffix end`
    const out = scrubToken(text, TOKEN)
    expect(out).not.toContain(TOKEN)
    expect(out).toBe('before [redacted] middle [redacted]-suffix end')
  })

  it('token rỗng là no-op (không được biến cả chuỗi thành [redacted])', () => {
    expect(scrubToken('nothing to hide', '')).toBe('nothing to hide')
  })
})

// ─── findAccessToken ────────────────────────────────────────────────────────

describe('findAccessToken', () => {
  it('đường chính: file đặt tên theo sha1(TÊN SSO-SESSION)', async () => {
    await writeCacheFile(sha1('corp'), { accessToken: TOKEN, expiresAt: inHours(4) })
    expect(await findAccessToken('corp', START_URL)).toBe(TOKEN)
  })

  it('bỏ token đã hết hạn (và cả token còn dưới 60s)', async () => {
    await writeCacheFile(sha1('corp'), { accessToken: TOKEN, expiresAt: inHours(-1) })
    expect(await findAccessToken('corp', null)).toBeNull()

    await writeCacheFile(sha1('corp'), {
      accessToken: TOKEN,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    })
    expect(await findAccessToken('corp', null)).toBeNull()
  })

  it('đường lùi quét thư mục nhưng CHỈ khớp đúng startUrl', async () => {
    await writeCacheFile('legacy', {
      accessToken: TOKEN,
      expiresAt: inHours(4),
      startUrl: START_URL,
    })
    await writeCacheFile('foreign', {
      accessToken: OTHER_TOKEN,
      expiresAt: inHours(4),
      startUrl: 'https://other.awsapps.com/start',
    })
    expect(await findAccessToken('corp', START_URL)).toBe(TOKEN)
    expect(await findAccessToken('corp', 'https://nobody.awsapps.com/start')).toBeNull()
    // Không biết startUrl thì KHÔNG được vơ đại một token nào đó trong cache.
    expect(await findAccessToken('corp', null)).toBeNull()
  })

  it('JSON hỏng / thiếu trường ⇒ null, không ném', async () => {
    await writeFile(join(cacheDir, `${sha1('corp')}.json`), 'not json')
    expect(await findAccessToken('corp', null)).toBeNull()
    await writeCacheFile(sha1('corp'), { accessToken: '', expiresAt: inHours(4) })
    expect(await findAccessToken('corp', null)).toBeNull()
  })
})

// ─── withTokenFile ──────────────────────────────────────────────────────────

describe('withTokenFile — token KHÔNG đi qua argv', () => {
  it('đối số là `file://…`, file 0600, nội dung đúng token, xoá sau khi xong', async () => {
    let seenArg = ''
    let contentDuringCall = ''
    let modeDuringCall = 0

    await withTokenFile(TOKEN, async (arg) => {
      seenArg = arg
      const path = arg.slice('file://'.length)
      contentDuringCall = await readFile(path, 'utf8')
      modeDuringCall = (await stat(path)).mode & 0o777
    })

    expect(seenArg.startsWith('file://')).toBe(true)
    // Cái quan trọng: đối số KHÔNG chứa giá trị token.
    expect(seenArg).not.toContain(TOKEN)
    // Không `\n` cuối — CLI lấy nguyên văn byte làm giá trị tham số.
    expect(contentDuringCall).toBe(TOKEN)
    expect(modeDuringCall).toBe(0o600)
    await expect(stat(seenArg.slice('file://'.length))).rejects.toThrow()
  })

  it('file nằm trong `~/.awog` (0700), không phải /tmp chung', async () => {
    let path = ''
    await withTokenFile(TOKEN, async (arg) => {
      path = arg.slice('file://'.length)
    })
    expect(path.startsWith(join(dir, '.awog') + '/')).toBe(true)
    expect((await lstat(join(dir, '.awog'))).mode & 0o777).toBe(0o700)
  })

  it('xoá file kể cả khi hàm bên trong NÉM', async () => {
    let path = ''
    await expect(
      withTokenFile(TOKEN, async (arg) => {
        path = arg.slice('file://'.length)
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(path).not.toBe('')
    await expect(stat(path)).rejects.toThrow()
  })
})

// ─── ssoCreateProfiles ──────────────────────────────────────────────────────

const BASE_INPUT = {
  sessionName: 'corp',
  startUrl: START_URL,
  ssoRegion: 'us-east-1',
  region: 'ap-southeast-1',
} as const

describe('ssoCreateProfiles — validate TRƯỚC khi chạm đĩa', () => {
  it.each([
    [
      'tên profile',
      { profileName: 'bad name', accountId: '111111111111', roleName: 'Admin' },
      /INVALID_NAME/,
    ],
    [
      'account id',
      { profileName: 'ok', accountId: '12345', roleName: 'Admin' },
      /INVALID_ACCOUNT_ID/,
    ],
    [
      'tên role',
      { profileName: 'ok', accountId: '111111111111', roleName: 'bad role!' },
      /INVALID_ROLE_NAME/,
    ],
  ])('%s sai ⇒ ném và KHÔNG ghi gì', async (_label, pick, re) => {
    await expect(ssoCreateProfiles({ ...BASE_INPUT, picks: [pick] })).rejects.toThrow(re)
    await expect(readFile(configPath, 'utf8')).rejects.toThrow()
  })

  it('start URL http ⇒ ném trước mọi thứ khác', async () => {
    await expect(
      ssoCreateProfiles({
        ...BASE_INPUT,
        startUrl: 'http://corp.awsapps.com/start',
        picks: [{ profileName: 'ok', accountId: '111111111111', roleName: 'Admin' }],
      }),
    ).rejects.toThrow(/INVALID_START_URL/)
  })
})

describe('ssoCreateProfiles — ghi', () => {
  it('tạo mới: block sso-session + profile, không đụng credentials', async () => {
    const result = await ssoCreateProfiles({
      ...BASE_INPUT,
      picks: [{ profileName: 'dev', accountId: '111111111111', roleName: 'Admin' }],
    })
    expect(result.created).toEqual(['dev'])
    expect(result.clearedStaticKeys).toEqual([])

    const config = await readFile(configPath, 'utf8')
    expect(config).toContain('[sso-session corp]')
    expect(config).toContain(`sso_start_url = ${START_URL}`)
    expect(config).toContain('[profile dev]')
    expect(config).toContain('sso_session = corp')
    expect(config).toContain('sso_account_id = 111111111111')
    expect(config).toContain('region = ap-southeast-1')
    await expect(readFile(credentialsPath, 'utf8')).rejects.toThrow()
  })

  it('profile đã có mà không `overwrite` ⇒ bỏ qua, KHÔNG đè', async () => {
    await writeFile(configPath, ['[profile dev]', 'region = eu-west-1', ''].join('\n'))
    const result = await ssoCreateProfiles({
      ...BASE_INPUT,
      picks: [{ profileName: 'dev', accountId: '111111111111', roleName: 'Admin' }],
    })
    expect(result.created).toEqual([])
    expect(result.skipped).toEqual(['dev'])
    expect(await readFile(configPath, 'utf8')).not.toContain('sso_account_id')
  })

  it('overwrite lên profile STATIC: khoá dài hạn cũ phải BIẾN MẤT', async () => {
    await writeFile(configPath, ['[profile acct]', 'region = eu-west-1', ''].join('\n'))
    await writeFile(
      credentialsPath,
      [
        '[acct]',
        'aws_access_key_id = AKIAIOSFODNN7EXAMPLE',
        `aws_secret_access_key = ${STATIC_SECRET}`,
        '',
      ].join('\n'),
      { mode: 0o600 },
    )

    const result = await ssoCreateProfiles({
      ...BASE_INPUT,
      picks: [{ profileName: 'acct', accountId: '111111111111', roleName: 'Admin' }],
      overwrite: true,
    })
    expect(result.created).toEqual(['acct'])
    expect(result.clearedStaticKeys).toEqual(['acct'])

    const creds = await readFile(credentialsPath, 'utf8')
    expect(creds).not.toContain(STATIC_SECRET)
    expect(creds).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(await readFile(configPath, 'utf8')).toContain('sso_role_name = Admin')
    // Có sao lưu cho CẢ HAI file bị sửa.
    expect(result.backups.length).toBe(2)
  })

  it('overwrite lên profile ASSUME-ROLE: `role_arn` cũ không ở lại', async () => {
    await writeFile(
      configPath,
      [
        '[profile acct]',
        'role_arn = arn:aws:iam::999999999999:role/Old',
        'source_profile = base',
        'external_id = xid',
        '',
      ].join('\n'),
    )
    await ssoCreateProfiles({
      ...BASE_INPUT,
      picks: [{ profileName: 'acct', accountId: '111111111111', roleName: 'Admin' }],
      overwrite: true,
    })
    const config = await readFile(configPath, 'utf8')
    expect(config).not.toContain('role_arn')
    expect(config).not.toContain('source_profile')
    expect(config).not.toContain('external_id')
    expect(config).toContain('sso_session = corp')
  })

  it('profile `credential_process` là CHỈ ĐỌC — bỏ qua kèm lý do', async () => {
    await writeFile(
      configPath,
      ['[profile vault]', 'credential_process = /usr/local/bin/vault-aws', ''].join('\n'),
    )
    const result = await ssoCreateProfiles({
      ...BASE_INPUT,
      picks: [{ profileName: 'vault', accountId: '111111111111', roleName: 'Admin' }],
      overwrite: true,
    })
    expect(result.created).toEqual([])
    expect(result.skipped).toEqual(['vault'])
    expect(result.warnings.join(' ')).toMatch(/credential_process/)
    expect(await readFile(configPath, 'utf8')).toContain('credential_process =')
  })

  it('nhật ký không mang giá trị secret nào', async () => {
    await writeFile(configPath, ['[profile acct]', 'region = eu-west-1', ''].join('\n'))
    await writeFile(
      credentialsPath,
      ['[acct]', `aws_secret_access_key = ${STATIC_SECRET}`, ''].join('\n'),
    )
    await ssoCreateProfiles({
      ...BASE_INPUT,
      picks: [{ profileName: 'acct', accountId: '111111111111', roleName: 'Admin' }],
      overwrite: true,
    })
    const auditDir = join(dir, '.awog', 'infra-audit')
    const files = await readdir(auditDir)
    const raw = await readFile(join(auditDir, files[0]!), 'utf8')
    expect(raw).toContain('sso_create_profiles')
    expect(raw).not.toContain(STATIC_SECRET)
  })
})
