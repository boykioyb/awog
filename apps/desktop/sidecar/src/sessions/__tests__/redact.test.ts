// Tests cho redact.ts — bộ lọc bí mật dùng chung cho `sessions.listEvents`,
// export JSON và `read_terminal`.
//
// Chạy: `npx vitest@2 run src/sessions/__tests__/redact.test.ts` (vitest chưa nằm
// trong devDeps của sidecar — xem git/__tests__/discover.test.ts).
//
// Hai chiều đều quan trọng như nhau:
//   - `describe('bắt được')` — các ca RÒ RỈ mà bản cũ để lọt (infosec F6, F2).
//   - `describe('không redact quá tay')` — dữ liệu người dùng mở view debug/export ra
//     để xem, VÀ mã nguồn trên đường vào prompt của model (infosec F4). Che nhầm chúng
//     thì hai bề mặt debug mất tác dụng và model nhận bằng chứng sai, nên chúng là
//     test hồi quy chứ không phải "nice to have".
//   - `describe('hiệu năng')` — bộ lọc chạy trên luồng DUY NHẤT của sidecar, nên độ
//     phức tạp là một yêu cầu bảo mật (infosec F3).
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
      input: {
        command: "curl -H 'X-Api-Key: 9f2c8a1e4b7d0f33' https://api.example.com/v1/ping",
      },
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
        {
          steps: [
            {
              input: {
                env: { OPENAI_API_KEY: 'sk-proj-AAAAAAAAAAAAAAAAAAAA' },
              },
            },
          ],
        },
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

describe('redactDeep — F2: JSON nằm TRONG chuỗi và cờ CLI', () => {
  // Lớp 1 chỉ chạy trên object THẬT. Cái đi qua `read_terminal` là JSON đã bị in ra
  // thành MỘT chuỗi, nơi sau tên khoá là dấu nháy chứ không phải dấu hai chấm.
  it('khoá JSON nằm trong nháy — dạng rò rỉ phổ biến nhất của tool I/O', () => {
    expect(redactString('{"apiKey":"abcd1234efgh5678ijkl"}')).toBe(`{"apiKey":"${REDACTED}"}`)
    expect(redactString('{"api_key": "abcd1234efgh5678ijkl"}')).toBe(`{"api_key": "${REDACTED}"}`)
    expect(redactString('{ "password" : "hunter2hunter2" }')).toBe(`{ "password" : "${REDACTED}" }`)
    expect(redactString("{'token': 'abcd1234efgh5678'}")).toBe(`{'token': '${REDACTED}'}`)
  })

  it('`cat ~/.awog/credentials.json` — key của endpoint tuỳ biến KHÔNG có tiền tố', () => {
    const dump = '{"accessToken":"abcd1234efgh5678ijkl","refreshToken":"zzzz9999yyyy8888"}'
    const out = redactString(dump)
    expect(out).not.toContain('abcd1234')
    expect(out).not.toContain('zzzz9999')
    // Hình dạng JSON vẫn còn đọc được — đó là lý do người dùng mở view debug.
    expect(out).toBe(`{"accessToken":"${REDACTED}","refreshToken":"${REDACTED}"}`)
  })

  it('cờ CLI dài, giá trị cách bằng khoảng trắng', () => {
    expect(redactString('mysql --password hunter2hunter2')).toBe(`mysql --password ${REDACTED}`)
    expect(redactString("psql --password='hunter2hunter2'")).toBe(`psql --password='${REDACTED}'`)
    expect(redactString('gh auth login --token 9f2c8a1e4b7d0f33aa')).toBe(
      `gh auth login --token ${REDACTED}`,
    )
    expect(redactString('curl -u admin --password Sup3rS3cret')).toBe(
      `curl -u admin --password ${REDACTED}`,
    )
  })

  it('cờ ngắn `-p` CHỈ sau lệnh mà `-p` thật sự là mật khẩu', () => {
    expect(redactString('docker login -u me -p hunter2hunter2')).toBe(
      `docker login -u me -p ${REDACTED}`,
    )
    expect(redactString('mysql -h db.internal -u app -p Sup3rS3cret')).toBe(
      `mysql -h db.internal -u app -p ${REDACTED}`,
    )
  })

  it('idempotent trên các dạng mới', () => {
    for (const input of [
      '{"apiKey":"abcd1234efgh5678ijkl"}',
      'mysql --password hunter2hunter2',
      'docker login -u me -p hunter2hunter2',
    ]) {
      const once = redactString(input)
      expect(redactString(once)).toBe(once)
    }
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
    expect(out).toEqual({
      hasApiKey: true,
      apiKey: null,
      isAuthenticated: false,
    })
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

describe('redactString — F4: mã nguồn và lệnh KHÔNG được đụng tới', () => {
  // Ba mẫu dưới đây lấy từ 366 dòng JSONL thật của 40 phiên, nơi bản trước sửa
  // `.steps[].detail.content` 207 lần, `.detail.output` 38 lần, `.detail.diff` 27 lần.
  // Đây không chỉ là lỗi UX: `redactString` chạy trên ĐƯỜNG VÀO prompt, nên model đọc
  // `const token = [redacted] | null>(…` rồi "sửa" một dòng code không tồn tại.
  it('khai báo biến có generic / gọi hàm / truy cập thuộc tính', () => {
    for (const line of [
      "const token = useCookie<string | null>('pms_auth_token', {…})",
      'const secret = process.env.MY_SECRET',
      'apiKey: options.apiKey ?? undefined',
      'password = models.CharField(max_length=128)',
      'credentials: await loadCredentials(),',
      '+  const authToken = ref<string | null>(null)',
    ]) {
      expect(redactString(line)).toBe(line)
    }
  })

  it('giá trị là ĐỊNH DANH (tên biến), không phải bí mật', () => {
    expect(redactString('password: hashedPassword,')).toBe('password: hashedPassword,')
    expect(redactString('token: accessToken,')).toBe('token: accessToken,')
    expect(redactString('secret_key: hashed_secret_key')).toBe('secret_key: hashed_secret_key')
  })

  it('lệnh shell: glob, nội suy, placeholder', () => {
    for (const line of [
      "sed 's/PASSWORD=.*/PASSWORD=***/'",
      'TOKEN=$(cat /tmp/t)',
      'export API_KEY=$MY_API_KEY',
      'secret_key: <your-key-here>',
      'docker login -u me --password-stdin',
    ]) {
      expect(redactString(line)).toBe(line)
    }
  })

  it('`-p` của lệnh khác là cổng/đường dẫn, không phải mật khẩu', () => {
    for (const line of [
      'mkdir -p /Users/kyro/KyroTech/Projects/awog/.awog',
      'docker run -p 8080:80 nginx:alpine',
      'redis-cli -p 6379 ping',
      'rsync -avz -p ./dist/ server:/srv/app/',
    ]) {
      expect(redactString(line)).toBe(line)
    }
  })

  it('văn xuôi và nhãn sơ đồ có từ khoá nhạy cảm', () => {
    const erd = 'otp_code ||--|| verification_token : "phát sau verify"'
    expect(redactString(erd)).toBe(erd)
    const doc = '- secret: the value read from keychain'
    expect(redactString(doc)).toBe(doc)
  })

  it('CỐ Ý bỏ lọt: giá trị toàn chữ cái, không chữ số, không ký hiệu', () => {
    // Luật cũ "dài ≥ 12 ký tự là đủ" bắt được ca này, nhưng chính nó gây 272 lần che
    // nhầm đo được ở trên. Bí mật thật gần như luôn có chữ số hoặc ký hiệu; một chuỗi
    // toàn chữ sau `password:` gần như luôn là tên biến. Đây là đánh đổi CÓ CHỦ Ý,
    // ghi ra thành test để lần sau đổi ý thì phải đổi tường minh.
    expect(redactString('password: abcdefghijkl')).toBe('password: abcdefghijkl')
    // Ngay khi có một chữ số thì lại bị che.
    expect(redactString('password: abcdefghijk1')).toBe(`password: ${REDACTED}`)
  })

  it('lớp 3 VẪN chạy trên nội dung file — `Write` một file .env là rò rỉ thật', () => {
    const out = deep({
      name: 'Write',
      detail: { content: 'DB_HOST=localhost\nDB_PASSWORD=Sup3rS3cret123\n' },
    })
    const detail = out.detail as Record<string, unknown>
    expect(detail.content).toBe(`DB_HOST=localhost\nDB_PASSWORD=${REDACTED}\n`)
  })
})

describe('redactString — F3: độ phức tạp tuyến tính', () => {
  // Sidecar chạy MỘT luồng và phục vụ mọi RPC. Bản trước có hai regex bậc hai, nên
  // `sessions.save-export` trên một transcript vài trăm KB đứng hình hàng chục giây —
  // đủ để lỡ 3 nhịp heartbeat và bị `killWedged()` giết engine giữa lượt. Số đo cũ:
  // 25k → 909ms, 50k → 3.4s, 100k → 13.8s, 200k → 56.9s (gấp đôi input = gấp bốn giờ).
  // Ngân sách dưới đây rộng gấp nhiều lần số đo sau khi vá (~30ms) nên nó chỉ đỏ khi
  // có ai đó thêm lại một lượng tử không trần.
  const BUDGET_MS = 2_000

  it.each([
    ['PEM thiếu dấu END', '-----BEGIN RSA PRIVATE KEY-----' + 'A'.repeat(200_000)],
    ['dãy chữ-số dài trần', 'A'.repeat(200_000)],
    ['gán với giá trị dài', 'password=' + 'A'.repeat(200_000)],
    ['nháy mở không bao giờ đóng', 'password="' + 'A'.repeat(200_000)],
    ['nhiều mốc BEGIN', '-----BEGIN RSA PRIVATE KEY-----'.repeat(6_000)],
  ])('%s — 200 KB xong dưới ngân sách', (_name, input) => {
    const started = performance.now()
    redactString(input)
    expect(performance.now() - started).toBeLessThan(BUDGET_MS)
  })

  it('vẫn bắt được khối PEM thật sau khi thân bị đặt trần', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEow'.repeat(20),
      '-----END RSA PRIVATE KEY-----',
    ].join('\n')
    expect(redactString(`key:\n${pem}\ndone`)).toBe(`key:\n${REDACTED}\ndone`)
  })

  it('chuỗi vượt trần đầu vào bị CẮT, không bị bỏ lọc', () => {
    const over = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAA ' + 'x'.repeat(1024 * 1024)
    const out = redactString(over)
    expect(out).not.toContain('sk-ant-api03-')
    expect(out).toContain('[truncated:')
    expect(out).toContain('chars over the redaction cap]')
    expect(out.length).toBeLessThan(over.length)
  })
})

// Ngữ cảnh "vế phải LÀ thông tin đăng nhập": khoá kiểu biến môi trường và cờ CLI.
//
// Nhóm này ra đời từ một phép ĐO, không phải suy đoán: quét 577 phiên thật trong
// ~/.awog/sessions cho ~950 lần khớp mà bộ lọc đang bỏ qua, phần áp đảo là thông tin
// đăng nhập thật (`POSTGRES_PASSWORD=pwpf_dev`, `MINIO_ROOT_PASSWORD=minioadmin`).
// Thủ phạm là hàng rào "định danh thuần" `^[A-Za-z_][A-Za-z_.-]*$` — nó chặn che
// nhầm tên biến trong mã nguồn, nhưng cũng nuốt mọi bí mật toàn chữ/có gạch nối.
describe('redactString — khoá biến môi trường và cờ CLI', () => {
  it('bí mật toàn chữ / có gạch nối sau khoá IN HOA vẫn bị che', () => {
    // Không có chữ số, không có ký hiệu "mùi bí mật" ⇒ luật chặt bỏ lọt hết.
    expect(redactString('MINIO_ROOT_PASSWORD=minioadmin')).toBe(`MINIO_ROOT_PASSWORD=${REDACTED}`)
    expect(redactString('DB_PASSWORD=postgres')).toBe(`DB_PASSWORD=${REDACTED}`)
    expect(redactString('SECRET_KEY="change-me-in-production"')).toBe(`SECRET_KEY="${REDACTED}"`)
    expect(redactString('APP_JWT_SECRET=doi-bi-mat-nay-truoc-khi-len-that')).toBe(
      `APP_JWT_SECRET=${REDACTED}`,
    )
  })

  it('cụm mật khẩu NHIỀU TỪ trong nháy bị che ở ngữ cảnh env/CLI', () => {
    // Luật chặt loại mọi giá trị có khoảng trắng (chống che nhầm mã nguồn), nên bốn
    // từ thường — dạng passphrase được khuyến nghị rộng rãi — từng lọt sạch.
    expect(redactString('SSH_PASSPHRASE="correct horse battery staple"')).toBe(
      `SSH_PASSPHRASE="${REDACTED}"`,
    )
    expect(redactString("ssh-keygen -t ed25519 -N 'correct horse battery staple' -f k")).toBe(
      `ssh-keygen -t ed25519 -N '${REDACTED}' -f k`,
    )
    expect(redactString('--passphrase "correct horse battery staple"')).toBe(
      `--passphrase "${REDACTED}"`,
    )
  })

  it('nới cho env/CLI KHÔNG mở lại cửa cho biểu thức shell', () => {
    // `relaxed` chỉ tha khoảng trắng và "định danh thuần"; ký tự cú pháp vẫn loại.
    expect(redactString('MY_TOKEN="$(cat /tmp/t)"')).toBe('MY_TOKEN="$(cat /tmp/t)"')
    expect(redactString('API_KEY=${SOME_OTHER}')).toBe('API_KEY=${SOME_OTHER}')
  })

  it('khoá viết THƯỜNG không được nới — nhãn giao diện phải đi qua nguyên vẹn', () => {
    // Ranh giới cố ý. Đo trên cùng bộ 577 phiên: nới cho khoá thường che thêm 104
    // chuỗi mà gần như tất cả là nhãn i18n, và KHÔNG bắt thêm bí mật thật nào. Cái
    // giá là một cụm mật khẩu toàn chữ sau khoá thường vẫn lọt — không có dấu hiệu
    // cấu trúc nào tách nó khỏi một nhãn giao diện.
    expect(redactString('"password": "Nhập mật khẩu"')).toBe('"password": "Nhập mật khẩu"')
    expect(redactString('"password": "Enter your password"')).toBe(
      '"password": "Enter your password"',
    )
    expect(redactString('passphrase="correct horse battery staple"')).toBe(
      'passphrase="correct horse battery staple"',
    )
  })

  it('`-N` chỉ mang nghĩa passphrase sau ssh-keygen', () => {
    // Cùng hàng rào với `-p`: `-N` ở lệnh khác nghĩa hoàn toàn khác.
    expect(redactString('sort -N mydatafile')).toBe('sort -N mydatafile')
    expect(redactString('grep -N pattern file')).toBe('grep -N pattern file')
  })
})
