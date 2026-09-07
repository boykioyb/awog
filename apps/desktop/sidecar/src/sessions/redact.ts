// Khử bí mật (redaction) cho payload phiên đi RA khỏi sidecar dưới dạng dữ liệu THÔ,
// và cho nội dung L1 đi VÀO prompt của model. Ba đường hiện dùng:
//   - `sessions.listEvents` (xem log JSONL để debug)
//   - `sessions.save-export` format 'json' (xuất transcript máy đọc được)
//   - `runtime/tools/read-terminal-tool.ts` (ring buffer terminal của người dùng →
//     gửi thẳng cho nhà cung cấp model, xem ghi chú ở tool đó)
//
// Vì sao cần: invariant #1 nói API key không bao giờ rời sidecar. Transcript và buffer
// terminal đều là L1 — nội dung do người dùng gõ, do model sinh, cộng tool I/O (`export
// TOKEN=…`, header HTTP, khối `env` của MCP, `cat .env`). Đường `sessions.get` bình
// thường chỉ trả những dòng chat mà UI vốn đã hiển thị, còn ba đường trên phơi bày
// TOÀN BỘ object (kể cả field nội bộ) hoặc đẩy nguyên văn ra ngoài máy — nên chúng đi
// qua bộ lọc này trước.
//
// Nguyên tắc: fail-safe theo hướng che nhiều hơn thiếu, NHƯNG không che tới mức làm
// hỏng công dụng của hai bề mặt debug/export. Bộ lọc chạy 3 lớp:
//   1. theo TÊN FIELD (token/secret/password/apiKey/authorization/…): thay CẢ NHÁNH CON
//      bất kể kiểu (chuỗi, mảng, object, số) — vì bí mật hay nấp dưới `{"credentials":
//      {"pass": …}}` hoặc `{"authorization": ["…"]}`. Ba ngoại lệ hẹp ở `keepAsIs()`.
//   2. theo HÌNH DẠNG GIÁ TRỊ trên mọi chuỗi (sk-…, ghp_…, AIza…, JWT, Bearer, PEM,
//      Stripe, GitLab, Azure, URL có credential): thay đúng đoạn khớp, giữ phần văn bản
//      còn lại đọc được.
//   3. theo GÁN `khoá=giá trị` / `khoá: giá trị` NẰM TRONG chuỗi: `PGPASSWORD=…`,
//      `curl -H 'X-Api-Key: …'`, dump header. Lớp 1 chỉ nhìn khoá JSON nên không thấy
//      những ca này; chúng là dạng rò rỉ phổ biến nhất trong tool I/O và terminal.
// Ngoài ra data URL base64 (ảnh/PDF đính kèm) bị cắt bỏ phần bytes — không phải bí mật,
// nhưng vài MB base64 làm hỏng cả ba bề mặt (xem STRIPPED_DATA_URL).
//
// CỐ Ý KHÔNG bắt: chuỗi entropy cao "trần" (hex 32–64 / base64 32–64 không có tiền tố
// và không đứng sau khoá nhạy cảm). Một luật như thế sẽ nuốt luôn SHA commit, hash nội
// dung, id nội bộ và mọi đoạn base64 của văn bản thường — tức là xoá sạch thứ mà người
// dùng mở view debug ra để xem. Blob entropy cao chỉ bị che khi nó đứng SAU một khoá
// nhạy cảm (lớp 3), nơi ngữ cảnh nói rõ nó là bí mật.

const REDACTED = '[redacted]'

// Ngưỡng độ sâu — JSON đọc từ đĩa là hữu hạn, cap chỉ để một file bệnh hoạn không
// làm tràn stack. Vượt cap thì thay bằng placeholder thay vì bỏ qua âm thầm.
const MAX_DEPTH = 24
const TOO_DEEP = '[truncated: too deep]'

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
  // riêng của định dạng này, không đụng chuỗi thường.
  { re: /\b[A-Za-z0-9_~.]{3}[0-9]Q~[A-Za-z0-9_~.-]{28,}/g, to: REDACTED },
  // JWT (header.payload.signature).
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, to: REDACTED },
  // Header/CLI `Authorization: Bearer <token>` và `Authorization: Basic <base64>`.
  { re: /[Bb]earer\s+[A-Za-z0-9._~+/=-]{16,}/g, to: REDACTED },
  { re: /[Bb]asic\s+[A-Za-z0-9+/]{16,}={0,2}/g, to: REDACTED },
  // Khối PEM private key (RSA/EC/OPENSSH/…).
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    to: REDACTED,
  },
  // URL có credential nhúng: `postgres://user:pass@host`. Giữ scheme + user để dòng
  // log còn đọc được, chỉ thay mật khẩu.
  { re: /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):[^\s:@/]+@/gi, to: `$1:${REDACTED}@` },
]

// Lớp 3 — gán `khoá = giá trị` nằm TRONG một chuỗi. Không dùng `\b` mà cho phép tiền
// tố/hậu tố tuỳ ý (`X-Api-Key`, `PGPASSWORD`, `AWS_SECRET_ACCESS_KEY`, `myToken`).
// Cố ý KHÔNG có `auth` trần (dính `author: "…"`) và không có `key` trần (dính
// `keyFile=/path`, `keyboard=…`).
const ASSIGN_KEY_WORDS =
  'password|passwd|passphrase|secret|token|credential|authorization|api[_-]?key|access[_-]?key|private[_-]?key'

// Dấu phân cách giới hạn ở space/tab (KHÔNG `\s`): `\s` nuốt cả xuống dòng nên
// `Token:\n\nMột câu văn` sẽ bị coi là gán.
const SENSITIVE_ASSIGN_RE = new RegExp(
  `([A-Za-z0-9_.-]*(?:${ASSIGN_KEY_WORDS})[A-Za-z0-9_.-]*)([ \\t]*[:=][ \\t]*)` +
    `(?:"([^"\\n]{4,})"|'([^'\\n]{4,})'|([^\\s"'\\n,;]{4,}))`,
  'gi',
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
// Ký tự "mùi bí mật". Cố ý KHÔNG có `-` và `.`: `Token: read-only`, `token: v1.2.3`
// là văn xuôi/phiên bản, che chúng chỉ tạo nhiễu.
const SECRET_ISH_SYMBOL_RE = /[_+/=~@%&*$#!]/
const LONG_VALUE = 12

// Cân bằng chính xác/phủ sóng của lớp 3: một khoá nhạy cảm đứng trước một TỪ TIẾNG
// ANH ngắn thường là văn xuôi ("Token: Reserved for later"), còn bí mật thật gần như
// luôn có chữ số, ký hiệu, hoặc dài.
function looksSecretValue(value: string): boolean {
  const v = value.trim()
  if (v.length < 4) return false
  if (PLACEHOLDER_VALUES.includes(v.toLowerCase())) return false
  if (NUMERIC_VALUE_RE.test(v) || VERSION_VALUE_RE.test(v)) return false
  return /[0-9]/.test(v) || SECRET_ISH_SYMBOL_RE.test(v) || v.length >= LONG_VALUE
}

function redactAssignments(value: string): string {
  SENSITIVE_ASSIGN_RE.lastIndex = 0
  return value.replace(
    SENSITIVE_ASSIGN_RE,
    (match: string, key: string, sep: string, dq?: string, sq?: string, bare?: string) => {
      const captured = dq ?? sq ?? bare
      if (captured === undefined || !looksSecretValue(captured)) return match
      if (dq !== undefined) return `${key}${sep}"${REDACTED}"`
      if (sq !== undefined) return `${key}${sep}'${REDACTED}'`
      return `${key}${sep}${REDACTED}`
    },
  )
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
  let out = value
  for (const rule of SECRET_VALUE_RULES) {
    // Regex có cờ `g` dùng chung giữa các lần gọi: `replace` tự reset lastIndex,
    // nhưng đặt lại tường minh để không phụ thuộc chi tiết đó.
    rule.re.lastIndex = 0
    out = out.replace(rule.re, rule.to)
  }
  return redactAssignments(out)
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
      out[key] = keepAsIs(val, parts) ? val : REDACTED
      continue
    }
    out[key] = redactDeep(val, depth + 1)
  }
  return out
}
