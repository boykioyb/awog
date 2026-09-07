// Tests cho redact.ts — bộ lọc bí mật dùng chung cho `sessions.listEvents`,
// export JSON và `read_terminal`.
//
// Chạy: `npx vitest@2 run src/sessions/__tests__/redact.test.ts` (vitest chưa nằm
// trong devDeps của sidecar — xem git/__tests__/discover.test.ts).
//
// Hai chiều đều quan trọng như nhau:
//   - `describe('bắt được')` — các ca RÒ RỈ mà bản cũ để lọt (infosec F6).
//   - `describe('không redact quá tay')` — dữ liệu người dùng mở view debug/export ra
//     để xem. Che nhầm chúng thì hai bề mặt đó mất hết tác dụng, nên chúng là test
//     hồi quy chứ không phải "nice to have".
import { describe, expect, it } from 'vitest'
import { redactDeep, redactString } from '../redact.js'

const REDACTED = '[redacted]'

// Helper: redactDeep trả `unknown` (đúng — output đi ra biên RPC), test cần đọc field.
function deep(value: unknown): Record<string, unknown> {
  return redactDeep(value) as Record<string, unknown>
}

describe('redactDeep — bắt được các ca F6 từng lọt', () => {
  it('khoá bí mật có giá trị là MẢNG (trước đây lớp 1 chỉ áp cho chuỗi)', () => {
    const out = deep({ authorization: ['abc123abc123abc123'] })
    expect(out.authorization).toBe(REDACTED)
  })

  it('khoá bí mật có giá trị là OBJECT — che cả nhánh con, kể cả khoá con lạ tên', () => {
    const out = deep({ credentials: { user: 'a', pass: 'Xy9kkkkkkkkk' } })
    // `pass` không nằm trong danh sách khoá; chỉ che-cả-nhánh mới cứu được ca này.
    expect(out.credentials).toBe(REDACTED)
    expect(JSON.stringify(out)).not.toContain('Xy9')
  })

  it('khoá bí mật có giá trị là SỐ (PIN/mã số)', () => {
    const out = deep({ password: 84213371 })
    expect(out.password).toBe(REDACTED)
  })

  it('header nhạy cảm nằm TRONG chuỗi lệnh (khoá JSON vô hại)', () => {
    const out = deep({
      input: { command: "curl -H 'X-Api-Key: 9f2c8a1e4b7d0f33' https://api.example.com/v1/ping" },
    })
    const command = (out.input as Record<string, unknown>).command
    expect(command).toBe(`curl -H 'X-Api-Key: ${REDACTED}' https://api.example.com/v1/ping`)
  })

  it('biến môi trường gán trực tiếp trước lệnh', () => {
    const out = redactString('PGPASSWORD=Sup3rS3cret psql -h db.internal -U app')
    expect(out).toBe(`PGPASSWORD=${REDACTED} psql -h db.internal -U app`)
  })

  it('dump nhiều dòng header + env (ca terminal thật)', () => {
    const dump = [
      'GET /v1/things HTTP/1.1',
      'X-API-KEY: 8f14e45fceea167a5a36dedd4bea2543',
      'Content-Type: application/json',
      'export GITHUB_TOKEN=ghp_0123456789abcdefghijABCDEFGHIJ',
      'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    ].join('\n')
    const out = redactString(dump)
    expect(out).not.toContain('8f14e45fceea167a5a36dedd4bea2543')
    expect(out).not.toContain('ghp_0123456789abcdefghijABCDEFGHIJ')
    expect(out).not.toContain('wJalrXUtnFEMI')
    // Phần đọc được vẫn còn: tên khoá, dòng vô hại.
    expect(out).toContain('X-API-KEY: [redacted]')
    expect(out).toContain('Content-Type: application/json')
    expect(out).toContain('GET /v1/things HTTP/1.1')
  })

  it('hình dạng token của nhà cung cấp mới: Stripe / GitLab / Azure / npm', () => {
    expect(redactString('sk_test_51HxxxxxxxxxxxxxxxxxxxxYz')).toBe(REDACTED)
    expect(redactString('whsec_abcdefghijklmnopqrstuvwx')).toBe(REDACTED)
    expect(redactString('glpat-ABCDEFGH1234abcd5678')).toBe(REDACTED)
    expect(redactString('abc8Q~zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(REDACTED)
    expect(redactString(`npm_${'a'.repeat(36)}`)).toBe(REDACTED)
  })

  it('URL có credential nhúng — giữ scheme/user, che mật khẩu', () => {
    const out = redactString('psql postgres://app:Hunter2Hunter2@db.internal:5432/prod')
    expect(out).toBe(`psql postgres://app:${REDACTED}@db.internal:5432/prod`)
  })

  it('Authorization: Basic <base64>', () => {
    const out = redactString('Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==')
    expect(out).not.toContain('dXNlcjpwYXNz')
  })

  it('giữ nguyên các ca lớp 2 đã có (không hồi quy)', () => {
    expect(redactString('token sk-ant-api03-AAAAAAAAAAAAAAAAAAAA end')).toBe(
      `token ${REDACTED} end`,
    )
    expect(redactString('AKIAIOSFODNN7EXAMPLE')).toBe(REDACTED)
    expect(redactString('AIzaSyA0000000000000000000000000000000')).toBe(REDACTED)
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP'
    expect(redactString(`Cookie: jwt=${jwt}`)).not.toContain('eyJhbGciOi')
  })

  it('đi sâu qua mảng và object lồng nhau', () => {
    const out = deep({
      messages: [
        { steps: [{ input: { env: { OPENAI_API_KEY: 'sk-proj-AAAAAAAAAAAAAAAAAAAA' } } }] },
      ],
    })
    expect(JSON.stringify(out)).not.toContain('sk-proj-')
  })

  it('không mutate input', () => {
    const input = { apiKey: 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAA' }
    deep(input)
    expect(input.apiKey).toBe('sk-ant-api03-AAAAAAAAAAAAAAAAAAAA')
  })

  it('idempotent — chạy 2 lần cho cùng kết quả', () => {
    const once = redactString("curl -H 'X-Api-Key: 9f2c8a1e4b7d0f33' https://x.dev")
    expect(redactString(once)).toBe(once)
  })
})

describe('redactDeep — cố ý KHÔNG redact', () => {
  it('số liệu đếm token (khoá chứa "token" nhưng giá trị là SỐ)', () => {
    const out = deep({
      usage: {
        inputTokens: 1234,
        outputTokens: 567,
        cacheReadTokens: 89,
        cacheWriteTokens: 0,
        contextTokens: 91234,
        totalTokens: 1890,
      },
      tokensBefore: 4096,
    })
    expect(out.usage).toEqual({
      inputTokens: 1234,
      outputTokens: 567,
      cacheReadTokens: 89,
      cacheWriteTokens: 0,
      contextTokens: 91234,
      totalTokens: 1890,
    })
    expect(out.tokensBefore).toBe(4096)
  })

  it('cờ boolean và null dưới khoá bí mật — trạng thái, không phải bí mật', () => {
    const out = deep({ hasApiKey: true, apiKey: null, isAuthenticated: false })
    expect(out).toEqual({ hasApiKey: true, apiKey: null, isAuthenticated: false })
  })

  it('metadata phiên: id, đường dẫn, tên model, chi phí', () => {
    const input = {
      id: 'ses-01J8ZK9Q0000',
      cwd: '/Users/kyro/KyroTech/Projects/awog',
      model: 'claude-sonnet-4-5-20250929',
      authType: 'oauth',
      authMode: 'subscription',
      costUsd: 0.0421,
      commitCoAuthor: true,
    }
    expect(deep(input)).toEqual(input)
  })

  it('SHA commit, hash nội dung, id dài — KHÔNG có luật "chuỗi entropy cao trần"', () => {
    const text =
      'HEAD 4d4adfe8f0c9b3a71e2d5c6b8a90f1e2d3c4b5a6 sha256:8f14e45fceea167a5a36dedd4bea2543 build ok'
    expect(redactString(text)).toBe(text)
  })

  it('văn xuôi có từ khoá nhạy cảm nhưng không phải gán bí mật', () => {
    const prose = 'Token: Reserved for later. The API key lives in 1Password, ask Minh.'
    expect(redactString(prose)).toBe(prose)
    expect(redactString('token: null')).toBe('token: null')
    expect(redactString('maxTokens=100000')).toBe('maxTokens=100000')
    expect(redactString('contextTokens: 87%')).toBe('contextTokens: 87%')
  })

  it('đường dẫn và phiên bản không bị lớp 3 nuốt', () => {
    const text = 'keyFile=/Users/kyro/.ssh/config token: v1.2.3 author: Nguyen Van A'
    expect(redactString(text)).toBe(text)
  })

  it('lệnh và output thường của terminal', () => {
    const text = [
      '$ pnpm build',
      '> @awog/sidecar@0.34.0 build /Users/kyro/KyroTech/Projects/awog/apps/desktop/sidecar',
      'ELIFECYCLE Command failed with exit code 1.',
    ].join('\n')
    expect(redactString(text)).toBe(text)
  })

  it('data URL bị cắt bytes nhưng giữ mime + độ dài (không phải bí mật)', () => {
    const out = redactString(`data:image/png;base64,${'A'.repeat(100)}`)
    expect(out).toBe('data:image/png;base64,[stripped: 100 base64 chars]')
  })

  it('giá trị nguyên thuỷ ngoài object đi qua nguyên vẹn', () => {
    expect(redactDeep(42)).toBe(42)
    expect(redactDeep(null)).toBe(null)
    expect(redactDeep(true)).toBe(true)
  })

  it('cắt ở độ sâu tối đa thay vì tràn stack', () => {
    let node: Record<string, unknown> = { leaf: 'ok' }
    for (let i = 0; i < 40; i += 1) node = { child: node }
    expect(JSON.stringify(deep(node))).toContain('[truncated: too deep]')
  })
})
