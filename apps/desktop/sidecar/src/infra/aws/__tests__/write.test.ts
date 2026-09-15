// Đường ghi thật xuống đĩa. Mọi ca chạy trên thư mục tạm: `AWS_CONFIG_FILE` /
// `AWS_SHARED_CREDENTIALS_FILE` trỏ vào đó, và `HOME` bị đổi để thư mục sao lưu
// (`~/.awog/aws-backups`) cũng rơi vào tạm — KHÔNG chạm `~/.aws` hay `~/.awog`
// thật của người chạy test.
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
  chmod,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Bước verify chỉ hỏng khi đĩa nói dối — không dựng được bằng dữ liệu thật, nên
// bắt `parseAwsIni` quên đúng một lần để đo đường lùi.
const hoisted = vi.hoisted(() => ({ breakVerify: false, wipeOthers: false }))
vi.mock('../ini.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ini.js')>()
  return {
    ...actual,
    parseAwsIni: (raw: string) => (hoisted.breakVerify ? {} : actual.parseAwsIni(raw)),
  }
})

// Bộ đếm thứ hai: giả một trình soạn HỎNG (xoá mất profile không liên quan) để
// đo cái lưới an toàn `verifyUntouched` — không có cách nào dựng cảnh đó bằng
// dữ liệu thật, vì trình soạn thật không bao giờ làm vậy.
vi.mock('../ini-edit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ini-edit.js')>()
  return {
    ...actual,
    editAwsIni: (raw: string, edits: Parameters<typeof actual.editAwsIni>[1]) =>
      hoisted.wipeOthers ? '[default]\nregion = eu-west-1\n' : actual.editAwsIni(raw, edits),
  }
})

const { applyAwsIniEdits } = await import('../write.js')
const { awsBackupDir } = await import('../backup.js')

const FAKE_SECRET = 'wJalrXUtnFEMI-K7MDENG-bPxRfiCYEXAMPLEKEY'

const CREDS = [
  '# khoá cá nhân — 0600',
  '[default]',
  'aws_access_key_id = AKIAIOSFODNN7EXAMPLE',
  `aws_secret_access_key = ${FAKE_SECRET}`,
  'x_security_token_expires = 2026-09-13T10:00:00Z',
  '',
].join('\n')

let dir = ''
let configPath = ''
let credentialsPath = ''
const savedEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  hoisted.breakVerify = false
  hoisted.wipeOthers = false
  dir = await mkdtemp(join(tmpdir(), 'awog-aws-'))
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

async function mode(path: string): Promise<string> {
  return ((await stat(path)).mode & 0o777).toString(8)
}

describe('tạo file lần đầu', () => {
  it('ghi được khi `~/.aws/credentials` chưa tồn tại, và không có bản sao lưu', async () => {
    const res = await applyAwsIniEdits('credentials', [
      {
        op: 'upsertSection',
        section: 'dev',
        keys: { aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE', aws_secret_access_key: FAKE_SECRET },
      },
    ])
    expect(res.backup).toBeNull()
    expect(await readFile(credentialsPath, 'utf8')).toContain('[dev]')
    expect(await mode(credentialsPath)).toBe('600')
  })
})

describe('quyền file', () => {
  it('`credentials` giữ 0600 kể cả khi trước đó lỏng hơn', async () => {
    await writeFile(credentialsPath, CREDS, { mode: 0o644 })
    await applyAwsIniEdits('credentials', [
      { op: 'upsertSection', section: 'default', keys: { aws_session_token: 'IQoJtoken' } },
    ])
    expect(await mode(credentialsPath)).toBe('600')
  })

  it('thư mục sao lưu là 0700 và file sao lưu là 0600', async () => {
    await writeFile(credentialsPath, CREDS, { mode: 0o600 })
    const res = await applyAwsIniEdits('credentials', [
      { op: 'upsertSection', section: 'default', keys: { aws_session_token: 'IQoJtoken' } },
    ])
    expect(res.backup).not.toBeNull()
    expect(await mode(res.backup!)).toBe('600')
    expect(await mode(awsBackupDir())).toBe('700')
  })
})

describe('sao lưu', () => {
  it('sao lưu bản CŨ, không phải bản vừa ghi', async () => {
    await writeFile(configPath, '[default]\nregion = ap-southeast-1\n')
    const res = await applyAwsIniEdits('config', [
      { op: 'upsertSection', section: 'default', keys: { region: 'eu-west-1' } },
    ])
    expect(await readFile(res.backup!, 'utf8')).toBe('[default]\nregion = ap-southeast-1\n')
    expect(await readFile(configPath, 'utf8')).toBe('[default]\nregion = eu-west-1\n')
  })

  it('giữ 20 bản gần nhất, đếm riêng theo từng file', async () => {
    await writeFile(configPath, '[default]\nregion = r0\n')
    await writeFile(credentialsPath, CREDS, { mode: 0o600 })
    for (let i = 1; i <= 25; i++) {
      await applyAwsIniEdits('config', [
        { op: 'upsertSection', section: 'default', keys: { region: `r${i}` } },
      ])
    }
    await applyAwsIniEdits('credentials', [
      { op: 'upsertSection', section: 'default', keys: { aws_session_token: 'IQoJtoken' } },
    ])
    const names = await readdir(awsBackupDir())
    expect(names.filter((n) => n.startsWith('config.')).length).toBe(20)
    // Bản sao của `credentials` KHÔNG bị 25 lần ghi `config` cuốn đi.
    expect(names.filter((n) => n.startsWith('credentials.')).length).toBe(1)
  })
})

describe('sửa phẫu thuật trên một bản sao `~/.aws` thật', () => {
  it('comment và khoá AWOG không mô hình hoá còn nguyên sau khi sửa một profile', async () => {
    const before = [
      '# đừng commit',
      '[default]',
      'region = ap-southeast-1',
      'cli_pager =',
      's3 =',
      '  max_concurrent_requests = 20',
      '',
      '[profile prod]',
      'role_arn = arn:aws:iam::1:role/R',
      'credential_process = /usr/local/bin/creds',
      '',
    ].join('\n')
    await writeFile(configPath, before)

    await applyAwsIniEdits('config', [
      { op: 'upsertSection', section: 'default', keys: { region: 'eu-west-1', output: 'json' } },
    ])

    const after = await readFile(configPath, 'utf8')
    expect(after.split('\n')).toEqual([
      '# đừng commit',
      '[default]',
      'region = eu-west-1',
      'cli_pager =',
      's3 =',
      '  max_concurrent_requests = 20',
      'output = json',
      '',
      '[profile prod]',
      'role_arn = arn:aws:iam::1:role/R',
      'credential_process = /usr/local/bin/creds',
      '',
    ])
  })
})

describe('không có gì đổi', () => {
  it('không ghi, không sao lưu', async () => {
    await writeFile(configPath, '[default]\nregion = ap-southeast-1\n')
    const res = await applyAwsIniEdits('config', [
      { op: 'upsertSection', section: 'default', keys: { region: 'ap-southeast-1' } },
    ])
    expect(res.backup).toBeNull()
    await expect(readdir(awsBackupDir())).rejects.toThrow()
  })
})

describe('verify hỏng ⇒ khôi phục', () => {
  it('trả file về đúng nội dung cũ rồi ném VERIFY_FAILED', async () => {
    await writeFile(configPath, '[default]\nregion = ap-southeast-1\n')
    hoisted.breakVerify = true
    await expect(
      applyAwsIniEdits('config', [
        { op: 'upsertSection', section: 'default', keys: { region: 'eu-west-1' } },
      ]),
    ).rejects.toThrow(/VERIFY_FAILED/)
    hoisted.breakVerify = false
    expect(await readFile(configPath, 'utf8')).toBe('[default]\nregion = ap-southeast-1\n')
    // Bản sao lưu vẫn còn để người dùng tự đối chiếu.
    expect((await readdir(awsBackupDir())).filter((n) => n.startsWith('config.')).length).toBe(1)
  })

  it('file trước đó chưa tồn tại thì khôi phục = xoá nó đi', async () => {
    hoisted.breakVerify = true
    await expect(
      applyAwsIniEdits('credentials', [
        { op: 'upsertSection', section: 'dev', keys: { aws_secret_access_key: FAKE_SECRET } },
      ]),
    ).rejects.toThrow(/VERIFY_FAILED/)
    hoisted.breakVerify = false
    await expect(readFile(credentialsPath, 'utf8')).rejects.toThrow()
  })
})

describe('ném trước khi chạm đĩa', () => {
  it('khoá ngoài allowlist không tạo file, không tạo bản sao lưu', async () => {
    await expect(
      applyAwsIniEdits('config', [
        { op: 'upsertSection', section: 'default', keys: { credential_process: '/bin/sh' } },
      ]),
    ).rejects.toThrow(/not writable/)
    await expect(readFile(configPath, 'utf8')).rejects.toThrow()
    await expect(readdir(awsBackupDir())).rejects.toThrow()
  })
})

describe('hai lần ghi song song', () => {
  it('xếp hàng theo file — không ai nuốt thay đổi của ai', async () => {
    await writeFile(configPath, '[default]\nregion = ap-southeast-1\n')
    await Promise.all([
      applyAwsIniEdits('config', [
        { op: 'upsertSection', section: 'profile a', keys: { region: 'us-east-1' } },
      ]),
      applyAwsIniEdits('config', [
        { op: 'upsertSection', section: 'profile b', keys: { region: 'us-west-2' } },
      ]),
    ])
    const after = await readFile(configPath, 'utf8')
    expect(after).toContain('[profile a]')
    expect(after).toContain('[profile b]')
  })
})

// Hình dạng thật của `~/.aws/credentials` trên máy dev: hai profile, credential
// tạm (có session token), và MỘT profile viết `key=value` không khoảng trắng
// còn profile kia viết `key =value`.
const REAL_SHAPED = [
  '[229015218011_Offshore-Developer]',
  'aws_access_key_id=AKIAIOSFODNN7EXAMPLE',
  `aws_secret_access_key=${FAKE_SECRET}`,
  'aws_session_token=IQoJb3JpZ2luX2VjEXAMPLE',
  '[default]',
  'aws_access_key_id =AKIAI44QH8DHBEXAMPLE',
  `aws_secret_access_key =${FAKE_SECRET}-2`,
  'aws_session_token =IQoJb3JpZ2luX2VjEXAMPLE2',
  '',
].join('\n')

function lineHashes(s: string): string[] {
  return s.split('\n').map((l) => createHash('sha256').update(l).digest('hex'))
}

describe('sửa một profile không đụng credential của profile khác', () => {
  it('mọi dòng của profile kia hash y hệt trước và sau', async () => {
    await writeFile(credentialsPath, REAL_SHAPED, { mode: 0o600 })
    const before = lineHashes(await readFile(credentialsPath, 'utf8'))

    await applyAwsIniEdits('credentials', [
      { op: 'upsertSection', section: 'default', keys: { aws_session_token: 'IQoJnew' } },
    ])

    const after = lineHashes(await readFile(credentialsPath, 'utf8'))
    // 4 dòng đầu = profile Offshore-Developer, không được đổi một bit nào.
    expect(after.slice(0, 4)).toEqual(before.slice(0, 4))
    // Đúng một dòng đổi trong cả file.
    expect(after.filter((h, i) => h !== before[i]).length).toBe(1)
  })

  it('xoá một profile không đụng dòng nào của profile còn lại', async () => {
    await writeFile(credentialsPath, REAL_SHAPED, { mode: 0o600 })
    const before = lineHashes(await readFile(credentialsPath, 'utf8'))
    await applyAwsIniEdits('credentials', [{ op: 'deleteSection', section: 'default' }])
    const after = lineHashes(await readFile(credentialsPath, 'utf8'))
    expect(after.slice(0, 4)).toEqual(before.slice(0, 4))
  })
})

describe('lưới an toàn: đụng vào section không liên quan', () => {
  it('profile khác biến mất ⇒ VERIFY_FAILED và khôi phục nguyên văn', async () => {
    await writeFile(credentialsPath, REAL_SHAPED, { mode: 0o600 })
    hoisted.wipeOthers = true
    await expect(
      applyAwsIniEdits('credentials', [
        { op: 'upsertSection', section: 'default', keys: { region: 'eu-west-1' } },
      ]),
    ).rejects.toThrow(/unrelated section disappeared/)
    hoisted.wipeOthers = false
    expect(await readFile(credentialsPath, 'utf8')).toBe(REAL_SHAPED)
  })
})

describe('tên section có khoảng trắng thừa', () => {
  it('`profile  dev` ghi ra `[profile dev]` và verify không báo thiếu section', async () => {
    await writeFile(configPath, '[default]\nregion = a\n')
    await applyAwsIniEdits('config', [
      { op: 'upsertSection', section: 'profile  dev', keys: { region: 'x' } },
    ])
    expect(await readFile(configPath, 'utf8')).toContain('[profile dev]')
  })
})

describe('section khai hai lần', () => {
  it('xoá được hẳn thay vì hỏng ở bước verify', async () => {
    await writeFile(configPath, '[profile dev]\nregion = a\n\n[profile dev]\noutput = json\n')
    await applyAwsIniEdits('config', [{ op: 'deleteSection', section: 'profile dev' }])
    expect(await readFile(configPath, 'utf8')).toBe('')
  })
})

describe('`~/.aws/credentials` là symlink', () => {
  it('ghi XUYÊN QUA liên kết, không thay nó bằng file thường', async () => {
    // Trỏ vào một dotfiles repo là cấu hình rất phổ biến. `rename()` vào đúng
    // đường dẫn symlink sẽ cắt liên kết và bỏ lại file gốc với nội dung cũ.
    const real = join(dir, 'dotfiles-credentials')
    await writeFile(real, REAL_SHAPED, { mode: 0o600 })
    await symlink(real, credentialsPath)

    await applyAwsIniEdits('credentials', [
      { op: 'upsertSection', section: 'default', keys: { aws_session_token: 'IQoJnew' } },
    ])

    expect((await lstat(credentialsPath)).isSymbolicLink()).toBe(true)
    expect(await readFile(real, 'utf8')).toContain('IQoJnew')
    expect(((await stat(real)).mode & 0o777).toString(8)).toBe('600')
  })
})

describe('thư mục không ghi được', () => {
  it('báo lỗi, không để lại file tmp, không đụng file cũ', async () => {
    await writeFile(configPath, '[default]\nregion = a\n')
    await chmod(join(dir, 'aws'), 0o500)
    await expect(
      applyAwsIniEdits('config', [
        { op: 'upsertSection', section: 'default', keys: { region: 'b' } },
      ]),
    ).rejects.toThrow(/EACCES/)
    await chmod(join(dir, 'aws'), 0o700)
    expect(await readFile(configPath, 'utf8')).toBe('[default]\nregion = a\n')
    expect((await readdir(join(dir, 'aws'))).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})
