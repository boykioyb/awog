// Trình soạn này đứng giữa lệnh "sửa profile" của người dùng và file credential
// THẬT của họ. Hỏng file ⇒ mất quyền vào mọi thứ. Nên mỗi bất biến trong
// `ini-edit.ts` có ít nhất một ca ở đây, và fixture cố ý bẩn đúng như file thật:
// comment, khoá AWOG không mô hình hoá, block thụt `s3 =`, comment cuối dòng.
import { describe, expect, it } from 'vitest'
import { editAwsIni } from '../ini-edit.js'
import { parseAwsIni } from '../ini.js'

const FAKE_SECRET = 'wJalrXUtnFEMI-K7MDENG-bPxRfiCYEXAMPLEKEY'

// Ảnh chụp một `~/.aws/config` thật: có tất cả những thứ một parser ngây thơ sẽ
// xoá mất.
const CONFIG = [
  '# Cấu hình AWS — đừng commit file này',
  '[default]',
  'region = ap-southeast-1',
  'output = json   ; giữ json cho jq',
  'cli_pager =',
  's3 =',
  '  max_concurrent_requests = 20',
  '  multipart_threshold = 64MB',
  '',
  '[profile 229015218011_Offshore-Developer]  ; SSO công ty',
  'sso_session = corp',
  'sso_account_id = 229015218011',
  'sso_role_name = Offshore-Developer',
  'endpoint_url = https://vpce.example.invalid',
  '',
  '; block phiên SSO — dùng chung cho mọi role',
  '[sso-session corp]',
  'sso_start_url = https://d-9xx.awsapps.com/start',
  'sso_region = ap-southeast-1',
  'sso_registration_scopes = sso:account:access',
  '',
  '[profile prod-deploy]',
  'role_arn = arn:aws:iam::111122223333:role/Deploy',
  'source_profile = default',
  '',
].join('\n')

function lines(s: string): string[] {
  return s.split('\n')
}

/** Những dòng đổi giữa hai bản (dùng cho ca round-trip). */
function changedLines(before: string, after: string): { removed: string[]; added: string[] } {
  const b = lines(before)
  const a = lines(after)
  return {
    removed: b.filter((l) => !a.includes(l)),
    added: a.filter((l) => !b.includes(l)),
  }
}

describe('giữ nguyên phần file không liên quan', () => {
  const out = editAwsIni(CONFIG, [
    { op: 'upsertSection', section: 'default', keys: { region: 'us-east-1' } },
  ])

  it('giữ comment đứng riêng, đúng vị trí cũ', () => {
    expect(lines(out)[0]).toBe('# Cấu hình AWS — đừng commit file này')
    expect(out).toContain('; block phiên SSO — dùng chung cho mọi role')
    expect(lines(out).indexOf('; block phiên SSO — dùng chung cho mọi role')).toBe(
      lines(CONFIG).indexOf('; block phiên SSO — dùng chung cho mọi role'),
    )
  })

  it('giữ comment cuối dòng của một khoá KHÔNG bị sửa', () => {
    expect(out).toContain('output = json   ; giữ json cho jq')
  })

  it('giữ comment cuối dòng trên chính header của section', () => {
    expect(out).toContain('[profile 229015218011_Offshore-Developer]  ; SSO công ty')
  })

  it('giữ khoá AWOG không mô hình hoá và cả block thụt', () => {
    for (const l of [
      'cli_pager =',
      's3 =',
      '  max_concurrent_requests = 20',
      '  multipart_threshold = 64MB',
      'endpoint_url = https://vpce.example.invalid',
      'sso_registration_scopes = sso:account:access',
    ]) {
      expect(out).toContain(l)
    }
  })

  it('giữ nguyên thứ tự khoá cũ', () => {
    const before = lines(CONFIG).filter((l) => l.includes('='))
    const after = lines(out).filter((l) => l.includes('='))
    expect(after.map((l) => l.split('=')[0])).toEqual(before.map((l) => l.split('=')[0]))
  })
})

describe('round-trip: sửa một khoá chỉ đổi đúng một dòng', () => {
  it('đổi region của một profile, diff đúng 1 dòng ra 1 dòng', () => {
    const out = editAwsIni(CONFIG, [
      { op: 'upsertSection', section: 'default', keys: { region: 'eu-west-1' } },
    ])
    expect(changedLines(CONFIG, out)).toEqual({
      removed: ['region = ap-southeast-1'],
      added: ['region = eu-west-1'],
    })
    expect(lines(out).length).toBe(lines(CONFIG).length)
  })
})

describe('khoá mới', () => {
  it('nối vào CUỐI section, không phải đầu, không phải cuối file', () => {
    const out = editAwsIni(CONFIG, [
      { op: 'upsertSection', section: 'profile prod-deploy', keys: { mfa_serial: 'arn:mfa/me' } },
    ])
    const l = lines(out)
    expect(l[l.indexOf('source_profile = default') + 1]).toBe('mfa_serial = arn:mfa/me')
  })

  it('không đẩy dòng trắng ngăn cách xuống dưới khoá mới', () => {
    const out = editAwsIni(CONFIG, [
      { op: 'upsertSection', section: 'default', keys: { external_id: 'x1' } },
    ])
    const l = lines(out)
    // Khoá mới nằm sau dòng cuối CÓ NỘI DUNG của section (block thụt), trước
    // dòng trắng ngăn với section kế.
    expect(l[l.indexOf('  multipart_threshold = 64MB') + 1]).toBe('external_id = x1')
    expect(l[l.indexOf('external_id = x1') + 1]).toBe('')
    expect(out).toContain('output = json   ; giữ json cho jq')
  })

  it('ghi đè một khoá thì thay CẢ phần sau `=`, kể cả đoạn trông như comment', () => {
    // Cố ý, không phải sót: botocore parse bằng `RawConfigParser` với
    // `inline_comment_prefixes=None`, nên `output = json ; ghi chú` có giá trị
    // là `json ; ghi chú` — đoạn đó là GIÁ TRỊ, không phải comment. Giữ nó lại
    // khi ghi giá trị mới sẽ tạo ra một giá trị ghép vô nghĩa.
    const out = editAwsIni(CONFIG, [
      { op: 'upsertSection', section: 'default', keys: { output: 'text' } },
    ])
    expect(out).toContain('output = text')
    expect(out).not.toContain('giữ json cho jq')
    expect(parseAwsIni(out)['default']!.keys.output).toBe('text')
  })
})

describe('thụt đầu dòng và cách viết `=` của khoá cũ', () => {
  it('giữ nguyên khi chỉ đổi giá trị', () => {
    const raw = '[default]\n\tregion=ap-southeast-1\noutput   =   json\n'
    const out = editAwsIni(raw, [
      { op: 'upsertSection', section: 'default', keys: { region: 'us-east-1', output: 'text' } },
    ])
    expect(out).toBe('[default]\n\tregion=us-east-1\noutput   =   text\n')
  })
})

describe('kết thúc dòng và newline cuối file', () => {
  it('file CRLF thì dòng mới cũng CRLF', () => {
    const raw = '[default]\r\nregion = ap-southeast-1\r\n'
    const out = editAwsIni(raw, [
      { op: 'upsertSection', section: 'default', keys: { output: 'json' } },
    ])
    expect(out).toBe('[default]\r\nregion = ap-southeast-1\r\noutput = json\r\n')
  })

  it('file CRLF: section mới cũng CRLF, kể cả dòng trắng ngăn cách', () => {
    const raw = '[default]\r\nregion = ap-southeast-1\r\n'
    const out = editAwsIni(raw, [
      { op: 'upsertSection', section: 'profile new', keys: { region: 'us-east-1' } },
    ])
    expect(out).toBe(
      '[default]\r\nregion = ap-southeast-1\r\n\r\n[profile new]\r\nregion = us-east-1\r\n',
    )
  })

  it('file LF giữ LF', () => {
    const out = editAwsIni('[default]\nregion = a\n', [
      { op: 'upsertSection', section: 'default', keys: { output: 'json' } },
    ])
    expect(out).not.toContain('\r')
  })

  it('file không có newline cuối thì vẫn không có sau khi sửa', () => {
    const out = editAwsIni('[default]\nregion = a', [
      { op: 'upsertSection', section: 'default', keys: { output: 'json' } },
    ])
    expect(out).toBe('[default]\nregion = a\noutput = json')
  })

  it('file có newline cuối thì vẫn có', () => {
    const out = editAwsIni('[default]\nregion = a\n', [
      { op: 'upsertSection', section: 'default', keys: { output: 'json' } },
    ])
    expect(out.endsWith('output = json\n')).toBe(true)
  })

  it('file rỗng: tạo section đầu tiên, không đẻ dòng trắng thừa', () => {
    const out = editAwsIni('', [
      { op: 'upsertSection', section: 'default', keys: { region: 'ap-southeast-1' } },
    ])
    // Có newline cuối: file text POSIX bình thường. Không có nó, `aws configure
    // set` hay một script `>>` sẽ nối dòng mới ngay sau `ap-southeast-1`.
    expect(out).toBe('[default]\nregion = ap-southeast-1\n')
  })
})

describe('trùng lặp', () => {
  it('khoá chỉ có ở lần khai ĐẦU: sửa tại chỗ, không nhân bản section', () => {
    const raw = '[default]\nregion = a\n[profile x]\nregion = b\n[default]\noutput = json\n'
    const out = editAwsIni(raw, [
      { op: 'upsertSection', section: 'default', keys: { region: 'z' } },
    ])
    expect(out).toBe('[default]\nregion = z\n[profile x]\nregion = b\n[default]\noutput = json\n')
    expect(lines(out).filter((l) => l === '[default]').length).toBe(2)
  })

  it('khoá trùng trong một section: sửa bản CUỐI, xoá các bản trùng còn lại', () => {
    // "Cái sau thắng" là ngữ nghĩa của botocore — sửa bản đầu thì file vẫn chạy
    // bằng giá trị cũ, đúng kiểu bug không ai tìm ra.
    const raw = '[default]\nregion = a\noutput = json\nregion = b\n'
    const out = editAwsIni(raw, [
      { op: 'upsertSection', section: 'default', keys: { region: 'z' } },
    ])
    expect(out).toBe('[default]\noutput = json\nregion = z\n')
    expect(parseAwsIni(out)['default']!.keys.region).toBe('z')
  })

  it('`[profile   x]` nhiều khoảng trắng vẫn khớp `profile x`', () => {
    const out = editAwsIni('[profile   dev]\nregion = a\n', [
      { op: 'upsertSection', section: 'profile dev', keys: { region: 'b' } },
    ])
    expect(out).toBe('[profile   dev]\nregion = b\n')
  })
})

describe('section mới', () => {
  it('nối vào cuối file với đúng MỘT dòng trắng ngăn cách', () => {
    const out = editAwsIni('[default]\nregion = a\n', [
      {
        op: 'upsertSection',
        section: 'profile prod',
        keys: { role_arn: 'arn:aws:iam::1:role/R', source_profile: 'default' },
      },
    ])
    expect(out).toBe(
      '[default]\nregion = a\n\n[profile prod]\nrole_arn = arn:aws:iam::1:role/R\nsource_profile = default\n',
    )
  })

  it('không thêm dòng trắng thứ hai khi file đã kết thúc bằng dòng trắng', () => {
    const out = editAwsIni('[default]\nregion = a\n\n', [
      { op: 'upsertSection', section: 'profile prod', keys: { region: 'b' } },
    ])
    expect(out).toBe('[default]\nregion = a\n\n[profile prod]\nregion = b\n')
  })
})

describe('removeKeys', () => {
  it('xoá mọi lần xuất hiện của khoá trong section', () => {
    const raw = '[default]\nregion = a\noutput = json\nregion = b\n'
    const out = editAwsIni(raw, [
      { op: 'upsertSection', section: 'default', keys: {}, removeKeys: ['region'] },
    ])
    expect(out).toBe('[default]\noutput = json\n')
  })

  it('không đụng khoá cùng tên ở section khác', () => {
    const raw = '[default]\nregion = a\n\n[profile x]\nregion = b\n'
    const out = editAwsIni(raw, [
      { op: 'upsertSection', section: 'default', keys: {}, removeKeys: ['region'] },
    ])
    expect(out).toBe('[default]\n\n[profile x]\nregion = b\n')
  })

  it('ném khi vừa ghi vừa xoá cùng một khoá', () => {
    expect(() =>
      editAwsIni('[default]\nregion = a\n', [
        { op: 'upsertSection', section: 'default', keys: { region: 'b' }, removeKeys: ['region'] },
      ]),
    ).toThrow(/both written and removed/)
  })
})

describe('renameSection', () => {
  it('chỉ đổi phần trong ngoặc, giữ đuôi comment', () => {
    const out = editAwsIni(CONFIG, [
      { op: 'renameSection', from: 'profile 229015218011_Offshore-Developer', to: 'profile dev' },
    ])
    expect(out).toContain('[profile dev]  ; SSO công ty')
    expect(out).not.toContain('[profile 229015218011_Offshore-Developer]')
    expect(out).toContain('sso_account_id = 229015218011')
  })

  it('ném khi tên đích đã tồn tại — không tạo hai section trùng', () => {
    expect(() =>
      editAwsIni('[default]\nregion = a\n\n[profile x]\nregion = b\n', [
        { op: 'renameSection', from: 'profile x', to: 'default' },
      ]),
    ).toThrow(/already exists/)
  })

  it('ném khi không tìm thấy section nguồn', () => {
    expect(() =>
      editAwsIni('[default]\nregion = a\n', [
        { op: 'renameSection', from: 'profile nope', to: 'profile x' },
      ]),
    ).toThrow(/not found/)
  })
})

describe('deleteSection', () => {
  it('xoá header + thân, giữ comment nằm ngay trên section KẾ TIẾP', () => {
    const out = editAwsIni(CONFIG, [
      { op: 'deleteSection', section: 'profile 229015218011_Offshore-Developer' },
    ])
    expect(out).not.toContain('sso_account_id = 229015218011')
    expect(out).not.toContain('[profile 229015218011_Offshore-Developer]')
    // Comment là chữ của người dùng — giữ lại, kể cả khi nó đứng ngay trên
    // section vừa xoá hoặc ngay dưới nó.
    expect(out).toContain('; block phiên SSO — dùng chung cho mọi role')
    expect(out).toContain('# Cấu hình AWS — đừng commit file này')
    expect(out).toContain('[sso-session corp]')
  })

  it('không để lại dòng trắng đôi ở vết cắt', () => {
    const raw = '[a]\nregion = 1\n\n[b]\nregion = 2\n\n[c]\nregion = 3\n'
    const out = editAwsIni(raw, [{ op: 'deleteSection', section: 'b' }])
    expect(out).toBe('[a]\nregion = 1\n\n[c]\nregion = 3\n')
  })

  it('xoá section cuối thì không để lại dòng trắng thừa ở cuối file', () => {
    const raw = '[a]\nregion = 1\n\n[b]\nregion = 2\n'
    const out = editAwsIni(raw, [{ op: 'deleteSection', section: 'b' }])
    expect(out).toBe('[a]\nregion = 1\n')
  })

  it('section không tồn tại là no-op, không ném', () => {
    const raw = '[a]\nregion = 1\n'
    expect(editAwsIni(raw, [{ op: 'deleteSection', section: 'nope' }])).toBe(raw)
  })
})

describe('allowlist khoá được phép GHI', () => {
  it.each(['credential_process', 'x_security_token_expires', 'cli_pager', 'endpoint_url', 's3'])(
    'ném khi ghi khoá ngoài allowlist: %s',
    (key) => {
      expect(() =>
        editAwsIni('[default]\nregion = a\n', [
          { op: 'upsertSection', section: 'default', keys: { [key]: 'x' } },
        ]),
      ).toThrow(/not writable/)
    },
  )

  it('ném cả khi XOÁ `credential_process` — v1 chỉ đọc dòng đó', () => {
    expect(() =>
      editAwsIni('[default]\ncredential_process = /bin/echo\n', [
        { op: 'upsertSection', section: 'default', keys: {}, removeKeys: ['credential_process'] },
      ]),
    ).toThrow(/not writable/)
  })

  it('cho phép đúng ba khoá secret (đây là đường ghi duy nhất chạm chúng)', () => {
    const out = editAwsIni('[dev]\n', [
      {
        op: 'upsertSection',
        section: 'dev',
        keys: {
          aws_access_key_id: 'AKIAIOSFODNN7EXAMPLE',
          aws_secret_access_key: FAKE_SECRET,
          aws_session_token: 'IQoJb3JpZ2luX2VjEXAMPLE',
        },
      },
    ])
    const parsed = parseAwsIni(out)['dev']!
    expect(parsed.hasStaticKeys).toBe(true)
    expect(parsed.hasSessionToken).toBe(true)
  })

  // A5 ghi block `[sso-session x]` có khoá này; thiếu nó thì `aws sso login`
  // đăng ký client OIDC không có phạm vi `sso:account:access` và `list-accounts`
  // ngay sau đó trả 403. Khoá phải có ở CẢ HAI allowlist — ghi được ở đây mà
  // `ini.ts` không đọc lại được thì bước verify của `write.ts` báo hỏng.
  it('cho phép sso_registration_scopes (A5 cần, và `ini.ts` đọc lại được)', () => {
    const out = editAwsIni('', [
      {
        op: 'upsertSection',
        section: 'sso-session corp',
        keys: { sso_registration_scopes: 'sso:account:access' },
      },
    ])
    expect(parseAwsIni(out)['sso-session corp']!.keys.sso_registration_scopes).toBe(
      'sso:account:access',
    )
  })

  it('cho phép sso_start_url/sso_region cho block [sso-session]', () => {
    const out = editAwsIni('', [
      {
        op: 'upsertSection',
        section: 'sso-session corp',
        keys: { sso_start_url: 'https://d-9xx.awsapps.com/start', sso_region: 'ap-southeast-1' },
      },
    ])
    expect(parseAwsIni(out)['sso-session corp']!.keys.sso_start_url).toBe(
      'https://d-9xx.awsapps.com/start',
    )
  })
})

describe('giá trị độc không chèn được cấu trúc mới', () => {
  it.each([
    ['xuống dòng LF', 'a\n[evil]\nregion = x'],
    ['xuống dòng CR', 'a\r[evil]'],
  ])('ném khi giá trị chứa %s', (_label, value) => {
    expect(() =>
      editAwsIni('[default]\nregion = a\n', [
        { op: 'upsertSection', section: 'default', keys: { region: value } },
      ]),
    ).toThrow(/line break/)
  })

  it('ném khi giá trị mở đầu bằng `[`', () => {
    expect(() =>
      editAwsIni('[default]\nregion = a\n', [
        { op: 'upsertSection', section: 'default', keys: { region: '[evil]' } },
      ]),
    ).toThrow(/must not start with/)
  })

  it('ném khi giá trị rỗng — `region =` sẽ mở block thụt chứ không phải khoá rỗng', () => {
    expect(() =>
      editAwsIni('[default]\nregion = a\n', [
        { op: 'upsertSection', section: 'default', keys: { region: '  ' } },
      ]),
    ).toThrow(/must not be empty/)
  })

  it('thông báo lỗi không bao giờ nhắc lại giá trị (có thể là secret)', () => {
    try {
      editAwsIni('[dev]\n', [
        {
          op: 'upsertSection',
          section: 'dev',
          keys: { aws_secret_access_key: `${FAKE_SECRET}\nregion = x` },
        },
      ])
      expect.unreachable('phải ném')
    } catch (err) {
      expect(String(err)).not.toContain(FAKE_SECRET)
    }
  })

  it.each(['profile a]\n[b', 'a b c', '', 'profile dev<>'])(
    'ném khi tên section sai định dạng: %j',
    (name) => {
      expect(() =>
        editAwsIni('[default]\nregion = a\n', [
          { op: 'upsertSection', section: name, keys: { region: 'x' } },
        ]),
      ).toThrow(/Invalid INI section name/)
    },
  )

  it('chấp nhận tên profile thật của máy dev', () => {
    const out = editAwsIni('', [
      {
        op: 'upsertSection',
        section: 'profile 229015218011_Offshore-Developer',
        keys: { region: 'ap-southeast-1' },
      },
    ])
    expect(out).toContain('[profile 229015218011_Offshore-Developer]')
  })
})

describe('bảo mật: sửa profile A không đụng credential của profile B', () => {
  const CREDS = [
    '[default]',
    'aws_access_key_id = AKIAIOSFODNN7EXAMPLE',
    `aws_secret_access_key = ${FAKE_SECRET}`,
    '',
    '[229015218011_Offshore-Developer]',
    'aws_access_key_id = ASIAIOSFODNN7EXAMPLE',
    'aws_secret_access_key = second-profile-secret-value',
    'aws_session_token = IQoJb3JpZ2luX2VjEXAMPLE',
    '',
  ].join('\n')

  it('đổi khoá của B, dòng secret của A còn nguyên từng ký tự', () => {
    const out = editAwsIni(CREDS, [
      {
        op: 'upsertSection',
        section: '229015218011_Offshore-Developer',
        keys: { aws_secret_access_key: 'rotated-secret-value' },
      },
    ])
    expect(out).toContain(`aws_secret_access_key = ${FAKE_SECRET}`)
    expect(out).toContain('aws_secret_access_key = rotated-secret-value')
    expect(out).not.toContain('second-profile-secret-value')
    expect(parseAwsIni(out)['default']!.hasStaticKeys).toBe(true)
  })

  it('xoá B không đụng A', () => {
    const out = editAwsIni(CREDS, [
      { op: 'deleteSection', section: '229015218011_Offshore-Developer' },
    ])
    expect(out).toContain(`aws_secret_access_key = ${FAKE_SECRET}`)
    expect(out).not.toContain('second-profile-secret-value')
    expect(Object.keys(parseAwsIni(out))).toEqual(['default'])
  })
})

describe('nhiều edit trong một lần', () => {
  it('áp tuần tự: tạo rồi đổi tên rồi thêm khoá', () => {
    const out = editAwsIni('[default]\nregion = a\n', [
      { op: 'upsertSection', section: 'profile tmp', keys: { region: 'b' } },
      { op: 'renameSection', from: 'profile tmp', to: 'profile dev' },
      { op: 'upsertSection', section: 'profile dev', keys: { output: 'json' } },
    ])
    expect(out).toBe('[default]\nregion = a\n\n[profile dev]\nregion = b\noutput = json\n')
  })
})

describe('copySection', () => {
  const CREDS = [
    '# khoá cá nhân',
    '[default]',
    'aws_access_key_id = AKIAIOSFODNN7EXAMPLE',
    `aws_secret_access_key = ${FAKE_SECRET}`,
    'aws_session_token = IQoJb3JpZ2luX2VjEXAMPLE',
    'x_security_token_expires = 2026-09-13T10:00:00Z',
    '',
  ].join('\n')

  it('chép nguyên văn từng dòng, kể cả secret và khoá không mô hình hoá', () => {
    const out = editAwsIni(CREDS, [{ op: 'copySection', from: 'default', to: 'clone' }])

    const lines = out.split('\n')
    const at = lines.indexOf('[clone]')
    expect(at).toBeGreaterThan(0)
    expect(lines.slice(at + 1, at + 5)).toEqual([
      'aws_access_key_id = AKIAIOSFODNN7EXAMPLE',
      `aws_secret_access_key = ${FAKE_SECRET}`,
      'aws_session_token = IQoJb3JpZ2luX2VjEXAMPLE',
      'x_security_token_expires = 2026-09-13T10:00:00Z',
    ])
    // Bản gốc và comment của nó không suy suyển.
    expect(out).toContain('# khoá cá nhân')
    const parsed = parseAwsIni(out)
    expect(parsed['clone']!.hasStaticKeys).toBe(true)
    expect(parsed['clone']!.hasSessionToken).toBe(true)
    expect(parsed['default']!.hasStaticKeys).toBe(true)
  })

  it('giữ cả khoá lạ và block thụt của section nguồn', () => {
    const src = ['[profile dev]', 'region = a', 'cli_pager =', 's3 =', '  max_concurrent_requests = 20', ''].join('\n')
    const out = editAwsIni(src, [
      { op: 'copySection', from: 'profile dev', to: 'profile dev-copy' },
    ])
    const body = out.slice(out.indexOf('[profile dev-copy]'))
    expect(body).toContain('cli_pager =')
    expect(body).toContain('  max_concurrent_requests = 20')
  })

  it('từ chối khi đích đã tồn tại, trừ khi overwrite', () => {
    const src = '[profile a]\nregion = one\n\n[profile b]\nregion = two\n'
    expect(() =>
      editAwsIni(src, [{ op: 'copySection', from: 'profile a', to: 'profile b' }]),
    ).toThrow(/already exists/)

    const out = editAwsIni(src, [
      { op: 'copySection', from: 'profile a', to: 'profile b', overwrite: true },
    ])
    // Đúng MỘT `[profile b]`, và nội dung là của `a`.
    expect(out.match(/\[profile b\]/g)).toHaveLength(1)
    expect(parseAwsIni(out)['profile b']!.keys.region).toBe('one')
  })

  it('không chép một section có credential_process', () => {
    const src = '[profile vault]\ncredential_process = /usr/local/bin/vault-aws\n'
    expect(() =>
      editAwsIni(src, [{ op: 'copySection', from: 'profile vault', to: 'profile copy' }]),
    ).toThrow(/credential_process/)
  })

  it('ném khi nguồn không tồn tại, và khi chép lên chính nó', () => {
    expect(() => editAwsIni('[profile a]\nregion = x\n', [
      { op: 'copySection', from: 'profile nope', to: 'profile b' },
    ])).toThrow(/not found/i)
    expect(() => editAwsIni('[profile a]\nregion = x\n', [
      { op: 'copySection', from: 'profile a', to: 'profile a' },
    ])).toThrow(/itself/)
  })

  it('giữ CRLF của file khi chép', () => {
    const src = '[profile a]\r\nregion = x\r\n'
    const out = editAwsIni(src, [{ op: 'copySection', from: 'profile a', to: 'profile b' }])
    expect(out).toContain('[profile b]\r\n')
    expect(out).toContain('region = x\r\n')
    expect(out.split('\n').every((l, i, all) => i === all.length - 1 || l.endsWith('\r'))).toBe(true)
  })
})

// Section khai nhiều lần là chuyện có thật: hai công cụ cùng `>>` vào
// `~/.aws/credentials`, hoặc người dùng copy-paste. Botocore GỘP chúng lại và
// "cái sau thắng" ở từng khoá — nên mọi thao tác chỉ nhìn lần khai đầu tiên đều
// sai, và sai theo kiểu im lặng: file trông như đã đổi mà CLI vẫn chạy giá trị cũ.
describe('section khai nhiều lần', () => {
  it('sửa đúng lần khai mà botocore đang dùng (cái SAU), không phải cái đầu', () => {
    const raw = '[default]\noutput = json\n\n[default]\nregion = old\n'
    const out = editAwsIni(raw, [
      { op: 'upsertSection', section: 'default', keys: { region: 'new' } },
    ])
    expect(parseAwsIni(out)['default']!.keys.region).toBe('new')
    expect(out).toBe('[default]\noutput = json\n\n[default]\nregion = new\n')
  })

  it('khoá mới nối vào lần khai CUỐI để nó thắng', () => {
    const raw = '[default]\nregion = a\n\n[default]\noutput = json\n'
    const out = editAwsIni(raw, [
      { op: 'upsertSection', section: 'default', keys: { mfa_serial: 'arn:aws:iam::1:mfa/k' } },
    ])
    expect(out).toBe('[default]\nregion = a\n\n[default]\noutput = json\nmfa_serial = arn:aws:iam::1:mfa/k\n')
  })

  it('khoá trùng NẰM Ở HAI lần khai: giữ bản cuối, dọn bản trên', () => {
    const raw = '[default]\nregion = a\n\n[default]\nregion = b\n'
    const out = editAwsIni(raw, [
      { op: 'upsertSection', section: 'default', keys: { region: 'z' } },
    ])
    expect(parseAwsIni(out)['default']!.keys.region).toBe('z')
    expect(out.split('\n').filter((l) => l.startsWith('region')).length).toBe(1)
  })

  it('removeKeys xoá khoá ở MỌI lần khai', () => {
    const raw = '[default]\nregion = a\n\n[default]\nregion = b\noutput = json\n'
    const out = editAwsIni(raw, [
      { op: 'upsertSection', section: 'default', keys: {}, removeKeys: ['region'] },
    ])
    expect(parseAwsIni(out)['default']!.keys.region).toBeUndefined()
  })

  it('xoá profile thì xoá CẢ hai lần khai — sót một cái là chưa xoá gì', () => {
    const raw = '[default]\noutput = json\n\n[default]\nregion = old\n'
    const out = editAwsIni(raw, [{ op: 'deleteSection', section: 'default' }])
    expect(parseAwsIni(out)['default']).toBeUndefined()
    expect(out).toBe('')
  })

  it('đổi tên thì đổi MỌI header, thân không bị treo dưới tên cũ', () => {
    const raw = '[a]\noutput = json\n\n[a]\nregion = old\n'
    const out = editAwsIni(raw, [{ op: 'renameSection', from: 'a', to: 'b' }])
    const f = parseAwsIni(out)
    expect(f['a']).toBeUndefined()
    expect(f['b']!.keys).toEqual({ output: 'json', region: 'old' })
  })
})

describe('ranh giới tên section = dấu `]` ĐẦU TIÊN', () => {
  // `\[(?P<header>[^]]+)\]` của botocore/configparser dừng ở `]` đầu tiên. Lấy
  // `lastIndexOf` thì AWOG đọc ra tên khác, không thấy profile đang có, rồi
  // upsert đẻ ra một `[profile dev]` THỨ HAI bên dưới.
  const raw = '[profile dev] ; bucket [prod]\nregion = x\n'

  it('nhận ra profile dù đuôi comment có `]`', () => {
    expect(Object.keys(parseAwsIni(raw))).toEqual(['profile dev'])
  })

  it('upsert sửa tại chỗ thay vì nhân bản section', () => {
    const out = editAwsIni(raw, [
      { op: 'upsertSection', section: 'profile dev', keys: { region: 'y' } },
    ])
    expect(out).toBe('[profile dev] ; bucket [prod]\nregion = y\n')
  })

  it('rename giữ nguyên đuôi comment', () => {
    const out = editAwsIni(raw, [
      { op: 'renameSection', from: 'profile dev', to: 'profile prod' },
    ])
    expect(out).toBe('[profile prod] ; bucket [prod]\nregion = x\n')
  })
})

describe('file bẩn kiểu thật', () => {
  it('BOM đầu file không làm mất section', () => {
    const raw = '\uFEFF[default]\nregion = a\n'
    const out = editAwsIni(raw, [
      { op: 'upsertSection', section: 'default', keys: { region: 'b' } },
    ])
    expect(out).toBe('\uFEFF[default]\nregion = b\n')
    expect(parseAwsIni(out)['default']!.keys.region).toBe('b')
  })

  it('file chỉ có comment: nối section mới, giữ comment', () => {
    const out = editAwsIni('# hi\n', [
      { op: 'upsertSection', section: 'a', keys: { region: 'x' } },
    ])
    expect(out).toBe('# hi\n\n[a]\nregion = x\n')
  })

  it('CRLF trộn LF: dòng cũ giữ đuôi dòng CỦA NÓ', () => {
    const raw = '[a]\r\nregion = x\n[b]\r\noutput = json\r\n'
    const out = editAwsIni(raw, [{ op: 'upsertSection', section: 'a', keys: { output: 'text' } }])
    expect(out).toContain('region = x\n')
    expect(out).toContain('[b]\r\n')
  })

  it('khoá con trong block thụt trùng tên khoá thật thì KHÔNG bị sửa', () => {
    const raw = '[a]\ns3 =\n  region = nested\nregion = real\n'
    const out = editAwsIni(raw, [
      { op: 'upsertSection', section: 'a', keys: { region: 'changed' } },
    ])
    expect(out).toBe('[a]\ns3 =\n  region = nested\nregion = changed\n')
  })

  it('giá trị chứa `=` và `#` đi qua nguyên vẹn', () => {
    const out = editAwsIni('[a]\n', [
      { op: 'upsertSection', section: 'a', keys: { external_id: 'ab=cd#ef' } },
    ])
    expect(parseAwsIni(out)['a']!.keys.external_id).toBe('ab=cd#ef')
  })

  it('xoá section ĐẦU file', () => {
    const out = editAwsIni('[a]\nregion = 1\n\n[b]\nregion = 2\n', [
      { op: 'deleteSection', section: 'a' },
    ])
    expect(out).toBe('[b]\nregion = 2\n')
  })

  it('xoá section DUY NHẤT để lại file rỗng, không phải file toàn dòng trắng', () => {
    expect(editAwsIni('[a]\nregion = 1\n', [{ op: 'deleteSection', section: 'a' }])).toBe('')
  })
})

describe('tên profile mà AWS cho phép', () => {
  it.each(['229015218011_Offshore-Developer', 'a/b', 'a+b', 'a=b', 'a@b', 'a.b', 'a:b', 'a-b'])(
    '%s tạo và đọc lại được',
    (n: string) => {
      const out = editAwsIni('', [
        { op: 'upsertSection', section: `profile ${n}`, keys: { region: 'x' } },
      ])
      expect(Object.keys(parseAwsIni(out))).toEqual([`profile ${n}`])
    },
  )
})
