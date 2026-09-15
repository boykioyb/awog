// A7 — gom nguồn SSO máy đã biết.
//
// Không ca nào chạm `~/.aws` thật: mỗi ca dựng một thư mục tạm rồi trỏ `HOME` +
// `AWS_CONFIG_FILE` + `AWS_SHARED_CREDENTIALS_FILE` vào đó. Không ca nào spawn
// `aws` — module này chỉ đọc file.
//
// Ca quan trọng nhất của file này là "token không có mặt trong kết quả": thư mục
// cache chứa credential sống, và cả tính năng đứng hay đổ ở chỗ đó.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listSsoSources, safeUrlLabel } from '../sso-sources.js'

const TOKEN = 'aoaAAAAAEXAMPLEsso-access-token-value'
const REFRESH_TOKEN = 'aorAAAAAEXAMPLEsso-refresh-token-value'
const START_URL = 'https://corp.awsapps.com/start'

let dir = ''
let configPath = ''
let credentialsPath = ''
let cacheDir = ''
const savedEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'awog-sso-sources-'))
  await mkdir(join(dir, 'aws'), { recursive: true })
  configPath = join(dir, 'aws', 'config')
  credentialsPath = join(dir, 'aws', 'credentials')
  cacheDir = join(dir, 'aws', 'sso', 'cache')
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

function inSeconds(s: number): string {
  return new Date(Date.now() + s * 1000).toISOString()
}

async function writeConfig(body: string): Promise<void> {
  await writeFile(configPath, body, 'utf8')
}

async function writeCacheFile(name: string, body: Record<string, unknown>): Promise<void> {
  await mkdir(cacheDir, { recursive: true })
  await writeFile(join(cacheDir, `${name}.json`), JSON.stringify(body), { mode: 0o600 })
}

// ─── Từng nguồn một ─────────────────────────────────────────────────────────

describe('listSsoSources — từng nguồn', () => {
  it('không có gì ⇒ mảng rỗng, không ném', async () => {
    await expect(listSsoSources()).resolves.toEqual([])
  })

  it('chỉ có block [sso-session]', async () => {
    await writeConfig(
      `[sso-session corp]\nsso_start_url = ${START_URL}\nsso_region = ap-southeast-1\n`,
    )
    const sources = await listSsoSources()
    expect(sources).toEqual([
      {
        sessionName: 'corp',
        startUrl: START_URL,
        ssoRegion: 'ap-southeast-1',
        origin: 'sso-session',
        hasLiveToken: false,
        profileCount: 0,
      },
    ])
  })

  it('chỉ có profile SSO kiểu cũ ⇒ origin profile + đếm profile + region từ chính section', async () => {
    await writeConfig(
      `[profile dev]\nsso_start_url = ${START_URL}\nsso_region = us-east-1\n` +
        `sso_account_id = 111122223333\nsso_role_name = ReadOnly\n\n` +
        `[profile stg]\nsso_start_url = ${START_URL}\nsso_region = us-east-1\n` +
        `sso_account_id = 444455556666\nsso_role_name = ReadOnly\n`,
    )
    const sources = await listSsoSources()
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      startUrl: START_URL,
      ssoRegion: 'us-east-1',
      origin: 'profile',
      hasLiveToken: false,
      profileCount: 2,
    })
    // Profile kiểu cũ không có `sso_session` ⇒ không bịa tên session ra.
    expect(sources[0]?.sessionName).toBeUndefined()
  })

  it('chỉ có cache ⇒ origin cache, region lấy từ file cache', async () => {
    await writeCacheFile('abc123', {
      startUrl: START_URL,
      region: 'ap-southeast-1',
      accessToken: TOKEN,
      expiresAt: inHours(4),
    })
    const sources = await listSsoSources()
    expect(sources).toEqual([
      {
        startUrl: START_URL,
        ssoRegion: 'ap-southeast-1',
        origin: 'cache',
        hasLiveToken: true,
        profileCount: 0,
      },
    ])
  })
})

// ─── Gộp ────────────────────────────────────────────────────────────────────

describe('listSsoSources — gộp theo startUrl', () => {
  it('cả ba nguồn cùng một startUrl ⇒ MỘT entry, origin lấy hạng cao nhất', async () => {
    await writeConfig(
      `[sso-session corp]\nsso_start_url = ${START_URL}\nsso_region = ap-southeast-1\n\n` +
        `[profile dev]\nsso_session = corp\nsso_account_id = 111122223333\nsso_role_name = ReadOnly\n`,
    )
    await writeCacheFile('abc123', {
      startUrl: START_URL,
      region: 'ap-southeast-1',
      accessToken: TOKEN,
      expiresAt: inHours(4),
    })

    const sources = await listSsoSources()
    expect(sources).toEqual([
      {
        sessionName: 'corp',
        startUrl: START_URL,
        ssoRegion: 'ap-southeast-1',
        // `sso-session` > `profile` > `cache`
        origin: 'sso-session',
        // OR của mọi nguồn: cache còn token ⇒ bỏ qua được bước đăng nhập.
        hasLiveToken: true,
        profileCount: 1,
      },
    ])
  })

  it('startUrl có và không có `/` cuối ⇒ vẫn là một nguồn', async () => {
    await writeConfig(`[sso-session corp]\nsso_start_url = ${START_URL}/\nsso_region = us-east-1\n`)
    await writeCacheFile('abc123', {
      startUrl: START_URL,
      accessToken: TOKEN,
      expiresAt: inHours(4),
    })
    const sources = await listSsoSources()
    expect(sources).toHaveLength(1)
    expect(sources[0]?.startUrl).toBe(START_URL)
    expect(sources[0]?.hasLiveToken).toBe(true)
  })

  it('host khác hoa/thường vẫn gộp; startUrl khác hẳn thì tách và xếp đúng', async () => {
    await writeConfig(
      `[sso-session corp]\nsso_start_url = https://CORP.awsapps.com/start\n\n` +
        `[sso-session other]\nsso_start_url = https://other.awsapps.com/start\n\n` +
        `[profile a]\nsso_session = other\nsso_account_id = 111122223333\nsso_role_name = R\n`,
    )
    await writeCacheFile('abc123', {
      startUrl: START_URL,
      accessToken: TOKEN,
      expiresAt: inHours(4),
    })

    const sources = await listSsoSources()
    expect(sources.map((s) => s.startUrl)).toEqual([
      // Có token sống xếp trước, dù bên kia có nhiều profile hơn.
      START_URL,
      'https://other.awsapps.com/start',
    ])
    expect(sources[0]?.hasLiveToken).toBe(true)
    expect(sources[1]?.profileCount).toBe(1)
  })
})

// ─── Cache: hàng xóm lạ, hết hạn, và SECRET ─────────────────────────────────

describe('listSsoSources — thư mục cache là nhà chung', () => {
  it('file kiểu kiro-auth-token.json (không có startUrl) ⇒ bỏ qua, không ném', async () => {
    await writeCacheFile('kiro-auth-token', {
      accessToken: TOKEN,
      refreshToken: REFRESH_TOKEN,
      profileArn: 'arn:aws:codewhisperer:us-east-1:000000000000:profile/ABC',
      expiresAt: inHours(4),
      authMethod: 'social',
      provider: 'kiro',
    })
    await expect(listSsoSources()).resolves.toEqual([])
  })

  it('JSON hỏng / file không phải .json ⇒ bỏ qua, không làm chết cả danh sách', async () => {
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, 'broken.json'), '{ not json', 'utf8')
    await writeFile(join(cacheDir, 'notes.txt'), 'ignore me', 'utf8')
    await writeCacheFile('good', {
      startUrl: START_URL,
      accessToken: TOKEN,
      expiresAt: inHours(4),
    })
    const sources = await listSsoSources()
    expect(sources).toHaveLength(1)
    expect(sources[0]?.hasLiveToken).toBe(true)
  })

  it('token hết hạn ⇒ hasLiveToken false (nguồn vẫn còn, chỉ là phải đăng nhập lại)', async () => {
    await writeCacheFile('abc123', {
      startUrl: START_URL,
      accessToken: TOKEN,
      expiresAt: inHours(-1),
    })
    const sources = await listSsoSources()
    expect(sources).toHaveLength(1)
    expect(sources[0]?.hasLiveToken).toBe(false)
  })

  it('còn 30s ⇒ cũng false (biên an toàn 60s)', async () => {
    await writeCacheFile('abc123', {
      startUrl: START_URL,
      accessToken: TOKEN,
      expiresAt: inSeconds(30),
    })
    const sources = await listSsoSources()
    expect(sources[0]?.hasLiveToken).toBe(false)
  })

  it('TOKEN KHÔNG CÓ MẶT trong kết quả', async () => {
    await writeConfig(`[sso-session corp]\nsso_start_url = ${START_URL}\nsso_region = us-east-1\n`)
    await writeCacheFile('abc123', {
      startUrl: START_URL,
      region: 'us-east-1',
      accessToken: TOKEN,
      refreshToken: REFRESH_TOKEN,
      clientId: 'client-id-value',
      clientSecret: 'client-secret-value',
      expiresAt: inHours(4),
    })
    await writeCacheFile('kiro-auth-token', {
      accessToken: `${TOKEN}-kiro`,
      refreshToken: REFRESH_TOKEN,
      expiresAt: inHours(4),
    })

    const result = await listSsoSources()
    expect(result[0]?.hasLiveToken).toBe(true)

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(TOKEN)
    expect(serialized).not.toContain(REFRESH_TOKEN)
    expect(serialized).not.toContain('client-secret-value')
    expect(serialized).not.toContain('accessToken')
    expect(serialized).not.toContain('refreshToken')
  })
})

// ─── Validate biên (L1) ─────────────────────────────────────────────────────

describe('listSsoSources — start URL là dữ liệu L1', () => {
  it('http:// và URL nhúng credential bị loại', async () => {
    await writeConfig(
      `[sso-session plain]\nsso_start_url = http://corp.awsapps.com/start\n\n` +
        `[sso-session creds]\nsso_start_url = https://u:p@corp.awsapps.com/start\n\n` +
        `[sso-session junk]\nsso_start_url = corp.awsapps.com/start\n`,
    )
    await expect(listSsoSources()).resolves.toEqual([])
  })

  it('cache mang startUrl không hợp lệ cũng bị loại', async () => {
    await writeCacheFile('abc123', {
      startUrl: 'http://corp.awsapps.com/start',
      accessToken: TOKEN,
      expiresAt: inHours(4),
    })
    await expect(listSsoSources()).resolves.toEqual([])
  })

  it('sso_region rác bị bỏ chứ không đi tiếp vào cấu hình', async () => {
    await writeConfig(
      `[sso-session corp]\nsso_start_url = ${START_URL}\nsso_region = Not A Region!\n`,
    )
    const sources = await listSsoSources()
    expect(sources[0]?.ssoRegion).toBeUndefined()
  })
})

// ─── Nhãn log ───────────────────────────────────────────────────────────────

describe('safeUrlLabel', () => {
  it('cắt userinfo trước khi chuỗi chạm log', () => {
    // Lý do bị loại có thể LÀ mật khẩu — nên nó không được đi nguyên văn vào log.
    expect(safeUrlLabel('https://u:p@corp.awsapps.com/start')).toBe('https://***@corp.awsapps.com/start')
    expect(safeUrlLabel('  u:p@corp.awsapps.com/start ')).toBe('***@corp.awsapps.com/start')
  })

  it('URL bình thường giữ nguyên, chuỗi dài bị cắt ngắn', () => {
    expect(safeUrlLabel(`  ${START_URL}  `)).toBe(START_URL)
    expect(safeUrlLabel('corp.awsapps.com/start')).toBe('corp.awsapps.com/start')
    expect(safeUrlLabel(`https://corp.awsapps.com/${'x'.repeat(400)}`)).toHaveLength(120)
  })
})
