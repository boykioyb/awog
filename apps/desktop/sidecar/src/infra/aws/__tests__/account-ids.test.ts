// A8 — account id theo profile.
//
// Thứ đáng đo ở đây KHÔNG phải "gọi STS có ra đúng id không" (đó là việc của
// AWS) mà là **khi nào AWOG được phép gọi mạng** và **khi nào một id nhớ sẵn
// còn đáng tin**. Cả hai đều hạ hoặc giữ hàng rào của ma trận quyền
// (`accountKindOf`: vắng accountId ⇒ production), nên chúng phải có test.
//
// `runInfra` bị mock — KHÔNG ca nào spawn `aws` thật. Ca nào chạm đĩa đều đổi
// `HOME` + `AWS_CONFIG_FILE` + `AWS_SHARED_CREDENTIALS_FILE` sang thư mục tạm.
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `vi.hoisted` chứ không phải `const … = vi.fn()` trần: factory của `vi.mock`
// được kéo lên trên mọi import, nên một biến khai bằng `const` ở thân file vẫn
// đang trong vùng chết khi factory chạy.
const { runInfra } = vi.hoisted(() => ({ runInfra: vi.fn() }))
vi.mock('../../run.js', () => ({ runInfra }))

import {
  awsFilesStamp,
  forgetAccountIds,
  listAccountIds,
  profileFingerprint,
  resolveAccountIds,
} from '../account-ids.js'
import { listAwsProfiles, type AwsProfile } from '../profiles.js'

const ACCOUNT_A = '111122223333'
const ACCOUNT_B = '444455556666'

let dir = ''
let configPath = ''
let credentialsPath = ''
let cachePath = ''
const savedEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  runInfra.mockReset()
  dir = await mkdtemp(join(tmpdir(), 'awog-account-ids-'))
  await mkdir(join(dir, 'aws'), { recursive: true })
  configPath = join(dir, 'aws', 'config')
  credentialsPath = join(dir, 'aws', 'credentials')
  cachePath = join(dir, '.awog', 'infra', 'account-ids.json')
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

async function writeConfig(body: string): Promise<void> {
  await writeFile(configPath, body, { mode: 0o600 })
}

async function writeCredentials(body: string): Promise<void> {
  await writeFile(credentialsPath, body, { mode: 0o600 })
}

type RawCacheEntry = {
  profile: string
  accountId: string
  arn?: string
  at: string
  origin: 'config' | 'sts'
  fp: string
}

async function writeCacheRaw(body: string): Promise<void> {
  await mkdir(join(dir, '.awog', 'infra'), { recursive: true, mode: 0o700 })
  await writeFile(cachePath, body, { mode: 0o600 })
}

async function writeCache(entries: RawCacheEntry[]): Promise<void> {
  await writeCacheRaw(JSON.stringify({ version: 1, entries }, null, 2))
}

async function readCacheEntries(): Promise<RawCacheEntry[]> {
  const parsed: unknown = JSON.parse(await readFile(cachePath, 'utf8'))
  return (parsed as { entries: RawCacheEntry[] }).entries
}

async function profileNamed(name: string): Promise<AwsProfile> {
  const found = (await listAwsProfiles()).find((p) => p.name === name)
  if (!found) throw new Error(`test setup: no profile ${name}`)
  return found
}

// Vân tay cần stamp của hai file `~/.aws` (metadata, không phải nội dung) — đo
// tại đúng thời điểm test gọi, giống hệt cách code thật đo.
async function fpOf(name: string): Promise<string> {
  return profileFingerprint(await profileNamed(name), await awsFilesStamp())
}

function identityOk(account: string, arn: string): {
  ok: true
  exitCode: 0
  stdout: string
  stderr: string
  durationMs: number
  truncated: false
  class: 'read'
} {
  return {
    ok: true,
    exitCode: 0,
    stdout: JSON.stringify({ Account: account, Arn: arn, UserId: 'AIDAEXAMPLE' }),
    stderr: '',
    durationMs: 5,
    truncated: false,
    class: 'read',
  }
}

function identityFail(stderr: string): {
  ok: false
  exitCode: 255
  stdout: string
  stderr: string
  durationMs: number
  truncated: false
  class: 'read'
} {
  return { ok: false, exitCode: 255, stdout: '', stderr, durationMs: 5, truncated: false, class: 'read' }
}

const STATIC_CONFIG = '[profile dev]\nregion = ap-southeast-1\n'
const STATIC_CREDENTIALS = '[dev]\naws_access_key_id = AKIAEXAMPLE\naws_secret_access_key = s3cret\n'

// ─── listAccountIds: profile SSO là nguồn miễn phí ──────────────────────────

describe('listAccountIds', () => {
  it('lấy id của profile SSO thẳng từ config và KHÔNG gọi lệnh nào', async () => {
    await writeConfig(
      `[profile sso-dev]\nsso_start_url = https://corp.awsapps.com/start\nsso_region = us-east-1\n` +
        `sso_account_id = ${ACCOUNT_A}\nsso_role_name = Dev\n`,
    )

    const entries = await listAccountIds()

    expect(entries).toEqual([
      { profile: 'sso-dev', accountId: ACCOUNT_A, at: expect.any(String), origin: 'config' },
    ])
    // Bằng chứng "không gọi mạng": không một lời gọi runInfra nào.
    expect(runInfra).not.toHaveBeenCalled()
  })

  it('trả entry cache hợp lệ cho profile static', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    await writeCache([
      {
        profile: 'dev',
        accountId: ACCOUNT_B,
        arn: 'arn:aws:iam::444455556666:user/dev',
        at: new Date().toISOString(),
        origin: 'sts',
        fp: await fpOf('dev'),
      },
    ])

    const entries = await listAccountIds()

    expect(entries).toEqual([
      {
        profile: 'dev',
        accountId: ACCOUNT_B,
        arn: 'arn:aws:iam::444455556666:user/dev',
        at: expect.any(String),
        origin: 'sts',
      },
    ])
    expect(runInfra).not.toHaveBeenCalled()
  })

  it('BỎ QUA entry lệch vân tay — profile vừa đổi cấu hình thì id cũ có thể sai', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    await writeCache([
      {
        profile: 'dev',
        accountId: ACCOUNT_B,
        at: new Date().toISOString(),
        origin: 'sts',
        fp: 'f'.repeat(64),
      },
    ])

    expect(await listAccountIds()).toEqual([])
  })

  // 7 ngày, không phải 30 (audit #2): hạn dùng là hàng rào cuối cho những thay
  // đổi vân tay không nhìn thấy được.
  it('BỎ QUA entry quá hạn 7 ngày', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    await writeCache([
      {
        profile: 'dev',
        accountId: ACCOUNT_B,
        at: new Date(Date.now() - 8 * 24 * 3600_000).toISOString(),
        origin: 'sts',
        fp: await fpOf('dev'),
      },
    ])

    expect(await listAccountIds()).toEqual([])
  })

  it('vân tay đổi khi profile đổi role — cùng tên, cấu hình khác ⇒ vân tay khác', async () => {
    await writeConfig('[profile r]\nrole_arn = arn:aws:iam::111122223333:role/A\nsource_profile = dev\n')
    const before = await fpOf('r')
    await writeConfig('[profile r]\nrole_arn = arn:aws:iam::444455556666:role/B\nsource_profile = dev\n')
    const after = await fpOf('r')

    expect(after).not.toBe(before)
  })

  it('cache hỏng / JSON lỗi ⇒ rỗng, KHÔNG ném', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)

    await writeCacheRaw('{ this is not json')
    expect(await listAccountIds()).toEqual([])

    await writeCacheRaw(JSON.stringify({ version: 1, entries: 'nope' }))
    expect(await listAccountIds()).toEqual([])
  })

  it('entry méo bị bỏ, entry lành bên cạnh vẫn được giữ', async () => {
    await writeConfig(`${STATIC_CONFIG}[profile ops]\nregion = us-east-1\n`)
    await writeCredentials(
      `${STATIC_CREDENTIALS}[ops]\naws_access_key_id = AKIAOPS\naws_secret_access_key = s3cret\n`,
    )
    const devFp = await fpOf('dev')
    const opsFp = await fpOf('ops')
    await writeCacheRaw(
      JSON.stringify({
        version: 1,
        entries: [
          // `accountId` không phải 12 chữ số ⇒ méo.
          { profile: 'dev', accountId: 'nope', at: new Date().toISOString(), origin: 'sts', fp: devFp },
          { profile: 'ops', accountId: ACCOUNT_A, at: new Date().toISOString(), origin: 'sts', fp: opsFp },
        ],
      }),
    )

    const entries = await listAccountIds()
    expect(entries.map((e) => e.profile)).toEqual(['ops'])
  })

  it('profile biến mất khỏi ~/.aws ⇒ không được trả về', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    const fresh = new Date().toISOString()
    await writeCache([
      { profile: 'dev', accountId: ACCOUNT_B, at: fresh, origin: 'sts', fp: await fpOf('dev') },
      { profile: 'gone', accountId: ACCOUNT_A, at: fresh, origin: 'sts', fp: 'a'.repeat(64) },
    ])

    const entries = await listAccountIds()

    expect(entries.map((e) => e.profile)).toEqual(['dev'])
  })

  // Audit #2: `infra.account-ids` tự khai là CHỈ ĐỌC, mà UI gọi nó trong
  // onMounted. Một method chỉ đọc không được ghi đĩa sau lưng người gọi — entry
  // chết bị LỌC trong bộ nhớ, và chỉ đường người dùng bấm mới dọn file.
  it('đường ĐỌC không chạm đĩa — file cache y nguyên sau listAccountIds()', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    await writeCache([
      {
        profile: 'gone',
        accountId: ACCOUNT_A,
        at: new Date(Date.now() - 8 * 24 * 3600_000).toISOString(),
        origin: 'sts',
        fp: 'a'.repeat(64),
      },
    ])
    const before = await readFile(cachePath, 'utf8')
    const beforeStat = await stat(cachePath)

    expect(await listAccountIds()).toEqual([])

    expect(await readFile(cachePath, 'utf8')).toBe(before)
    expect((await stat(cachePath)).mtimeMs).toBe(beforeStat.mtimeMs)
  })

  // Audit #2 — UI (`utils/aws-profile-view.ts` accountIdOfProfile) vẫn suy account
  // id từ `role_arn`, nên nếu sidecar KHÔNG suy thì hai phía bất đồng về câu "đã
  // biết account id chưa": UI không bao giờ hiện nút điền cho nhóm assume-role,
  // còn cache phía sidecar mãi rỗng cho đúng nhóm đó.
  it('assume-role ⇒ lấy account id từ role_arn, origin config, KHÔNG gọi mạng', async () => {
    await writeConfig(
      `[profile r]\nrole_arn = arn:aws:iam::${ACCOUNT_A}:role/Admin\nsource_profile = dev\n`,
    )

    const entries = await listAccountIds()

    expect(entries).toEqual([
      { profile: 'r', accountId: ACCOUNT_A, at: expect.any(String), origin: 'config' },
    ])
    expect(runInfra).not.toHaveBeenCalled()
  })

  // Audit #2 — vân tay cố ý mù với GIÁ TRỊ khoá (invariant #1), nên nó phải bắt
  // được qua METADATA của file: đổi khoá static sang tài khoản khác mà id cũ vẫn
  // sống là nới quyền nhầm chỗ.
  it('sửa ~/.aws/credentials ⇒ entry static cũ hết hợp lệ', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    await writeCache([
      {
        profile: 'dev',
        accountId: ACCOUNT_B,
        at: new Date().toISOString(),
        origin: 'sts',
        fp: await fpOf('dev'),
      },
    ])
    expect((await listAccountIds()).map((e) => e.accountId)).toEqual([ACCOUNT_B])

    // Cùng hình dạng profile (vẫn `hasStaticKeys`), khoá KHÁC — trước bản vá thì
    // vân tay y nguyên và id của tài khoản cũ vẫn được coi là hợp lệ.
    await writeCredentials(
      '[dev]\naws_access_key_id = AKIAOTHERACCOUNT\naws_secret_access_key = another-s3cret-value\n',
    )

    expect(await listAccountIds()).toEqual([])
  })
})

// ─── resolveAccountIds: biên + mạng ─────────────────────────────────────────

describe('resolveAccountIds', () => {
  it('từ chối tên sai regex và danh sách quá trần — trước khi gọi bất cứ gì', async () => {
    await expect(resolveAccountIds({ names: ['bad name!'] })).rejects.toThrow(/INVALID_NAME/)
    await expect(
      resolveAccountIds({ names: Array.from({ length: 51 }, (_, i) => `p${String(i)}`) }),
    ).rejects.toThrow(/TOO_MANY/)
    expect(runInfra).not.toHaveBeenCalled()
  })

  it('profile SSO ⇒ origin config, KHÔNG gọi STS', async () => {
    await writeConfig(
      `[profile sso-dev]\nsso_start_url = https://corp.awsapps.com/start\n` +
        `sso_account_id = ${ACCOUNT_A}\nsso_role_name = Dev\n`,
    )

    const out = await resolveAccountIds({ names: ['sso-dev'] })

    expect(out.entries).toEqual([
      { profile: 'sso-dev', accountId: ACCOUNT_A, at: expect.any(String), origin: 'config' },
    ])
    expect(out.failures).toEqual([])
    expect(runInfra).not.toHaveBeenCalled()
  })

  it('profile static ⇒ gọi STS qua runInfra, argv KHÔNG tự mang --profile/--region', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    runInfra.mockResolvedValue(identityOk(ACCOUNT_B, 'arn:aws:iam::444455556666:user/dev'))

    const out = await resolveAccountIds({ names: ['dev'] })

    expect(out.entries).toEqual([
      {
        profile: 'dev',
        accountId: ACCOUNT_B,
        arn: 'arn:aws:iam::444455556666:user/dev',
        at: expect.any(String),
        origin: 'sts',
      },
    ])
    const req = runInfra.mock.calls[0]?.[0] as {
      args: string[]
      context: { profile?: string; region?: string }
      actor: string
      decision: string
    }
    expect(req.args).toEqual(['sts', 'get-caller-identity', '--output', 'json'])
    expect(req.args).not.toContain('--profile')
    expect(req.args).not.toContain('--region')
    expect(req.context).toEqual({ profile: 'dev', region: 'ap-southeast-1' })
    expect(req.actor).toBe('human')
    expect(req.decision).toBe('approved')
  })

  it('một profile hỏng ⇒ vào failures, profile còn lại vẫn có kết quả', async () => {
    await writeConfig(`${STATIC_CONFIG}[profile ops]\nregion = us-east-1\n`)
    await writeCredentials(
      `${STATIC_CREDENTIALS}[ops]\naws_access_key_id = AKIAOPS\naws_secret_access_key = s3cret\n`,
    )
    runInfra.mockImplementation((req: { context: { profile?: string } }) =>
      Promise.resolve(
        req.context.profile === 'dev'
          ? identityFail('ExpiredToken: The security token included in the request is expired')
          : identityOk(ACCOUNT_A, 'arn:aws:iam::111122223333:user/ops'),
      ),
    )

    const out = await resolveAccountIds({ names: ['dev', 'ops'] })

    expect(out.entries.map((e) => e.profile)).toEqual(['ops'])
    expect(out.failures).toEqual([{ profile: 'dev', error: expect.stringContaining('ExpiredToken') }])
  })

  it('profile không tồn tại ⇒ failures, không gọi lệnh cho nó', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)

    const out = await resolveAccountIds({ names: ['ghost'] })

    expect(out.entries).toEqual([])
    expect(out.failures).toEqual([{ profile: 'ghost', error: 'Profile not found in ~/.aws' }])
    expect(runInfra).not.toHaveBeenCalled()
  })

  it('output không phải JSON của sts ⇒ failure, không ghi cache', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    runInfra.mockResolvedValue({ ...identityOk(ACCOUNT_B, 'arn:x'), stdout: 'not json' })

    const out = await resolveAccountIds({ names: ['dev'] })

    expect(out.entries).toEqual([])
    expect(out.failures[0]?.profile).toBe('dev')
    await expect(stat(cachePath)).rejects.toThrow()
  })

  it('kết quả STS được ghi cache kèm vân tay, và lần đọc sau lấy lại được', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    runInfra.mockResolvedValue(identityOk(ACCOUNT_B, 'arn:aws:iam::444455556666:user/dev'))

    await resolveAccountIds({ names: ['dev'] })

    const cached = await readCacheEntries()
    expect(cached).toEqual([
      {
        profile: 'dev',
        accountId: ACCOUNT_B,
        arn: 'arn:aws:iam::444455556666:user/dev',
        at: expect.any(String),
        origin: 'sts',
        fp: await fpOf('dev'),
      },
    ])

    runInfra.mockReset()
    const entries = await listAccountIds()
    expect(entries.map((e) => e.accountId)).toEqual([ACCOUNT_B])
    expect(runInfra).not.toHaveBeenCalled()
  })

  // Đường đọc không còn dọn cache (nó phải THUẦN đọc), nên đường ghi phải dọn —
  // nếu không, file chỉ có lớn lên theo mỗi profile từng bị xoá.
  it('lần ghi cache dọn luôn entry của profile đã biến mất', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    await writeCache([
      {
        profile: 'gone',
        accountId: ACCOUNT_A,
        at: new Date().toISOString(),
        origin: 'sts',
        fp: 'a'.repeat(64),
      },
    ])
    runInfra.mockResolvedValue(identityOk(ACCOUNT_B, 'arn:aws:iam::444455556666:user/dev'))

    await resolveAccountIds({ names: ['dev'] })

    expect((await readCacheEntries()).map((e) => e.profile)).toEqual(['dev'])
  })

  it('tên trùng chỉ phân giải một lần', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    runInfra.mockResolvedValue(identityOk(ACCOUNT_B, 'arn:aws:iam::444455556666:user/dev'))

    const out = await resolveAccountIds({ names: ['dev', 'dev', 'dev'] })

    expect(out.entries).toHaveLength(1)
    expect(runInfra).toHaveBeenCalledTimes(1)
  })

  // Audit #2 — `credential_process` là điểm mù HOÀN TOÀN của vân tay: cùng một
  // dòng lệnh có thể trả credential của tài khoản khác vào ngày mai, và không có
  // mtime, không có trường nào trên đĩa lệch đi. Không có tín hiệu thì không có
  // quyền nhớ — người dùng vẫn thấy kết quả lần bấm này, AWOG chỉ không mang nó
  // sang lần sau.
  it('profile credential_process ⇒ trả kết quả nhưng KHÔNG ghi cache', async () => {
    await writeConfig('[profile proc]\ncredential_process = /usr/local/bin/creds\n')
    runInfra.mockResolvedValue(identityOk(ACCOUNT_A, 'arn:aws:iam::111122223333:role/Proc'))

    const out = await resolveAccountIds({ names: ['proc'] })

    expect(out.entries.map((e) => e.accountId)).toEqual([ACCOUNT_A])
    await expect(stat(cachePath)).rejects.toThrow()
  })

  it('file cache 600, thư mục 700', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    runInfra.mockResolvedValue(identityOk(ACCOUNT_B, 'arn:aws:iam::444455556666:user/dev'))

    await resolveAccountIds({ names: ['dev'] })

    const file = await stat(cachePath)
    const folder = await stat(join(dir, '.awog', 'infra'))
    expect(file.mode & 0o777).toBe(0o600)
    expect(folder.mode & 0o777).toBe(0o700)
  })
})

// ─── Giả mạo cache ──────────────────────────────────────────────────────────
//
// Audit #2 dựng được một entry giả: `fp` là SHA-256 trên metadata ai cũng đọc
// được, bằng thuật toán nằm trong repo, nên nó tự tính lại được. Hai lớp trả
// lời chuyện đó — và test này khoá lớp thứ hai (lớp thứ nhất, cổng quyền, ở
// `runtime/__tests__/protected-path.test.ts`).

describe('entry giả mạo trong cache', () => {
  it('KHÔNG đè được id đọc live từ ~/.aws, dù vân tay tính đúng', async () => {
    // Đúng ca của audit #2: profile assume-role trỏ vào một account production.
    await writeConfig(
      '[profile prod-admin]\nrole_arn = arn:aws:iam::900011112222:role/OrgAdmin\nsource_profile = dev\n',
    )
    await writeCache([
      {
        profile: 'prod-admin',
        accountId: '000000000001', // account "dev" mà kẻ giả mạo muốn AWOG tin
        at: new Date().toISOString(),
        origin: 'sts',
        fp: await fpOf('prod-admin'), // vân tay HỢP LỆ — tự tính lại được
      },
    ])

    const entries = await listAccountIds()

    // `~/.aws` là nguồn chân lý; entry cache của cùng profile bị bỏ qua hoàn toàn.
    expect(entries).toEqual([
      { profile: 'prod-admin', accountId: '900011112222', at: expect.any(String), origin: 'config' },
    ])
  })
})

// ─── forgetAccountIds: đường lùi cho một id SAI ─────────────────────────────
//
// Audit #2: trước bản vá, một entry sai chỉ chết khi hết hạn — `resolve` sửa
// được nó, nhưng chỉ khi STS còn gọi được. Token hết hạn hay mất quyền
// `sts:GetCallerIdentity` thì người dùng không có đường nào gỡ nó ra.

describe('forgetAccountIds', () => {
  const fresh = (): string => new Date().toISOString()

  it('quên đúng profile được nêu tên, giữ phần còn lại', async () => {
    await writeConfig(`${STATIC_CONFIG}[profile ops]\nregion = us-east-1\n`)
    await writeCredentials(
      `${STATIC_CREDENTIALS}[ops]\naws_access_key_id = AKIAOPS\naws_secret_access_key = s3cret\n`,
    )
    await writeCache([
      { profile: 'dev', accountId: ACCOUNT_B, at: fresh(), origin: 'sts', fp: await fpOf('dev') },
      { profile: 'ops', accountId: ACCOUNT_A, at: fresh(), origin: 'sts', fp: await fpOf('ops') },
    ])

    expect(await forgetAccountIds({ names: ['dev'] })).toEqual({ removed: 1 })

    expect((await readCacheEntries()).map((e) => e.profile)).toEqual(['ops'])
    expect((await listAccountIds()).map((e) => e.profile)).toEqual(['ops'])
  })

  it('không có `names` ⇒ quên SẠCH', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    await writeCache([
      { profile: 'dev', accountId: ACCOUNT_B, at: fresh(), origin: 'sts', fp: await fpOf('dev') },
    ])

    expect(await forgetAccountIds()).toEqual({ removed: 1 })
    expect(await readCacheEntries()).toEqual([])
  })

  // `names: []` KHÔNG được đồng nghĩa với "quên sạch" — nhưng đây là đường GHI
  // nên nó vẫn dọn rác đã chết.
  it('`names: []` chỉ dọn entry chết, giữ entry còn sống', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    await writeCache([
      { profile: 'dev', accountId: ACCOUNT_B, at: fresh(), origin: 'sts', fp: await fpOf('dev') },
      { profile: 'gone', accountId: ACCOUNT_A, at: fresh(), origin: 'sts', fp: 'a'.repeat(64) },
    ])

    expect(await forgetAccountIds({ names: [] })).toEqual({ removed: 1 })
    expect((await readCacheEntries()).map((e) => e.profile)).toEqual(['dev'])
  })

  it('tên sai regex ⇒ ném INVALID_NAME, không chạm file', async () => {
    await writeConfig(STATIC_CONFIG)
    await writeCredentials(STATIC_CREDENTIALS)
    await writeCache([
      { profile: 'dev', accountId: ACCOUNT_B, at: fresh(), origin: 'sts', fp: await fpOf('dev') },
    ])

    // `AWS_PROFILE_NAME_RE` cố ý rộng (tên profile thật có `.`, `/`, `@`), nên
    // ca không hợp lệ phải là ký tự nó thật sự cấm — khoảng trắng, `!`.
    await expect(forgetAccountIds({ names: ['bad name!'] })).rejects.toThrow(/INVALID_NAME/)
    expect((await readCacheEntries()).map((e) => e.profile)).toEqual(['dev'])
  })

  it('cache rỗng ⇒ removed 0, không ném', async () => {
    await writeConfig(STATIC_CONFIG)
    expect(await forgetAccountIds({ names: ['dev'] })).toEqual({ removed: 0 })
  })
})
