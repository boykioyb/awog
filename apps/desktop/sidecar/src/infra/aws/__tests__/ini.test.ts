// Parser này đứng giữa file credential thật của người dùng và phần còn lại của
// sidecar, nên allowlist khoá là load-bearing chứ không phải dọn dẹp cho đẹp
// (invariant #1 — ADR 0088 §1).
import { describe, expect, it } from 'vitest'
import { parseAwsIni } from '../ini.js'

// Giá trị giả, không phải khoá thật: dùng chuỗi mốc để `expect(...).not.toContain`
// bắt được nếu parser lỡ tay giữ lại.
const FAKE_SECRET = 'wJalrXUtnFEMI-K7MDENG-bPxRfiCYEXAMPLEKEY'
const FAKE_TOKEN = 'IQoJb3JpZ2luX2VjEXAMPLESESSIONTOKEN'

describe('secret keys never reach the result', () => {
  const raw = [
    '[229015218011_Offshore-Developer]',
    'aws_access_key_id = AKIAIOSFODNN7EXAMPLE',
    `aws_secret_access_key = ${FAKE_SECRET}`,
    `aws_session_token = ${FAKE_TOKEN}`,
    'region = ap-southeast-1',
  ].join('\n')

  it('turns credentials into booleans and keeps nothing else', () => {
    const s = parseAwsIni(raw)['229015218011_Offshore-Developer']!
    expect(s.hasStaticKeys).toBe(true)
    expect(s.hasSessionToken).toBe(true)
    expect(Object.keys(s.keys).sort()).toEqual(['region'])
  })

  it('leaves no trace of the secret anywhere in the serialized output', () => {
    const dumped = JSON.stringify(parseAwsIni(raw))
    expect(dumped).not.toContain(FAKE_SECRET)
    expect(dumped).not.toContain(FAKE_TOKEN)
    expect(dumped).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(dumped).not.toContain('aws_secret_access_key')
  })

  it('flags static keys even when only one half of the pair is present', () => {
    const s = parseAwsIni('[a]\naws_access_key_id = AKIAIOSFODNN7EXAMPLE')['a']!
    expect(s.hasStaticKeys).toBe(true)
    expect(s.hasSessionToken).toBe(false)
    expect(s.keys).toEqual({})
  })
})

describe('sections', () => {
  it('keeps `[profile x]` and `[x]` verbatim — config and credentials name them differently', () => {
    const f = parseAwsIni('[profile dev]\nregion = us-east-1\n\n[dev]\noutput = json')
    expect(Object.keys(f)).toEqual(['profile dev', 'dev'])
    expect(f['profile dev']!.keys.region).toBe('us-east-1')
    expect(f['dev']!.keys.output).toBe('json')
  })

  it('collapses whitespace inside a header and ignores what follows the bracket', () => {
    const f = parseAwsIni('[profile   dev]  ; work account\nregion = eu-west-1')
    expect(f['profile dev']!.keys.region).toBe('eu-west-1')
  })

  it('merges a section declared twice', () => {
    const f = parseAwsIni('[default]\nregion = us-east-1\n[default]\noutput = json')
    expect(f['default']!.keys).toEqual({ region: 'us-east-1', output: 'json' })
  })

  it('drops keys that appear before any section header', () => {
    expect(parseAwsIni('region = us-east-1')).toEqual({})
  })

  it('drops a malformed header and the keys under it', () => {
    const f = parseAwsIni('[default]\nregion = us-east-1\n[broken\noutput = json')
    expect(f['default']!.keys).toEqual({ region: 'us-east-1' })
    expect(Object.keys(f)).toEqual(['default'])
  })
})

describe('lines', () => {
  it('skips both comment styles', () => {
    const f = parseAwsIni(
      ['; a comment', '# another one', '[default]', '; region = wrong', 'region = us-east-1'].join(
        '\n',
      ),
    )
    expect(f['default']!.keys).toEqual({ region: 'us-east-1' })
  })

  it('handles CRLF', () => {
    const f = parseAwsIni('[default]\r\nregion = us-east-1\r\noutput = json\r\n')
    expect(f['default']!.keys).toEqual({ region: 'us-east-1', output: 'json' })
  })

  it('tolerates any spacing around the delimiter and lowercases the key', () => {
    const f = parseAwsIni('[default]\nregion=us-east-1\n  Output   =   json  ')
    expect(f['default']!.keys).toEqual({ region: 'us-east-1', output: 'json' })
  })

  it('lets the last duplicate key win', () => {
    const f = parseAwsIni('[default]\nregion = us-east-1\nregion = ap-southeast-1')
    expect(f['default']!.keys.region).toBe('ap-southeast-1')
  })

  it('ignores junk lines with no delimiter', () => {
    const f = parseAwsIni('[default]\nthis is not a key\n= orphan value\nregion = us-east-1')
    expect(f['default']!.keys).toEqual({ region: 'us-east-1' })
  })

  it('drops a nested block and everything indented under it', () => {
    const f = parseAwsIni(
      [
        '[default]',
        'region = us-east-1',
        's3 =',
        '  max_concurrent_requests = 20',
        '  region = WRONG',
        'output = json',
      ].join('\n'),
    )
    expect(f['default']!.keys).toEqual({ region: 'us-east-1', output: 'json' })
  })
})

describe('allowlist', () => {
  it('keeps the profile metadata AWOG models', () => {
    const f = parseAwsIni(
      [
        '[profile sso]',
        'sso_session = corp',
        'sso_start_url = https://d-9xx.awsapps.com/start',
        'sso_region = us-east-1',
        'sso_account_id = 229015218011',
        'sso_role_name = Offshore-Developer',
        'role_arn = arn:aws:iam::229015218011:role/deploy',
        'source_profile = default',
        'mfa_serial = arn:aws:iam::229015218011:mfa/kyro',
        'external_id = ext-1',
        'duration_seconds = 3600',
        'credential_process = /usr/local/bin/cred',
        'x_security_token_expires = 2026-09-12T10:00:00Z',
      ].join('\n'),
    )
    expect(Object.keys(f['profile sso']!.keys).sort()).toEqual([
      'credential_process',
      'duration_seconds',
      'external_id',
      'mfa_serial',
      'role_arn',
      'source_profile',
      'sso_account_id',
      'sso_region',
      'sso_role_name',
      'sso_session',
      'sso_start_url',
      'x_security_token_expires',
    ])
  })

  it('drops unmodelled keys — including `endpoint_url`, which is an SSRF surface', () => {
    const f = parseAwsIni(
      [
        '[default]',
        'endpoint_url = http://169.254.169.254/',
        'cli_pager =less',
        'ca_bundle = /tmp/evil.pem',
        'region = us-east-1',
      ].join('\n'),
    )
    expect(f['default']!.keys).toEqual({ region: 'us-east-1' })
  })
})

describe('empty input', () => {
  it.each([['', 'empty file'], ['\n\n  \n', 'blank lines'], ['; nothing here', 'comment only']])(
    '%j → no sections (%s)',
    (raw: string) => {
      expect(parseAwsIni(raw)).toEqual({})
    },
  )
})
