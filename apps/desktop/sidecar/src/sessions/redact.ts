// Khử bí mật (redaction) cho payload phiên đi RA khỏi sidecar dưới dạng dữ liệu THÔ,
// và cho nội dung L1 đi VÀO prompt của model. Các đường hiện dùng:
//   - `sessions.listEvents` (xem log JSONL để debug)
//   - `sessions.save-export` format 'json' (xuất transcript máy đọc được)
//   - `runtime/tools/read-terminal-tool.ts`, `dev-server-tool.ts`, `browser-tool.ts`
//     (ring buffer/log/response header → gửi thẳng cho nhà cung cấp model)
//   - `sessions/inbox.ts`, `github/pr-watch-block.ts`, `schedules/wakeup.ts`
//     (thân tin liên phiên / khối theo dõi PR / lời hẹn — vừa nằm trên đĩa vừa quay
//     lại context sau này)
//
// Vì sao cần: invariant #1 nói API key không bao giờ rời sidecar. Transcript và buffer
// terminal đều là L1 — nội dung do người dùng gõ, do model sinh, cộng tool I/O (`export
// TOKEN=…`, header HTTP, khối `env` của MCP, `cat .env`). Đường `sessions.get` bình
// thường chỉ trả những dòng chat mà UI vốn đã hiển thị, còn các đường trên phơi bày
// TOÀN BỘ object (kể cả field nội bộ) hoặc đẩy nguyên văn ra ngoài máy — nên chúng đi
// qua bộ lọc này trước.
//
// Nguyên tắc: fail-safe theo hướng che nhiều hơn thiếu, NHƯNG không che tới mức làm
// hỏng công dụng của hai bề mặt debug/export — và quan trọng hơn: một phần LỚN lưu
// lượng đi qua đây là MÃ NGUỒN trên đường vào prompt. Che nhầm một dòng code không
// chỉ xấu UX, nó đưa cho model một bằng chứng SAI (`const token = [redacted] | null>(…`)
// rồi model "sửa" một dòng không tồn tại — đúng failure mode mà EVIDENCE_PROMPT sinh
// ra để chặn. Vì thế lớp 3 cố ý từ chối mọi giá trị có hình dạng biểu thức.
//
// Bộ lọc chạy 3 lớp:
//   1. theo TÊN FIELD (token/secret/password/apiKey/authorization/…): thay CẢ NHÁNH CON
//      bất kể kiểu (chuỗi, mảng, object, số) — vì bí mật hay nấp dưới `{"credentials":
//      {"pass": …}}` hoặc `{"authorization": ["…"]}`. Ba ngoại lệ hẹp ở `keepAsIs()`.
//   2. theo HÌNH DẠNG GIÁ TRỊ trên mọi chuỗi (sk-…, ghp_…, AIza…, JWT, Bearer, PEM,
//      Stripe, GitLab, Azure, URL có credential): thay đúng đoạn khớp, giữ phần văn bản
//      còn lại đọc được.
//   3. theo GÁN `khoá=giá trị` / `khoá: giá trị` / cờ CLI `--password <v>` NẰM TRONG
//      chuỗi: `PGPASSWORD=…`, `curl -H 'X-Api-Key: …'`, `{"apiKey":"…"}` in ra terminal,
//      dump header. Lớp 1 chỉ nhìn khoá JSON của object THẬT nên không thấy những ca
//      này; chúng là dạng rò rỉ phổ biến nhất trong tool I/O và terminal.
// Ngoài ra data URL base64 (ảnh/PDF đính kèm) bị cắt bỏ phần bytes — không phải bí mật,
// nhưng vài MB base64 làm hỏng cả ba bề mặt (xem STRIPPED_DATA_URL).
//
// CỐ Ý KHÔNG bắt:
//   - Chuỗi entropy cao "trần" (hex 32–64 / base64 32–64 không có tiền tố và không đứng
//     sau khoá nhạy cảm). Một luật như thế sẽ nuốt luôn SHA commit, hash nội dung, id
//     nội bộ và mọi đoạn base64 của văn bản thường — tức là xoá sạch thứ mà người dùng
//     mở view debug ra để xem. Blob entropy cao chỉ bị che khi nó đứng SAU một khoá
//     nhạy cảm (lớp 3), nơi ngữ cảnh nói rõ nó là bí mật.
//   - Giá trị sau khoá nhạy cảm mà TOÀN CHỮ CÁI, không chữ số, không ký hiệu
//     (`password: hashedPassword`). Luật cũ "dài ≥ 12 ký tự là đủ" bắt được ca này
//     nhưng đo trên 366 dòng JSONL thật thì nó sửa `.steps[].detail.content` 207 lần,
//     `.detail.output` 38 lần, `.detail.diff` 27 lần — gần như toàn bộ là tên biến.
//     Bí mật thật gần như luôn có chữ số hoặc ký hiệu; tên biến thì không.
//
// KHÔNG tách riêng `detail.diff`/`detail.content` ra khỏi lớp 3: một `Write` ghi file
// `.env` mang đúng `DB_PASSWORD=…` trong `content`, bỏ lớp 3 ở đó là mở lại một lỗ
// thật. Việc thắt `looksSecretValue()` đã xử lý các ca che nhầm đo được, nên không
// cần thêm một ngoại lệ theo tên field.
//
// HIỆU NĂNG là một yêu cầu bảo mật ở đây, không phải chuyện đẹp xấu: sidecar chạy
// một luồng và phục vụ MỌI RPC. Bản trước có hai regex bậc hai (`([a-z][a-z0-9+.-]*`
// của URL và `[A-Za-z0-9_.-]*` mở đầu của lớp 3): mỗi vị trí trong một dãy chữ-số dài
// đều nuốt tới cuối dãy rồi lùi lại, nên 200 KB mất ~57 giây — đủ để lỡ 3 nhịp
// heartbeat và bị `killWedged()` giết engine giữa lượt. Mọi lượng tử "mở" trong file
// này vì thế đều có TRẦN, và `redactString()` có trần độ dài đầu vào.

const REDACTED = '[redacted]'

// Ngưỡng độ sâu — JSON đọc từ đĩa là hữu hạn, cap chỉ để một file bệnh hoạn không
// làm tràn stack. Vượt cap thì thay bằng placeholder thay vì bỏ qua âm thầm.
const MAX_DEPTH = 24
const TOO_DEEP = '[truncated: too deep]'

// Trần độ dài đầu vào của `redactString`. Sau khi các regex đã tuyến tính, 1 MiB chỉ
// tốn vài mili-giây, nên trần này gần như không bao giờ chạm dữ liệu thật (một CHUỖI
// đơn > 1 MiB trong transcript đã vượt xa thứ UI render nổi). Nó là hàng rào cuối:
// dù ai đó thêm một rule bậc hai sau này, chi phí vẫn bị chặn trên. Phần vượt trần bị
// CẮT chứ không cho đi qua — bỏ lọc là rò rỉ, và cắt thì nói rõ đã cắt bao nhiêu.
const MAX_REDACT_INPUT = 1024 * 1024

// Trần cho các lượng tử của lớp 3.
// - Phụ tố tên khoá: `AWS_SECRET_ACCESS_KEY` dài 21 ⇒ 24 dư dùng; đây chính là chỗ
//   từng gây bậc hai nên trần phải NHỎ.
// - Giá trị: đủ cho mọi token/khoá thực tế; PEM dài hơn thì đã có lớp 2 lo.
const MAX_KEY_AFFIX = 24
const MAX_ASSIGN_VALUE = 4096
// Trần thân khối PEM. Khoá RSA 4096-bit ở dạng PEM ~3.2 KB, nên 8 KB là dư.
const MAX_PEM_BODY = 8000

// Tên field mang bí mật, so khớp kiểu CHỨA trên tên đã chuẩn hoá (bỏ '_'/'-',
// lowercase) nên `api_key`, `apiKey`, `API-KEY` đều dính.
const SECRET_KEY_PARTS = [
  'apikey',
  'accesskey',
  'authorization',
  'bearer',
  'clientsecret',
  'cookie',
  'credential',
  'passphrase',
  'password',
  'passwd',
  'privatekey',
  'refreshtoken',
  'secret',
  'token',
] as const

// Tên field bí mật quá ngắn để so kiểu CHỨA — `pass` sẽ dính `bypass`/`passed`/
// `passthrough`, `auth` sẽ dính `author`/`authMode`. Chỉ khớp TUYỆT ĐỐI.
const SECRET_KEY_EXACT: readonly string[] = ['auth', 'pass', 'pwd']

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Trả về danh sách phần bí mật khớp — cần biết khớp vì CÁI GÌ để xử lý ngoại lệ
// "khoá đếm token" bên dưới.
function matchedSecretParts(key: string): readonly string[] {
  const normalized = normalizeKey(key)
  if (SECRET_KEY_EXACT.includes(normalized)) return [normalized]
  return SECRET_KEY_PARTS.filter((part) => normalized.includes(part))
}

// Khoá là CON TRỎ PHÂN TRANG, không phải bí mật.
//
// `nextToken` khớp phần `token` nên lớp 1 và lớp 3 đều che nó — và che một con trỏ
// phân trang thì HỎNG CHỨC NĂNG chứ không bảo vệ được gì. Đo được ngày 2026-09-17:
// stdout của `aws logs filter-log-events` về tới `tailWindow` với
// `"nextToken": "[redacted]"`, nên nút "Đọc thêm" gửi đúng chuỗi đó lên AWS và nhận
// `InvalidParameterException: The specified nextToken is invalid`. Cùng lỗi ngầm với
// `listLogGroups`: nó phân trang bằng chính trường này, nên một tài khoản có hơn 50
// nhóm log sẽ IM LẶNG dừng ở trang đầu.
//
// An toàn vì hai lẽ: `nextToken` là quy ước con trỏ của AWS/Azure (khác hẳn
// `access_token`/`refresh_token` của OAuth), và lớp 2 — theo HÌNH DẠNG giá trị —
// chạy TRƯỚC lớp 3 nên `sk-…`/`ghp_…` nấp dưới khoá này vẫn bị bắt.
//
// Chỉ khai đúng cái đo được là hỏng. Con trỏ của nhà khác (`continuationToken` của
// S3, `pageToken` của Google) thêm vào đây khi nào thật sự dùng tới.
const PAGINATION_CURSOR_KEYS: readonly string[] = ['nexttoken']

function isPaginationCursor(key: string): boolean {
  return PAGINATION_CURSOR_KEYS.includes(normalizeKey(key))
}

// Ba ngoại lệ hẹp cho lớp 1. Điểm chung: giá trị KHÔNG THỂ chứa byte bí mật, nhưng
// che nó đi thì mất thông tin người dùng cần.
//   - `null` dưới `apiKey` = "chưa cấu hình", che thành `[redacted]` là nói dối.
//   - boolean: `hasApiKey: true` là cờ trạng thái, không phải khoá.
//   - SỐ dưới khoá chỉ khớp mỗi 'token' = số liệu đếm (`usage.inputTokens`,
//     `contextTokens`, `maxTokens`, `tokensBefore`) — báo cáo chi phí phải đọc được.
//     Số dưới `password`/`secret`/`apiKey` thì vẫn che (PIN, mã số).
function keepAsIs(val: unknown, parts: readonly string[]): boolean {
  if (val === null || typeof val === 'boolean') return true
  return typeof val === 'number' && parts.length === 1 && parts[0] === 'token'
}

// Hình dạng bí mật phổ biến. Mỗi rule có cờ `g` để thay MỌI lần xuất hiện trong một
// chuỗi dài (một lệnh Bash có thể chứa nhiều key). Cố ý bắt hơi rộng: thà che nhầm
// một chuỗi vô hại còn hơn để lọt một token thật — nhưng mỗi pattern đều phải có
// TIỀN TỐ/CẤU TRÚC riêng, không có luật "chuỗi ngẫu nhiên dài" (xem ghi chú đầu file).
//
// Các rule mở đầu bằng LITERAL (`sk-`, `ghp_`, `AIza`, `eyJ`, …) tuyến tính sẵn: bộ
// máy regex nhảy thẳng tới literal thay vì thử mọi vị trí, nên chúng giữ nguyên
// `{n,}`. Chỉ rule nào mở đầu bằng lượng tử mới cần trần.
const SECRET_VALUE_RULES: readonly { re: RegExp; to: string }[] = [
  // Anthropic / OpenAI / các provider theo cùng quy ước `sk-…`, `sk-ant-…`.
  { re: /sk-[A-Za-z0-9_-]{16,}/g, to: REDACTED },
  // GitHub: ghp_/gho_/ghu_/ghs_/ghr_ + fine-grained PAT.
  { re: /gh[pousr]_[A-Za-z0-9]{16,}/g, to: REDACTED },
  { re: /github_pat_[A-Za-z0-9_]{20,}/g, to: REDACTED },
  // GitLab personal/project access token.
  { re: /glpat-[A-Za-z0-9_-]{16,}/g, to: REDACTED },
  // Google API key.
  { re: /AIza[0-9A-Za-z_-]{20,}/g, to: REDACTED },
  // Slack bot/user/app token.
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, to: REDACTED },
  // AWS access key id (secret key đi kèm không có tiền tố → dựa vào lớp 1 + lớp 3).
  { re: /AKIA[0-9A-Z]{16}/g, to: REDACTED },
  // Stripe secret/restricted key + webhook signing secret.
  { re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g, to: REDACTED },
  { re: /\bwhsec_[A-Za-z0-9]{16,}/g, to: REDACTED },
  // npm automation token, Hugging Face token.
  { re: /\bnpm_[A-Za-z0-9]{30,}/g, to: REDACTED },
  { re: /\bhf_[A-Za-z0-9]{30,}/g, to: REDACTED },
  // Azure AD client secret — dấu `~` sau nhóm 3 ký tự + chữ số + 'Q' là hình dạng
  // riêng của định dạng này, không đụng chuỗi thường. Neo bằng lookbehind chứ không
  // `\b`: `\b` đo biên theo `\w`, mà lớp ký tự ở đây còn có `~` và `.` nên biên rơi
  // sai chỗ và pattern khớp được từ GIỮA một token dài.
  {
    re: /(?<![A-Za-z0-9_~.-])[A-Za-z0-9_~.]{3}[0-9]Q~[A-Za-z0-9_~.-]{28,}/g,
    to: REDACTED,
  },
  // JWT (header.payload.signature).
  {
    re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
    to: REDACTED,
  },
  // Header/CLI `Authorization: Bearer <token>` và `Authorization: Basic <base64>`.
  // Khoảng trắng có trần và KHÔNG dùng `\s` (token nằm cùng dòng với nhãn).
  { re: /[Bb]earer[ \t]{1,8}[A-Za-z0-9._~+/=-]{16,}/g, to: REDACTED },
  { re: /[Bb]asic[ \t]{1,8}[A-Za-z0-9+/]{16,}={0,2}/g, to: REDACTED },
  // Khối PEM private key (RSA/EC/OPENSSH/…). Thân có TRẦN và được gói trong
  // lookahead + backreference — mẹo "atomic group" của JS: một khi thân đã khớp,
  // bộ máy không lùi vào trong nó nữa, nên một khối BEGIN thiếu END không kéo theo
  // vòng lùi nào.
  {
    re: new RegExp(
      `-----BEGIN [A-Z ]{0,${MAX_KEY_AFFIX}}PRIVATE KEY-----` +
        `(?=([\\s\\S]{0,${MAX_PEM_BODY}}?-----END [A-Z ]{0,${MAX_KEY_AFFIX}}PRIVATE KEY-----))\\1`,
      'g',
    ),
    to: REDACTED,
  },
  // URL có credential nhúng: `postgres://user:pass@host`. Giữ scheme + user để dòng
  // log còn đọc được, chỉ thay mật khẩu. Cả ba lượng tử đều có trần — phần scheme
  // `[a-z0-9+.-]*` không trần chính là một trong hai nguồn bậc hai của bản trước.
  {
    re: /([a-z][a-z0-9+.-]{0,24}:\/\/[^\s:@/]{1,256}):[^\s:@/]{1,256}@/gi,
    to: `$1:${REDACTED}@`,
  },
]

// Lớp 3 — gán `khoá = giá trị` nằm TRONG một chuỗi. Không dùng `\b` mà cho phép tiền
// tố/hậu tố tuỳ ý (`X-Api-Key`, `PGPASSWORD`, `AWS_SECRET_ACCESS_KEY`, `myToken`).
// Cố ý KHÔNG có `auth` trần (dính `author: "…"`) và không có `key` trần (dính
// `keyFile=/path`, `keyboard=…`).
const ASSIGN_KEY_WORDS =
  'password|passwd|passphrase|secret|token|credential|authorization|api[_-]?key|access[_-]?key|private[_-]?key'

// Ba dạng giá trị: trong nháy kép, trong nháy đơn, hoặc trần. Dùng chung cho gán và
// cho cờ CLI. Trần `MAX_ASSIGN_VALUE` giữ mọi nhánh ở một lượng tử duy nhất —
// lượng tử lồng nhau (kể cả khi cả hai đều có trần) là đa thức, không tuyến tính.
const ASSIGN_VALUE_ALT =
  `(?:"([^"\\n]{4,${MAX_ASSIGN_VALUE}})"` +
  `|'([^'\\n]{4,${MAX_ASSIGN_VALUE}})'` +
  `|([^\\s"'\\n,;]{4,${MAX_ASSIGN_VALUE}}))`

// Dấu phân cách giới hạn ở space/tab (KHÔNG `\s`): `\s` nuốt cả xuống dòng nên
// `Token:\n\nMột câu văn` sẽ bị coi là gán.
//
// `["']?` ở đầu nhóm phân cách là chỗ vá của F2: trong JSON in ra terminal, sau tên
// khoá là dấu NHÁY rồi mới tới `:` (`{"apiKey":"…"}`). Lớp 1 không cứu ca này — nó
// chỉ chạy trên object THẬT, còn đây là JSON nằm BÊN TRONG một chuỗi, đúng thứ mà
// `read_terminal` (`cat ~/.awog/credentials.json`) và log CI mang theo. Nháy nằm
// trong nhóm phân cách nên được phát lại nguyên văn.
const SENSITIVE_ASSIGN_RE = new RegExp(
  `([A-Za-z0-9_.-]{0,${MAX_KEY_AFFIX}}(?:${ASSIGN_KEY_WORDS})[A-Za-z0-9_.-]{0,${MAX_KEY_AFFIX}})` +
    `(["']?[ \\t]*[:=][ \\t]*)` +
    ASSIGN_VALUE_ALT,
  'gi',
)

// Cờ CLI dài mang giá trị CÁCH BẰNG KHOẢNG TRẮNG — `mysql --password hunter2`,
// `gh auth login --token …`. Dạng `--password=…` đã do SENSITIVE_ASSIGN_RE lo.
// Chỉ nhận đúng tên cờ rồi khoảng trắng: `--password-stdin` (docker, không có giá
// trị) hay `--password-file /path` vì thế KHÔNG khớp.
const CLI_FLAG_WORDS =
  'password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|' +
  'access[_-]?token|refresh[_-]?token|auth[_-]?token'

const CLI_LONG_FLAG_RE = new RegExp(`(--(?:${CLI_FLAG_WORDS})[ \\t]+)${ASSIGN_VALUE_ALT}`, 'gi')

// Cờ NGẮN `-p` chỉ được hiểu là mật khẩu khi đứng sau một lệnh mà `-p` thật sự là
// mật khẩu. Không có hàng rào này thì `mkdir -p /some/path` và `docker run -p 8080:80`
// bị che — `-p` là cờ mơ hồ nhất trong shell.
const CLI_PASSWORD_TOOLS = 'docker[ \\t]+login|mysqladmin|mysqldump|mysql|redis-cli|mongosh|mongo'

const CLI_SHORT_FLAG_RE = new RegExp(
  `((?:${CLI_PASSWORD_TOOLS})[^\\n]{0,120}?[ \\t]-p[ \\t]+)${ASSIGN_VALUE_ALT}`,
  'gi',
)

// `ssh-keygen -N '<passphrase>'` và `-P` (đổi passphrase cũ). Cùng lý do với `-p`:
// chỉ nhận sau đúng tên lệnh, vì `-N`/`-P` ở lệnh khác mang nghĩa hoàn toàn khác.
const CLI_KEYGEN_FLAG_RE = new RegExp(
  `(ssh-keygen[^\\n]{0,120}?[ \\t]-[NP][ \\t]+)${ASSIGN_VALUE_ALT}`,
  'g',
)

// Giá trị "nhìn là biết không phải bí mật" — placeholder của chính bộ lọc này (giữ
// tính idempotent), literal của config, và cờ.
const PLACEHOLDER_VALUES: readonly string[] = [
  REDACTED,
  'null',
  'undefined',
  'true',
  'false',
  'none',
  'nil',
  'empty',
  'unset',
]

// Số/tỉ lệ: `maxTokens=100000`, `contextTokens: 87%` — số liệu, không phải bí mật.
const NUMERIC_VALUE_RE = /^[0-9][0-9.,_%]*$/
// Chuỗi phiên bản: `token: v1.2.3`. Có chữ số nên sẽ dính luật "mùi bí mật", nhưng
// hình dạng semver thì không bao giờ là bí mật.
const VERSION_VALUE_RE = /^v?[0-9]+(?:\.[0-9]+)+$/
// Ký tự CÚ PHÁP: generic (`<>`), gọi hàm/nhóm (`()`), object/nội suy (`{}$`), glob
// (`*`), template (backtick), và khoảng trắng nội bộ. Một bí mật thật không chứa
// chúng; một biểu thức thì gần như luôn có. Đây là hàng rào chính chống che nhầm mã
// nguồn — `useCookie<string`, `models.CharField(max_length=128)`, `$(cat /tmp/t)`,
// `<your-key-here>`, `'phát sau verify'` đều rơi vào đây.
const CODE_SYNTAX_RE = /[()<>{}[\]$*`\s]/
// Cùng lớp trên nhưng BỎ khoảng trắng — dùng cho ngữ cảnh `relaxed` (xem bên dưới).
const CODE_SYNTAX_NO_WS_RE = /[()<>{}[\]$*`]/
// Định danh thuần: tên biến/hằng/đường dẫn thuộc tính KHÔNG có chữ số
// (`hashedPassword`, `process.env.MY_SECRET`, `read-only`). Phải kiểm TRƯỚC luật
// "mùi bí mật" vì `_` và `-` xuất hiện đầy trong snake_case/kebab-case.
const PLAIN_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z_.-]*$/
// Ký tự "mùi bí mật". Cố ý KHÔNG có `-` và `.`: `Token: read-only`, `token: v1.2.3`
// là văn xuôi/phiên bản, che chúng chỉ tạo nhiễu.
const SECRET_ISH_SYMBOL_RE = /[_+/=~@%&#!]/

// Khoá kiểu BIẾN MÔI TRƯỜNG (`PGPASSWORD`, `SSH_PASSPHRASE`). Xem `RELAXED` bên dưới.
const ENV_STYLE_KEY_RE = /^[A-Z][A-Z0-9_]*$/

// Ngữ cảnh "không bao giờ chứa nhãn giao diện": khoá kiểu biến môi trường và cờ CLI.
// `PGPASSWORD=…`, `SSH_PASSPHRASE="…"`, `--token …`, `ssh-keygen -N '…'` là những
// chỗ mà VẾ PHẢI, theo định nghĩa, LÀ thông tin đăng nhập. Ở đó hai hàng rào
// chống-che-nhầm-mã-nguồn được nới:
//   - khoảng trắng nội bộ không loại giá trị nữa (cụm mật khẩu bốn từ), và
//   - "định danh thuần" không loại giá trị nữa, chỉ cần dài ≥ 6.
//
// Hàng rào "định danh thuần" là chỗ ĐO RA lỗ hổng thật, không phải suy đoán: nó
// khớp `^[A-Za-z_][A-Za-z_.-]*$`, tức nuốt luôn mọi bí mật có gạch nối/toàn chữ.
// Quét 577 phiên thật trong ~/.awog/sessions (chuỗi đã parse, không phải JSONL thô)
// cho ~950 lần khớp thêm, trong đó phần áp đảo là thông tin đăng nhập ĐANG LỌT:
// `POSTGRES_PASSWORD=pwpf_dev`, `MINIO_ROOT_PASSWORD=minioadmin`,
// `AWS_SECRET_ACCESS_KEY=minioadmin`, `DB_PASSWORD=postgres`,
// `SECRET_KEY=change-me-in-production`. Che nhầm còn ~140 lần, toàn là hằng mã lỗi
// (`API_KEY_EXPIRED="unauthorized"`) — nhiễu nhẹ ở bề mặt debug, đổi lấy việc bịt
// một vi phạm bất biến #1.
//
// Vì sao KHÔNG nới cho khoá viết thường (`passphrase: "..."`): cũng đo trên bộ đó,
// nới ra mọi giá trị trong nháy che thêm 104 chuỗi mà gần như tất cả là nhãn UI
// ("Nhập mật khẩu", "Enter your password", "Passwords do not match"), và KHÔNG bắt
// thêm bí mật thật nào. Nên một cụm mật khẩu toàn chữ sau khoá viết thường trong
// file cấu hình vẫn lọt: không có dấu hiệu cấu trúc nào tách nó khỏi một nhãn giao
// diện, và đổi 104 lần hỏng bằng chứng lấy 0 lần bắt được là một vụ đổi tồi.
const RELAXED_MIN_LENGTH = 6

function looksSecretValue(value: string, relaxed = false): boolean {
  const v = value.trim()
  if (v.length < 4) return false
  if (PLACEHOLDER_VALUES.includes(v.toLowerCase())) return false
  if (NUMERIC_VALUE_RE.test(v) || VERSION_VALUE_RE.test(v)) return false
  // Ký tự cú pháp vẫn loại kể cả khi nới: `--token $(cat f)` là lệnh, không phải bí
  // mật. Chỉ riêng khoảng trắng được tha — và chỉ ở nhánh có nháy, vì giá trị TRẦN
  // đã không thể chứa khoảng trắng (lớp ký tự `[^\s"'\n,;]` của ASSIGN_VALUE_ALT).
  if ((relaxed ? CODE_SYNTAX_NO_WS_RE : CODE_SYNTAX_RE).test(v)) return false
  if (!relaxed && PLAIN_IDENTIFIER_RE.test(v)) return false
  if (/[0-9]/.test(v) || SECRET_ISH_SYMBOL_RE.test(v)) return true
  return relaxed && v.length >= RELAXED_MIN_LENGTH
}

// Thay phần giá trị của một khớp `<đầu><giá trị>`, giữ nguyên đầu (tên khoá + dấu
// phân cách, hoặc tên cờ) và giữ nguyên kiểu nháy. Dùng chung cho cả ba regex lớp 3.
function replaceCapturedValue(
  head: string,
  dq: string | undefined,
  sq: string | undefined,
  bare: string | undefined,
  match: string,
  relaxed = false,
): string {
  const captured = dq ?? sq ?? bare
  if (captured === undefined || !looksSecretValue(captured, relaxed)) return match
  if (dq !== undefined) return `${head}"${REDACTED}"`
  if (sq !== undefined) return `${head}'${REDACTED}'`
  return `${head}${REDACTED}`
}

function redactAssignments(value: string): string {
  SENSITIVE_ASSIGN_RE.lastIndex = 0
  return value.replace(
    SENSITIVE_ASSIGN_RE,
    (match: string, key: string, sep: string, dq?: string, sq?: string, bare?: string) =>
      // Con trỏ phân trang đi qua nguyên vẹn — xem `PAGINATION_CURSOR_KEYS`.
      isPaginationCursor(key)
        ? match
        : replaceCapturedValue(`${key}${sep}`, dq, sq, bare, match, ENV_STYLE_KEY_RE.test(key)),
  )
}

function redactCliFlags(value: string): string {
  let out = value
  // Cả ba đều là ngữ cảnh dòng lệnh ⇒ `relaxed`.
  for (const re of [CLI_LONG_FLAG_RE, CLI_SHORT_FLAG_RE, CLI_KEYGEN_FLAG_RE]) {
    re.lastIndex = 0
    out = out.replace(re, (match: string, head: string, dq?: string, sq?: string, bare?: string) =>
      replaceCapturedValue(head, dq, sq, bare, match, true),
    )
  }
  return out
}

// Data URL base64 của ảnh/PDF đính kèm. Không phải bí mật — nhưng ở bề mặt debug nó
// vô dụng và ở bề mặt export nó thổi file lên hàng chục MB. Giữ lại mime + số ký tự
// base64 để người đọc biết có gì đã bị cắt; bytes gốc vẫn nằm trong
// ~/.awog/sessions/{id}/attachments/.
const BASE64_DATA_URL_RE = /^data:([^;,]*);base64,([\s\S]*)$/

function stripDataUrl(value: string): string | null {
  const m = BASE64_DATA_URL_RE.exec(value)
  if (!m) return null
  return `data:${m[1] ?? ''};base64,[stripped: ${(m[2] ?? '').length} base64 chars]`
}

// Khử bí mật trong một chuỗi (lớp 2 + lớp 3 + cắt data URL). Trả về chính chuỗi cũ
// khi không có gì phải đổi, để không tạo rác cho transcript toàn văn bản thường.
export function redactString(value: string): string {
  const stripped = stripDataUrl(value)
  if (stripped) return stripped
  // Trần độ dài: lọc phần đầu, nói rõ đã bỏ bao nhiêu. Đệ quy đúng một tầng vì lát
  // cắt dài đúng bằng trần. Đặt SAU stripDataUrl để ảnh đính kèm giữ nhãn riêng.
  if (value.length > MAX_REDACT_INPUT) {
    const head = redactString(value.slice(0, MAX_REDACT_INPUT))
    return `${head}\n[truncated: ${value.length - MAX_REDACT_INPUT} chars over the redaction cap]`
  }
  let out = value
  for (const rule of SECRET_VALUE_RULES) {
    // Regex có cờ `g` dùng chung giữa các lần gọi: `replace` tự reset lastIndex,
    // nhưng đặt lại tường minh để không phụ thuộc chi tiết đó.
    rule.re.lastIndex = 0
    out = out.replace(rule.re, rule.to)
  }
  return redactAssignments(redactCliFlags(out))
}

// Đi sâu toàn bộ giá trị JSON, trả về BẢN SAO đã khử bí mật. Không bao giờ mutate
// input: `sessions.save-export` nhận Session đang nằm trong cache ấm của
// sessionManager, làm bẩn nó là làm hỏng transcript của phiên đang chạy.
export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return TOO_DEEP
  if (typeof value === 'string') return redactString(value)
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    // Lớp 1 — field mang tên bí mật ⇒ che CẢ NHÁNH CON, bất kể kiểu. Bí mật nấp dưới
    // mảng (`{"authorization": ["…"]}`) hay object con (`{"credentials": {"pass": …}}`)
    // thì tên khoá con không còn nhạy cảm nữa, nên đi sâu vào là mất dấu.
    const parts = matchedSecretParts(key)
    if (parts.length > 0) {
      out[key] = isPaginationCursor(key) || keepAsIs(val, parts) ? val : REDACTED
      continue
    }
    out[key] = redactDeep(val, depth + 1)
  }
  return out
}
