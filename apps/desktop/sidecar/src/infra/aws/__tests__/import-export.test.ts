// Nhập (A4) và xuất (A6). Mọi ca chạy trên thư mục tạm: `AWS_CONFIG_FILE` /
// `AWS_SHARED_CREDENTIALS_FILE` trỏ vào đó và `HOME` bị đổi, nên nhật ký
// (`~/.awog/infra-audit`) và thư mục sao lưu cũng rơi vào tạm — KHÔNG chạm
// `~/.aws` hay `~/.awog` thật của người chạy test.
import { mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyImport,
  exportCommands,
  exportProfiles,
  parseCsv,
  previewImport,
} from '../import-export.js'

// Khoá giả — chuỗi này là thứ mọi ca "không được rò" đi tìm trên đĩa.
const FAKE_SECRET = 'wJalrXUtnFEMI-K7MDENG-bPxRfiCYEXAMPLEKEY'
const OTHER_SECRET = 'QQQQQQQQQQQQQQQQ-imported-secret-value-1'

let dir = ''
let configPath = ''
let credentialsPath = ''
const savedEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'awog-aws-ie-'))
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

async function seedAws(): Promise<void> {
  await writeFile(
    configPath,
    [
      '# cấu hình của tôi',
      '[default]',
      'region = ap-southeast-1',
      'cli_pager =',
      '',
      '[profile prod]',
      'role_arn = arn:aws:iam::111111111111:role/Deploy',
      'source_profile = default',
      '',
    ].join('\n'),
  )
  await writeFile(
    credentialsPath,
    ['[default]', 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE', `aws_secret_access_key = ${FAKE_SECRET}`, ''].join(
      '\n',
    ),
    { mode: 0o600 },
  )
}

// ─── CSV ────────────────────────────────────────────────────────────────────

describe('parseCsv', () => {
  it('đọc ô trong nháy kép, dấu phẩy bên trong, và `""` là một nháy literal', () => {
    const rows = parseCsv('a,"b,c","say ""hi"""\n')
    expect(rows).toEqual([['a', 'b,c', 'say "hi"']])
  })

  it('đọc được CRLF và bỏ dòng trắng cuối file', () => {
    const rows = parseCsv('h1,h2\r\nv1,v2\r\n')
    expect(rows).toEqual([
      ['h1', 'h2'],
      ['v1', 'v2'],
    ])
  })

  it('giữ ô rỗng thay vì gộp cột', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']])
  })
})

describe('nhập từ CSV của IAM console', () => {
  const CSV = [
    'User name,Password,Access key ID,Secret access key,Console login link',
    `deployer,,AKIAIOSFODNN7EXAMPLE,${OTHER_SECRET},https://example.invalid`,
    '',
  ].join('\r\n')

  it('xem trước: có tên + kind static, và KHÔNG có giá trị khoá nào', async () => {
    const preview = await previewImport({ source: 'csv', text: CSV })
    expect(preview.entries).toHaveLength(1)
    const entry = preview.entries[0]!
    expect(entry.name).toBe('deployer')
    expect(entry.kind).toBe('static')
    expect(entry.hasStaticKeys).toBe(true)
    expect(entry.conflict).toBe('none')
    expect(JSON.stringify(preview)).not.toContain(OTHER_SECRET)
    // Access key id cũng không: nó là nửa còn lại của cặp khoá.
    expect(JSON.stringify(preview)).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('thiếu cột khoá thì nói ra thay vì trả danh sách rỗng im lặng', async () => {
    const preview = await previewImport({ source: 'csv', text: 'User name,Password\nx,y\n' })
    expect(preview.entries).toEqual([])
    expect(preview.warnings.join(' ')).toMatch(/Access key ID/)
  })

  it('áp dụng: ghi cặp khoá xuống `credentials` và không đụng `config`', async () => {
    const result = await applyImport({
      source: 'csv',
      text: CSV,
      selections: [{ from: 'deployer', to: 'deployer', overwrite: false }],
    })
    expect(result.created).toEqual(['deployer'])
    const creds = await readFile(credentialsPath, 'utf8')
    expect(creds).toContain('[deployer]')
    expect(creds).toContain(OTHER_SECRET)
    await expect(stat(configPath)).rejects.toThrow()
  })
})

// ─── Xem trước từ khối dán ─────────────────────────────────────────────────

describe('xem trước không bao giờ mang theo secret', () => {
  const PASTE = [
    '[229015218011_Offshore-Developer]',
    'aws_access_key_id = ASIAY34FZKBOKMUTVV7A',
    `aws_secret_access_key = ${OTHER_SECRET}`,
    'aws_session_token = IQoJb3JpZ2luX2VjEXAMPLETOKEN',
    'region = ap-southeast-1',
    '',
  ].join('\n')

  it('trả metadata + hai boolean, không trả giá trị', async () => {
    const preview = await previewImport({ source: 'paste', text: PASTE })
    const entry = preview.entries[0]!
    expect(entry.name).toBe('229015218011_Offshore-Developer')
    expect(entry.kind).toBe('static')
    expect(entry.hasStaticKeys).toBe(true)
    expect(entry.hasSessionToken).toBe(true)
    expect(entry.keys).toEqual({ region: 'ap-southeast-1' })
    const dump = JSON.stringify(preview)
    expect(dump).not.toContain(OTHER_SECRET)
    expect(dump).not.toContain('IQoJb3JpZ2luX2VjEXAMPLETOKEN')
  })

  it('nhận ra trùng tên với `~/.aws` hiện có, đúng từng file', async () => {
    await seedAws()
    const preview = await previewImport({
      source: 'paste',
      text: '[default]\nregion = us-east-1\n\n[prod]\nregion = us-east-1\n',
    })
    const byName = Object.fromEntries(preview.entries.map((e) => [e.name, e.conflict]))
    expect(byName.default).toBe('both') // có ở cả config lẫn credentials
    expect(byName.prod).toBe('config') // chỉ ở config
  })

  it('bỏ qua `[sso-session x]` và NÓI RA — profile trỏ vào nó sẽ hỏng nếu im lặng', async () => {
    const preview = await previewImport({
      source: 'paste',
      text: '[sso-session corp]\nsso_start_url = https://d-9xx.awsapps.com/start\n',
    })
    expect(preview.entries).toEqual([])
    expect(preview.warnings.join(' ')).toMatch(/sso-session corp/)
  })

  it('strip tiền tố `profile ` của file config', async () => {
    const preview = await previewImport({
      source: 'paste',
      text: '[profile staging]\nregion = ap-northeast-1\n',
    })
    expect(preview.entries[0]!.name).toBe('staging')
  })

  it('nêu tên khoá AWOG không ghi, thay vì lặng lẽ nuốt', async () => {
    const preview = await previewImport({
      source: 'paste',
      text: '[x]\ncredential_process = /bin/echo\nregion = ap-southeast-1\n',
    })
    expect(preview.entries[0]!.keys).toEqual({ region: 'ap-southeast-1' })
    expect(preview.warnings.join(' ')).toMatch(/credential_process/)
  })
})

// ─── Áp dụng: ba kiểu xử lý trùng ──────────────────────────────────────────

describe('áp dụng — ba kiểu xử lý trùng tên', () => {
  const PASTE = [
    '[default]',
    `aws_secret_access_key = ${OTHER_SECRET}`,
    'aws_access_key_id = AKIANEWNEWNEWNEWNEW1',
    'region = us-east-1',
    '',
  ].join('\n')

  it('ĐỔI TÊN: tạo profile mới, giữ nguyên cái cũ', async () => {
    await seedAws()
    const result = await applyImport({
      source: 'paste',
      text: PASTE,
      selections: [{ from: 'default', to: 'from-laptop', overwrite: false }],
    })
    expect(result.created).toEqual(['from-laptop'])
    expect(result.overwritten).toEqual([])
    const config = await readFile(configPath, 'utf8')
    const creds = await readFile(credentialsPath, 'utf8')
    expect(config).toContain('[profile from-laptop]')
    expect(creds).toContain('[from-laptop]')
    // Bản cũ còn nguyên, kể cả comment và khoá AWOG không mô hình hoá.
    expect(config).toContain('# cấu hình của tôi')
    expect(config).toContain('cli_pager =')
    expect(creds).toContain(FAKE_SECRET)
  })

  it('BỎ QUA: trùng mà không bật `overwrite` thì không chạm đĩa', async () => {
    await seedAws()
    const before = await readFile(credentialsPath, 'utf8')
    const result = await applyImport({
      source: 'paste',
      text: PASTE,
      selections: [{ from: 'default', to: 'default', overwrite: false }],
    })
    expect(result.skipped).toEqual(['default'])
    expect(result.created).toEqual([])
    expect(await readFile(credentialsPath, 'utf8')).toBe(before)
  })

  it('GHI ĐÈ: thay khoá cũ và có bản sao lưu để lùi', async () => {
    await seedAws()
    const result = await applyImport({
      source: 'paste',
      text: PASTE,
      selections: [{ from: 'default', to: 'default', overwrite: true }],
    })
    expect(result.overwritten).toEqual(['default'])
    expect(result.backups.length).toBeGreaterThan(0)
    const creds = await readFile(credentialsPath, 'utf8')
    expect(creds).toContain(OTHER_SECRET)
    expect(creds).not.toContain(FAKE_SECRET)
    expect(await readFile(configPath, 'utf8')).toContain('region = us-east-1')
  })

  it('GHI ĐÈ gỡ khoá mô hình hoá mà bản mới không có — không để lại khoá mồ côi', async () => {
    await seedAws()
    // Bản mới là SSO thuần: không có khoá static nào.
    await applyImport({
      source: 'paste',
      text: '[default]\nsso_session = corp\nsso_account_id = 229015218011\nsso_role_name = Dev\n',
      selections: [{ from: 'default', to: 'default', overwrite: true }],
    })
    const creds = await readFile(credentialsPath, 'utf8')
    expect(creds).not.toContain(FAKE_SECRET)
    expect(creds).not.toContain('AKIAIOSFODNN7EXAMPLE')
    const config = await readFile(configPath, 'utf8')
    expect(config).toContain('sso_session = corp')
    // Khoá mồ côi của bản cũ đã đi.
    expect(config).not.toMatch(/^region = ap-southeast-1$/m)
  })

  it('từ chối tên profile không hợp lệ TRƯỚC khi chạm đĩa', async () => {
    await expect(
      applyImport({
        source: 'paste',
        text: PASTE,
        selections: [{ from: 'default', to: 'bad name', overwrite: false }],
      }),
    ).rejects.toThrow(/INVALID_NAME/)
    await expect(stat(configPath)).rejects.toThrow()
  })

  it('giữ được tên profile thật của máy dev (chữ hoa + gạch dưới)', async () => {
    const result = await applyImport({
      source: 'paste',
      text: PASTE,
      selections: [
        { from: 'default', to: '229015218011_Offshore-Developer', overwrite: false },
      ],
    })
    expect(result.created).toEqual(['229015218011_Offshore-Developer'])
  })
})

describe('nguồn là FILE — L1', () => {
  it('từ chối đường dẫn không phải file thường', async () => {
    await expect(previewImport({ source: 'file', path: dir })).rejects.toThrow(/NOT_A_FILE/)
  })

  it('đọc được file credentials của máy khác', async () => {
    const other = join(dir, 'other-credentials')
    await writeFile(other, `[legacy]\naws_secret_access_key = ${OTHER_SECRET}\n`)
    const preview = await previewImport({ source: 'file', path: other })
    expect(preview.entries[0]!.name).toBe('legacy')
    expect(JSON.stringify(preview)).not.toContain(OTHER_SECRET)
  })
})

// ─── Xuất ──────────────────────────────────────────────────────────────────

describe('xuất', () => {
  it('mặc định KHÔNG chứa bất kỳ chuỗi nào từ `credentials`', async () => {
    await seedAws()
    const result = await exportProfiles({ names: ['default', 'prod'], includeSecrets: false })
    expect(result.text).toBeDefined()
    expect(result.text).not.toContain(FAKE_SECRET)
    expect(result.text).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(result.text).not.toContain('aws_secret_access_key')
    expect(result.text).toContain('[default]')
    expect(result.text).toContain('region = ap-southeast-1')
    expect(result.text).toContain('role_arn = arn:aws:iam::111111111111:role/Deploy')
  })

  it('kèm khoá thì ĐÒI gõ lại đúng một tên trong danh sách', async () => {
    await seedAws()
    await expect(
      exportProfiles({ names: ['default'], includeSecrets: true }),
    ).rejects.toThrow(/CONFIRM_REQUIRED/)
    await expect(
      exportProfiles({ names: ['default'], includeSecrets: true, confirmName: 'prod' }),
    ).rejects.toThrow(/CONFIRM_REQUIRED/)
  })

  it('kèm khoá + xác nhận đúng: có khoá, và file ra đĩa là 0600', async () => {
    await seedAws()
    const target = join(dir, 'export.ini')
    const result = await exportProfiles({
      names: ['default'],
      includeSecrets: true,
      confirmName: 'default',
      targetPath: target,
    })
    expect(result.path).toBe(target)
    const written = await readFile(target, 'utf8')
    expect(written).toContain(FAKE_SECRET)
    expect((await stat(target)).mode & 0o777).toBe(0o600)
  })

  it('từ chối ghi đè vào chính `~/.aws`', async () => {
    await seedAws()
    await expect(
      exportProfiles({ names: ['default'], includeSecrets: false, targetPath: configPath }),
    ).rejects.toThrow(/FORBIDDEN_TARGET/)
  })

  it('từ chối ghi vào `~/.awog` — đó là nhà của bản sao lưu', async () => {
    await seedAws()
    await expect(
      exportProfiles({
        names: ['default'],
        includeSecrets: false,
        targetPath: join(dir, '.awog', 'leak.ini'),
      }),
    ).rejects.toThrow(/FORBIDDEN_TARGET/)
  })
})

describe('lệnh `aws configure set` tương đương', () => {
  it('không bao giờ chứa giá trị khoá — chỉ placeholder', async () => {
    await seedAws()
    const { commands } = await exportCommands('default')
    const joined = commands.join('\n')
    expect(joined).not.toContain(FAKE_SECRET)
    expect(joined).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(joined).toContain('aws configure set region ap-southeast-1 --profile default')
    expect(joined).toContain('<your-secret-access-key>')
    expect(joined).toContain('<your-access-key-id>')
  })

  it('profile không có khoá static thì không sinh dòng khoá nào', async () => {
    await seedAws()
    const { commands } = await exportCommands('prod')
    expect(commands.join('\n')).not.toContain('<your-secret-access-key>')
  })

  it('từ chối tên profile không hợp lệ', async () => {
    await expect(exportCommands('bad name')).rejects.toThrow(/INVALID_NAME/)
  })
})

// ─── Hồi quy bảo mật ────────────────────────────────────────────────────────

describe('xuất kèm khoá KHÔNG BAO GIỜ trả nội dung về người gọi', () => {
  it('thiếu `targetPath` ⇒ TARGET_REQUIRED, không có `text`', async () => {
    await seedAws()
    await expect(
      exportProfiles({ names: ['default'], includeSecrets: true, confirmName: 'default' }),
    ).rejects.toThrow(/^TARGET_REQUIRED/)
  })

  it('`targetPath` toàn khoảng trắng cũng bị chặn', async () => {
    await seedAws()
    await expect(
      exportProfiles({
        names: ['default'],
        includeSecrets: true,
        confirmName: 'default',
        targetPath: '   ',
      }),
    ).rejects.toThrow(/^TARGET_REQUIRED/)
  })

  it('ghi ra file thì payload trả về CHỈ có đường dẫn', async () => {
    await seedAws()
    const target = join(dir, 'with-secrets.ini')
    const result = await exportProfiles({
      names: ['default'],
      includeSecrets: true,
      confirmName: 'default',
      targetPath: target,
    })
    expect(JSON.stringify(result)).not.toContain(FAKE_SECRET)
    expect(Object.keys(result).sort()).toEqual(['format', 'ok', 'path'])
  })
})

describe('đích xuất được giải symlink trước khi so danh sách cấm', () => {
  it('symlink trỏ thẳng vào ~/.aws/credentials bị từ chối', async () => {
    await seedAws()
    const link = join(dir, 'innocent.ini')
    await symlink(credentialsPath, link)
    await expect(
      exportProfiles({ names: ['default'], includeSecrets: false, targetPath: link }),
    ).rejects.toThrow(/^FORBIDDEN_TARGET/)
    // File credential phải còn NGUYÊN.
    expect(await readFile(credentialsPath, 'utf8')).toContain(FAKE_SECRET)
  })

  it('thư mục cha là symlink vào ~/.aws cũng bị từ chối', async () => {
    await seedAws()
    const linkedDir = join(dir, 'shortcut')
    await symlink(join(dir, 'aws'), linkedDir)
    await expect(
      exportProfiles({
        names: ['default'],
        includeSecrets: false,
        targetPath: join(linkedDir, 'out.ini'),
      }),
    ).rejects.toThrow(/^FORBIDDEN_TARGET/)
  })

  it('đích bình thường vẫn ghi được', async () => {
    await seedAws()
    const target = join(dir, 'plain.ini')
    const result = await exportProfiles({
      names: ['default'],
      includeSecrets: false,
      targetPath: target,
    })
    expect(result.path).toBe(target)
  })
})

describe('nhập KHÔNG ghi đè profile credential_process', () => {
  it('bỏ qua + nói ra lý do thay vì ném', async () => {
    await writeFile(
      configPath,
      ['[profile vault]', 'credential_process = /usr/local/bin/vault-aws', ''].join('\n'),
    )
    const text = [
      '[vault]',
      'aws_access_key_id = AKIAIOSFODNN7EXAMPLE',
      `aws_secret_access_key = ${OTHER_SECRET}`,
      '',
    ].join('\n')
    const result = await applyImport({
      source: 'paste',
      text,
      selections: [{ from: 'vault', to: 'vault', overwrite: true }],
    })
    expect(result.created).toEqual([])
    expect(result.overwritten).toEqual([])
    expect(result.skipped).toEqual(['vault'])
    expect(result.warnings.join(' ')).toMatch(/credential_process/)
    // Không có file credentials nào được đẻ ra.
    await expect(readFile(credentialsPath, 'utf8')).rejects.toThrow()
  })
})

describe('cả ba parser dừng tên section ở `]` ĐẦU TIÊN', () => {
  const HEADER_CONFIG = '[profile dev] ; bucket [prod]'
  const HEADER_CREDS = '[dev] ; note [old]'

  it('đường đọc, đường ghi và đường xuất-kèm-khoá cho cùng một tên', async () => {
    await writeFile(configPath, [HEADER_CONFIG, 'region = ap-northeast-1', ''].join('\n'))
    await writeFile(
      credentialsPath,
      [HEADER_CREDS, `aws_secret_access_key = ${FAKE_SECRET}`, ''].join('\n'),
      { mode: 0o600 },
    )

    // Đường ĐỌC (parseAwsIni qua previewImport → conflict) thấy `dev`.
    const preview = await previewImport({
      source: 'paste',
      text: ['[dev]', 'region = us-east-1', ''].join('\n'),
    })
    expect(preview.entries[0]!.conflict).toBe('both')

    // Đường XUẤT kèm khoá (secretLinesOf) cũng phải thấy `dev`.
    const target = join(dir, 'out.ini')
    await exportProfiles({
      names: ['dev'],
      includeSecrets: true,
      confirmName: 'dev',
      targetPath: target,
    })
    const written = await readFile(target, 'utf8')
    expect(written).toContain(FAKE_SECRET)
    expect(written).toContain('region = ap-northeast-1')
  })

  it('đường GHI (parseSectionsForWrite) đọc header đuôi `]` ra cùng một tên', async () => {
    const result = await applyImport({
      source: 'paste',
      text: [HEADER_CREDS, `aws_secret_access_key = ${OTHER_SECRET}`, ''].join('\n'),
      selections: [{ from: 'dev', to: 'dev', overwrite: false }],
    })
    expect(result.created).toEqual(['dev'])
    expect(await readFile(credentialsPath, 'utf8')).toContain(OTHER_SECRET)
  })
})

describe('nhật ký ghi ĐÍCH của lần xuất kèm khoá', () => {
  it('đường dẫn có trong argv, giá trị khoá thì không', async () => {
    await seedAws()
    const target = join(dir, 'audited.ini')
    await exportProfiles({
      names: ['default'],
      includeSecrets: true,
      confirmName: 'default',
      targetPath: target,
    })
    const auditDir = join(dir, '.awog', 'infra-audit')
    const files = await readdir(auditDir)
    const raw = await readFile(join(auditDir, files[0]!), 'utf8')
    expect(raw).toContain('profile_export')
    expect(raw).toContain('--include-secrets')
    expect(raw).toContain('audited.ini')
    expect(raw).not.toContain(FAKE_SECRET)
  })
})

describe('CSV: hai dòng cùng tên không được gộp im lặng', () => {
  const CSV = [
    'User name,Access key ID,Secret access key',
    `alice,AKIAIOSFODNN7EXAMPLE,${FAKE_SECRET}`,
    `alice,AKIAI44QH8DHBEXAMPLE,${OTHER_SECRET}`,
    '',
  ].join('\n')

  it('xem trước tách thành hai tên và nói ra đã đổi tên', async () => {
    const preview = await previewImport({ source: 'csv', text: CSV })
    expect(preview.entries.map((e) => e.name)).toEqual(['alice', 'alice-2'])
    expect(preview.warnings.join(' ')).toMatch(/duplicate name/)
    expect(JSON.stringify(preview)).not.toContain(FAKE_SECRET)
  })

  it('đường ghi dùng ĐÚNG danh sách tên của xem trước', async () => {
    const result = await applyImport({
      source: 'csv',
      text: CSV,
      selections: [
        { from: 'alice', to: 'alice', overwrite: false },
        { from: 'alice-2', to: 'alice-2', overwrite: false },
      ],
    })
    expect(result.created).toEqual(['alice', 'alice-2'])
    const creds = await readFile(credentialsPath, 'utf8')
    expect(creds).toContain(FAKE_SECRET)
    expect(creds).toContain(OTHER_SECRET)
  })

  it('hai lựa chọn trỏ cùng một đích ⇒ ném, không ghi nửa vời', async () => {
    await expect(
      applyImport({
        source: 'csv',
        text: CSV,
        selections: [
          { from: 'alice', to: 'same', overwrite: false },
          { from: 'alice-2', to: 'same', overwrite: false },
        ],
      }),
    ).rejects.toThrow(/INVALID_NAME/)
    await expect(readFile(credentialsPath, 'utf8')).rejects.toThrow()
  })
})
