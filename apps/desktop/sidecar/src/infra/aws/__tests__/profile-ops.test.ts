// CRUD profile trên file THẬT (thư mục tạm). Mọi ca đổi `HOME` +
// `AWS_CONFIG_FILE` + `AWS_SHARED_CREDENTIALS_FILE` nên không ca nào chạm
// `~/.aws` hay `~/.awog` của người chạy test — kể cả nhật ký (`recordInfraAction`
// ghi vào `~/.awog/infra-audit`) và bản sao lưu.
//
// Bất biến được đo bằng HASH của dòng secret, không bằng giá trị: đo được rằng
// khoá cũ còn nguyên mà không cần đọc khoá ra biến trong chính bộ test.
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listAwsProfiles } from '../profiles.js'
import { deleteProfile, duplicateProfile, saveProfile } from '../profile-ops.js'
import { awsBackupDir } from '../backup.js'

const FAKE_KEY_ID = 'AKIAIOSFODNN7EXAMPLE'
const FAKE_SECRET = 'wJalrXUtnFEMI-K7MDENG-bPxRfiCYEXAMPLEKEY'
const FAKE_TOKEN = 'IQoJb3JpZ2luX2VjEXAMPLEtoken0000'
const REAL_WORLD_NAME = '229015218011_Offshore-Developer'

let dir = ''
let configPath = ''
let credentialsPath = ''
const savedEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'awog-profile-ops-'))
  await mkdir(join(dir, 'aws'), { recursive: true })
  configPath = join(dir, 'aws', 'config')
  credentialsPath = join(dir, 'aws', 'credentials')
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

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8')
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Hash các dòng khoá của một section — "còn nguyên hay không" mà không đọc giá trị. */
function secretFingerprint(raw: string, section: string): string {
  const lines = raw.split('\n')
  const start = lines.findIndex((l) => l.trim() === `[${section}]`)
  expect(start).toBeGreaterThanOrEqual(0)
  const body: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.trim().startsWith('[')) break
    if (/^\s*aws_/i.test(lines[i]!)) body.push(lines[i]!)
  }
  return createHash('sha256').update(body.join('\n')).digest('hex')
}

const STATIC_INPUT = {
  name: 'dev',
  kind: 'static',
  config: { region: 'ap-southeast-1', output: 'json' },
  secrets: {
    accessKeyId: FAKE_KEY_ID,
    secretAccessKey: FAKE_SECRET,
    sessionToken: FAKE_TOKEN,
  },
  surface: 'settings',
} as const

describe('saveProfile', () => {
  it('writes static keys to credentials and the rest to config', async () => {
    const { profile, backups } = await saveProfile({ ...STATIC_INPUT })

    const creds = await read(credentialsPath)
    expect(creds).toContain('[dev]')
    expect(creds).toContain(`aws_access_key_id = ${FAKE_KEY_ID}`)
    expect(creds).toContain(`aws_secret_access_key = ${FAKE_SECRET}`)
    expect(creds).toContain(`aws_session_token = ${FAKE_TOKEN}`)

    const config = await read(configPath)
    expect(config).toContain('[profile dev]')
    expect(config).toContain('region = ap-southeast-1')
    // Secret KHÔNG được rơi sang file config.
    expect(config).not.toContain(FAKE_SECRET)

    expect(profile.kind).toBe('static')
    expect(profile.hasStaticKeys).toBe(true)
    expect(profile.source).toBe('both')
    // Payload trả về là metadata thuần — không có giá trị khoá nào.
    expect(JSON.stringify(profile)).not.toContain(FAKE_SECRET)
    // File chưa tồn tại trước đó ⇒ không có gì để sao lưu.
    expect(backups).toEqual([])
  })

  it('leaves the secret lines untouched when only the region changes', async () => {
    await saveProfile({ ...STATIC_INPUT })
    const before = secretFingerprint(await read(credentialsPath), 'dev')

    await saveProfile({
      name: 'dev',
      kind: 'static',
      config: { region: 'us-east-1' },
      overwrite: true,
      surface: 'settings',
    })

    expect(secretFingerprint(await read(credentialsPath), 'dev')).toBe(before)
    expect(await read(configPath)).toContain('region = us-east-1')
  })

  it('keeps existing keys when secrets are omitted or blank', async () => {
    await saveProfile({ ...STATIC_INPUT })
    const before = secretFingerprint(await read(credentialsPath), 'dev')

    await saveProfile({
      name: 'dev',
      kind: 'static',
      config: { output: 'text' },
      // Chuỗi rỗng tường minh = "không đổi", không phải "xoá".
      secrets: { accessKeyId: '', secretAccessKey: '  ' },
      overwrite: true,
      surface: 'settings',
    })

    expect(secretFingerprint(await read(credentialsPath), 'dev')).toBe(before)
  })

  it('does not create the credentials file for an SSO profile', async () => {
    const { profile } = await saveProfile({
      name: 'corp-admin',
      kind: 'sso',
      config: {
        sso_session: 'corp',
        sso_account_id: '229015218011',
        sso_role_name: 'Admin',
        region: 'ap-southeast-1',
      },
      surface: 'settings',
    })

    expect(await exists(credentialsPath)).toBe(false)
    expect(profile.kind).toBe('sso')
    expect(profile.source).toBe('config')
  })

  it('writes the default profile as [default], not [profile default]', async () => {
    await saveProfile({
      name: 'default',
      kind: 'assume-role',
      config: { role_arn: 'arn:aws:iam::111122223333:role/Deploy', source_profile: 'dev' },
      surface: 'settings',
    })

    const config = await read(configPath)
    expect(config).toContain('[default]')
    expect(config).not.toContain('[profile default]')
  })

  it('renames the section in both files and leaves no orphan', async () => {
    await saveProfile({ ...STATIC_INPUT })
    const before = secretFingerprint(await read(credentialsPath), 'dev')

    const { profile } = await saveProfile({
      name: REAL_WORLD_NAME,
      previousName: 'dev',
      kind: 'static',
      config: { region: 'ap-southeast-1' },
      surface: 'settings',
    })

    const config = await read(configPath)
    const creds = await read(credentialsPath)
    expect(config).toContain(`[profile ${REAL_WORLD_NAME}]`)
    expect(config).not.toContain('[profile dev]')
    expect(creds).toContain(`[${REAL_WORLD_NAME}]`)
    expect(creds).not.toContain('[dev]')
    expect(secretFingerprint(creds, REAL_WORLD_NAME)).toBe(before)
    expect(profile.name).toBe(REAL_WORLD_NAME)
  })

  it('renames onto an occupied name when overwrite is set', async () => {
    await saveProfile({ ...STATIC_INPUT })
    const before = secretFingerprint(await read(credentialsPath), 'dev')
    await saveProfile({
      name: 'staging',
      kind: 'sso',
      config: { sso_session: 'corp', sso_account_id: '111122223333', sso_role_name: 'Read' },
      surface: 'settings',
    })

    const { profile } = await saveProfile({
      name: 'staging',
      previousName: 'dev',
      kind: 'static',
      config: { region: 'ap-southeast-1' },
      overwrite: true,
      surface: 'settings',
    })

    const config = await read(configPath)
    expect(config).not.toContain('[profile dev]')
    expect(config.match(/\[profile staging\]/g)).toHaveLength(1)
    // Bản SSO cũ bị thay hẳn, không lẫn khoá của hai profile.
    expect(config).not.toContain('sso_role_name = Read')
    expect(secretFingerprint(await read(credentialsPath), 'staging')).toBe(before)
    expect(profile.kind).toBe('static')
  })

  it('preserves comments and keys AWOG does not model', async () => {
    await writeFile(
      configPath,
      [
        '# đừng commit file này',
        '[profile dev]',
        'region = ap-southeast-1',
        'cli_pager =',
        's3 =',
        '  max_concurrent_requests = 20',
        'endpoint_url = https://vpce.example.invalid',
        '',
      ].join('\n'),
      'utf8',
    )

    await saveProfile({
      name: 'dev',
      kind: 'static',
      config: { region: 'us-east-1' },
      overwrite: true,
      surface: 'settings',
    })

    const config = await read(configPath)
    expect(config).toContain('# đừng commit file này')
    expect(config).toContain('cli_pager =')
    expect(config).toContain('  max_concurrent_requests = 20')
    expect(config).toContain('endpoint_url = https://vpce.example.invalid')
    expect(config).toContain('region = us-east-1')
  })

  it('refuses to touch a credential_process profile', async () => {
    await writeFile(
      configPath,
      ['[profile vault]', 'credential_process = /usr/local/bin/vault-aws', ''].join('\n'),
      'utf8',
    )

    await expect(
      saveProfile({
        name: 'vault',
        kind: 'static',
        config: { region: 'us-east-1' },
        surface: 'settings',
      }),
    ).rejects.toThrow(/^PROCESS_READONLY/)

    // Và không ghi được chính khoá đó qua ngả `config`.
    await expect(
      saveProfile({
        name: 'other',
        kind: 'static',
        config: { credential_process: '/bin/sh' },
        surface: 'settings',
      }),
    ).rejects.toThrow(/^PROCESS_READONLY/)
  })

  it('rejects an invalid name and accepts the real-world one', async () => {
    await expect(
      saveProfile({ name: 'has space', kind: 'sso', config: { region: 'x' }, surface: 'settings' }),
    ).rejects.toThrow(/^INVALID_NAME/)

    const { profile } = await saveProfile({
      name: REAL_WORLD_NAME,
      kind: 'sso',
      config: { sso_session: 'corp', sso_account_id: '229015218011', sso_role_name: 'Dev' },
      surface: 'settings',
    })
    expect(profile.name).toBe(REAL_WORLD_NAME)
  })

  it('refuses an existing name without overwrite', async () => {
    await saveProfile({ ...STATIC_INPUT })
    await expect(
      saveProfile({
        name: 'dev',
        kind: 'sso',
        config: { sso_session: 'corp' },
        surface: 'settings',
      }),
    ).rejects.toThrow(/^EXISTS/)
  })

  it('rejects a key outside the allowlist, and secrets on a non-static profile', async () => {
    await expect(
      saveProfile({ name: 'dev', kind: 'sso', config: { evil_key: 'x' }, surface: 'settings' }),
    ).rejects.toThrow(/^UNKNOWN_KEY/)

    await expect(
      saveProfile({
        name: 'dev',
        kind: 'sso',
        config: { sso_session: 'corp' },
        secrets: { secretAccessKey: FAKE_SECRET },
        surface: 'settings',
      }),
    ).rejects.toThrow(/^UNKNOWN_KEY/)
  })

  it('never names a secret value in an error message', async () => {
    const err = await saveProfile({
      name: 'dev',
      kind: 'sso',
      config: { sso_session: 'corp' },
      secrets: { secretAccessKey: FAKE_SECRET },
      surface: 'settings',
    }).catch((e: unknown) => e)

    expect(String(err)).not.toContain(FAKE_SECRET)
  })
})

describe('duplicateProfile', () => {
  it('copies the secret lines verbatim without leaking them', async () => {
    await saveProfile({ ...STATIC_INPUT })
    const before = secretFingerprint(await read(credentialsPath), 'dev')

    const { profile } = await duplicateProfile({ from: 'dev', to: 'dev-copy', surface: 'settings' })

    const creds = await read(credentialsPath)
    expect(secretFingerprint(creds, 'dev-copy')).toBe(before)
    // Bản gốc không suy suyển.
    expect(secretFingerprint(creds, 'dev')).toBe(before)
    expect(await read(configPath)).toContain('[profile dev-copy]')
    expect(profile.hasStaticKeys).toBe(true)
    expect(profile.hasSessionToken).toBe(true)
    expect(JSON.stringify(profile)).not.toContain(FAKE_SECRET)
  })

  it('refuses an existing target without overwrite, and refuses credential_process', async () => {
    await saveProfile({ ...STATIC_INPUT })
    await saveProfile({
      name: 'taken',
      kind: 'sso',
      config: { sso_session: 'corp' },
      surface: 'settings',
    })

    await expect(
      duplicateProfile({ from: 'dev', to: 'taken', surface: 'settings' }),
    ).rejects.toThrow(/^EXISTS/)

    await writeFile(
      configPath,
      `${await read(configPath)}\n[profile vault]\ncredential_process = /usr/local/bin/vault-aws\n`,
      'utf8',
    )
    await expect(
      duplicateProfile({ from: 'vault', to: 'vault-copy', surface: 'settings' }),
    ).rejects.toThrow(/^PROCESS_READONLY/)
  })

  it('reports NOT_FOUND for a missing source', async () => {
    await expect(
      duplicateProfile({ from: 'nope', to: 'copy', surface: 'settings' }),
    ).rejects.toThrow(/^NOT_FOUND/)
  })
})

describe('deleteProfile', () => {
  it('removes the profile from both files and leaves a backup', async () => {
    await saveProfile({ ...STATIC_INPUT })
    await saveProfile({
      name: 'keep',
      kind: 'sso',
      config: { sso_session: 'corp' },
      surface: 'settings',
    })

    const { removedFrom, backups } = await deleteProfile('dev', 'settings')

    expect(removedFrom).toEqual(['config', 'credentials'])
    const config = await read(configPath)
    const creds = await read(credentialsPath)
    expect(config).not.toContain('[profile dev]')
    expect(creds).not.toContain('[dev]')
    expect(creds).not.toContain(FAKE_SECRET)
    // Profile khác còn nguyên.
    expect(config).toContain('[profile keep]')

    expect(backups.length).toBe(2)
    const saved = await readdir(awsBackupDir())
    expect(saved.some((n) => n.startsWith('credentials.'))).toBe(true)
    expect(saved.some((n) => n.startsWith('config.'))).toBe(true)
  })

  it('is a no-op for an unknown profile', async () => {
    const out = await deleteProfile('ghost', 'settings')
    expect(out).toEqual({ removedFrom: [], backups: [] })
    expect(await exists(configPath)).toBe(false)
  })

  it('refuses to delete a credential_process profile', async () => {
    await writeFile(
      configPath,
      ['[profile vault]', 'credential_process = /usr/local/bin/vault-aws', ''].join('\n'),
      'utf8',
    )
    await expect(deleteProfile('vault', 'settings')).rejects.toThrow(/^PROCESS_READONLY/)
  })
})

// ─── Hồi quy: sửa tại chỗ, và dọn khoá khi ĐỔI KIỂU ────────────────────────
//
// Hai lỗ cùng nằm ở `saveProfile` và cùng một gốc: hàm không phân biệt được
// "tôi đang sửa chính profile này" với "tôi đang tạo mới đè lên nó".

describe('sửa tại chỗ (previousName === name)', () => {
  it('KHÔNG ném EXISTS — đó là chính profile đang mở', async () => {
    await saveProfile({ ...STATIC_INPUT })
    const { profile } = await saveProfile({
      name: 'dev',
      previousName: 'dev',
      kind: 'static',
      config: { region: 'us-west-2' },
      surface: 'settings',
    })
    expect(profile.region).toBe('us-west-2')
    // Khoá cũ còn nguyên: "vắng mặt = giữ nguyên".
    expect(await read(credentialsPath)).toContain(`aws_secret_access_key = ${FAKE_SECRET}`)
  })

  it('TẠO MỚI trùng tên vẫn ném EXISTS — hàng rào không bị nới', async () => {
    await saveProfile({ ...STATIC_INPUT })
    await expect(
      saveProfile({
        name: 'dev',
        kind: 'static',
        config: { region: 'us-west-2' },
        secrets: { accessKeyId: FAKE_KEY_ID, secretAccessKey: FAKE_SECRET },
        surface: 'settings',
      }),
    ).rejects.toThrow(/^EXISTS/)
  })

  it('đổi tên vào chỗ đã có người vẫn ném EXISTS khi chưa xác nhận', async () => {
    await saveProfile({ ...STATIC_INPUT })
    await saveProfile({
      name: 'other',
      kind: 'assume-role',
      config: { role_arn: 'arn:aws:iam::111111111111:role/X', source_profile: 'dev' },
      surface: 'settings',
    })
    await expect(
      saveProfile({
        name: 'dev',
        previousName: 'other',
        kind: 'assume-role',
        config: { role_arn: 'arn:aws:iam::111111111111:role/X' },
        surface: 'settings',
      }),
    ).rejects.toThrow(/^EXISTS/)
  })
})

describe('đổi kiểu thì khoá của kiểu cũ phải BIẾN MẤT', () => {
  async function seedStatic(): Promise<void> {
    await saveProfile({ ...STATIC_INPUT })
  }
  async function seedAssumeRole(): Promise<void> {
    await saveProfile({
      name: 'dev',
      kind: 'assume-role',
      config: {
        role_arn: 'arn:aws:iam::111111111111:role/Deploy',
        source_profile: 'base',
        external_id: 'xid-1',
        duration_seconds: '3600',
      },
      surface: 'settings',
    })
  }
  async function seedSso(): Promise<void> {
    await saveProfile({
      name: 'dev',
      kind: 'sso',
      config: { sso_session: 'corp', sso_account_id: '111111111111', sso_role_name: 'Admin' },
      surface: 'settings',
    })
  }

  const SSO_CONFIG = {
    sso_session: 'corp',
    sso_account_id: '222222222222',
    sso_role_name: 'ReadOnly',
  }
  const ROLE_CONFIG = {
    role_arn: 'arn:aws:iam::222222222222:role/Other',
    source_profile: 'base',
  }

  const cases = [
    { from: 'static', to: 'sso', seed: seedStatic, config: SSO_CONFIG },
    { from: 'static', to: 'assume-role', seed: seedStatic, config: ROLE_CONFIG },
    { from: 'assume-role', to: 'sso', seed: seedAssumeRole, config: SSO_CONFIG },
    { from: 'assume-role', to: 'static', seed: seedAssumeRole, config: { region: 'us-east-1' } },
    { from: 'sso', to: 'assume-role', seed: seedSso, config: ROLE_CONFIG },
    { from: 'sso', to: 'static', seed: seedSso, config: { region: 'us-east-1' } },
  ] as const

  for (const c of cases) {
    it(`${c.from} → ${c.to}: không còn khoá lạc hậu`, async () => {
      await c.seed()
      await saveProfile({
        name: 'dev',
        previousName: 'dev',
        kind: c.to,
        config: c.config,
        ...(c.to === 'static'
          ? { secrets: { accessKeyId: FAKE_KEY_ID, secretAccessKey: FAKE_SECRET } }
          : {}),
        surface: 'settings',
      })

      const config = await read(configPath)
      const creds = (await exists(credentialsPath)) ? await read(credentialsPath) : ''

      if (c.to !== 'sso') {
        for (const key of ['sso_start_url', 'sso_account_id', 'sso_role_name', 'sso_session']) {
          expect(config).not.toContain(key)
        }
      }
      if (c.to !== 'assume-role') {
        for (const key of ['role_arn', 'source_profile', 'external_id', 'duration_seconds']) {
          expect(config).not.toContain(key)
        }
      }
      if (c.to !== 'static') {
        // ĐÂY là cái lỗ: profile hiện "SSO" mà botocore vẫn dùng khoá dài hạn cũ.
        expect(creds).not.toContain(FAKE_SECRET)
        expect(creds).not.toContain(FAKE_KEY_ID)
        expect(creds).not.toContain(FAKE_TOKEN)
      }
    })
  }

  it('KHÔNG dọn gì khi kiểu không đổi', async () => {
    await seedAssumeRole()
    await saveProfile({
      name: 'dev',
      previousName: 'dev',
      kind: 'assume-role',
      config: { region: 'eu-west-1' },
      surface: 'settings',
    })
    const config = await read(configPath)
    expect(config).toContain('role_arn = arn:aws:iam::111111111111:role/Deploy')
    expect(config).toContain('external_id = xid-1')
    expect(config).toContain('region = eu-west-1')
  })

  it('đổi tên + đổi kiểu cùng lúc: khoá cũ không theo sang tên mới', async () => {
    await saveProfile({ ...STATIC_INPUT })
    await saveProfile({
      name: 'dev-sso',
      previousName: 'dev',
      kind: 'sso',
      config: { sso_session: 'corp', sso_account_id: '111111111111', sso_role_name: 'Admin' },
      surface: 'settings',
    })
    const creds = await read(credentialsPath)
    expect(creds).not.toContain(FAKE_SECRET)
    expect(creds).not.toContain('[dev]')
    const config = await read(configPath)
    expect(config).toContain('[profile dev-sso]')
    expect(config).toContain('sso_session = corp')
  })
})

describe('profile đăng nhập Console (`aws login`)', () => {
  const LOGIN_ARN = 'arn:aws:iam::797859922771:root'

  /** Đúng thứ `console-login.ts` ghi xuống: `login_session` + `region`, không secret. */
  async function seedLogin(name = 'console'): Promise<void> {
    await writeFile(
      configPath,
      `[default]\nregion = ap-northeast-1\n\n[profile ${name}]\nlogin_session = ${LOGIN_ARN}\nregion = ap-southeast-2\n`,
      { mode: 0o600 },
    )
  }

  it('đổi tên: section đổi tên, login_session giữ nguyên và không nhân bản', async () => {
    await seedLogin('console')
    const { profile } = await saveProfile({
      name: 'hoatq.dev',
      previousName: 'console',
      kind: 'login',
      config: {},
      surface: 'settings',
    })

    const config = await read(configPath)
    expect(config).toContain('[profile hoatq.dev]')
    expect(config).not.toContain('[profile console]')
    expect(config).toContain(`login_session = ${LOGIN_ARN}`)
    expect(config).toContain('region = ap-southeast-2')
    // ĐÂY là bất biến của ca thật 2026-09-14: đổi tên KHÔNG được sinh thêm một
    // định danh phiên thứ hai (người dùng đã có 2 profile cho cùng tài khoản).
    expect(config.match(/login_session/g)).toHaveLength(1)
    expect(profile.kind).toBe('login')
    expect(profile.loginSession).toBe(LOGIN_ARN)
  })

  it('đổi region: chỉ region đổi, phiên còn nguyên', async () => {
    await seedLogin('console')
    await saveProfile({
      name: 'console',
      previousName: 'console',
      kind: 'login',
      config: { region: 'ap-southeast-1' },
      surface: 'settings',
    })
    const config = await read(configPath)
    expect(config).toContain('region = ap-southeast-1')
    expect(config).toContain(`login_session = ${LOGIN_ARN}`)
  })

  it('TẠO MỚI một profile login bằng form bị từ chối', async () => {
    await expect(
      saveProfile({ name: 'console', kind: 'login', config: {}, surface: 'settings' }),
    ).rejects.toThrow(/^LOGIN_READONLY/)
  })

  it('đổi kiểu khỏi login bị từ chối (khoá dài hạn không được lặng lẽ thay phiên)', async () => {
    await seedLogin('console')
    await expect(
      saveProfile({
        name: 'console',
        previousName: 'console',
        kind: 'static',
        config: { region: 'us-east-1' },
        secrets: { accessKeyId: FAKE_KEY_ID, secretAccessKey: FAKE_SECRET },
        surface: 'settings',
      }),
    ).rejects.toThrow(/^LOGIN_READONLY/)

    const config = await read(configPath)
    expect(config).toContain('login_session')
  })

  it('ghi đè một profile login bằng kiểu khác cũng bị từ chối', async () => {
    await seedLogin('console')
    await expect(
      saveProfile({
        name: 'console',
        kind: 'assume-role',
        config: { role_arn: 'arn:aws:iam::111111111111:role/Deploy', source_profile: 'base' },
        overwrite: true,
        surface: 'settings',
      }),
    ).rejects.toThrow(/^LOGIN_READONLY/)
  })

  it('không nhận `login_session` từ payload (chỉ console-login.ts được sinh ra nó)', async () => {
    await seedLogin('console')
    await expect(
      saveProfile({
        name: 'console',
        previousName: 'console',
        kind: 'login',
        config: { login_session: 'arn:aws:iam::111111111111:root' },
        surface: 'settings',
      }),
    ).rejects.toThrow(/^LOGIN_READONLY/)

    const config = await read(configPath)
    expect(config).toContain(`login_session = ${LOGIN_ARN}`)
  })

  it('nhân bản một profile login bị từ chối (bản sao dùng chung một phiên)', async () => {
    await seedLogin('console')
    await expect(duplicateProfile({ from: 'console', to: 'console-copy', surface: 'settings' })).rejects.toThrow(
      /^LOGIN_READONLY/,
    )
    const config = await read(configPath)
    expect(config).not.toContain('console-copy')
  })

  it('listAwsProfiles lộ login_session để UI biết phiên nào là phiên nào', async () => {
    await seedLogin('console')
    const profile = (await listAwsProfiles()).find((p) => p.name === 'console')
    expect(profile?.kind).toBe('login')
    expect(profile?.loginSession).toBe(LOGIN_ARN)
    // Và KHÔNG có gì khác của profile này bị lộ ra ngoài hai field đó.
    expect(JSON.stringify(profile)).not.toContain('secret')
  })
})

describe('audit trail', () => {
  it('records every write without any secret value', async () => {
    await saveProfile({ ...STATIC_INPUT })
    await deleteProfile('dev', 'settings')

    const auditDir = join(dir, '.awog', 'infra-audit')
    const files = await readdir(auditDir)
    expect(files.length).toBeGreaterThan(0)
    const raw = await read(join(auditDir, files[0]!))
    expect(raw).toContain('profile_save')
    expect(raw).toContain('profile_delete')
    expect(raw).toContain('"actor":"human"')
    expect(raw).not.toContain(FAKE_SECRET)
    expect(raw).not.toContain(FAKE_TOKEN)
    expect(raw).not.toContain(FAKE_KEY_ID)
  })
})
