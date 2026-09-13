// Parser INI cho `~/.aws/{config,credentials}` — allowlist-key (ADR 0088 §1, việc 0.4).
//
// INVARIANT #1 — AWOG KHÔNG sở hữu credential hạ tầng. Ba khoá secret
// (`aws_access_key_id`, `aws_secret_access_key`, `aws_session_token`) bị quy
// thành boolean NGAY trong vòng lặp parse: giá trị của chúng không bao giờ được
// cắt ra thành chuỗi (xem `hasValueAfter` — dò ký tự bằng charCode, không
// `slice`), không vào object trả về, không lên IPC, không vào log, không vào
// context của model. Mọi khoá không nằm trong `ALLOWED_KEYS` cũng bị bỏ tại chỗ
// chứ không "parse hết rồi lọc sau" — lọc sau nghĩa là secret đã nằm trong bộ
// nhớ có tên, và chỉ cần một `log.info(section)` là rò.
//
// Người gọi phải giữ nốt nửa còn lại của luật: chuỗi `raw` (và từng dòng của
// nó) đương nhiên chứa secret vì đó là nội dung file — KHÔNG log `raw`, KHÔNG
// đẩy `raw` qua event. Chỉ giá trị TRẢ VỀ của hàm này là an toàn để đi tiếp.
//
// Cố ý KHÔNG đọc `endpoint_url`: đó là bề mặt SSRF (ADR 0088 §7 — cờ ghi đè
// endpoint bị từ chối ở `infra/run.ts`), nên nó không được phép tồn tại trong
// mô hình dữ liệu ngay từ đầu.

// Khoá được giữ lại. Tất cả đều là *metadata trỏ tới* credential (tên profile,
// tên role, tên session), không phải chính credential.
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'region',
  'output',
  'sso_start_url',
  'sso_region',
  'sso_account_id',
  'sso_role_name',
  'sso_session',
  'role_arn',
  'source_profile',
  'mfa_serial',
  'external_id',
  'duration_seconds',
  'credential_process',
  'x_security_token_expires',
])

// Hai khoá này chỉ quy thành `hasStaticKeys`. `aws_access_key_id` tự nó không
// bí mật bằng secret key, nhưng nó là nửa còn lại của cặp khoá và không mang
// thông tin nào AWOG cần — giữ lại chỉ tạo thêm một chỗ để rò.
const STATIC_KEY_NAMES: ReadonlySet<string> = new Set(['aws_access_key_id', 'aws_secret_access_key'])
const SESSION_TOKEN_NAME = 'aws_session_token'

export type AwsIniSection = {
  /** Khoá đã lọc qua allowlist. Không bao giờ chứa giá trị secret. */
  keys: Record<string, string>
  /** Section có `aws_access_key_id` và/hoặc `aws_secret_access_key`. */
  hasStaticKeys: boolean
  /** Section có `aws_session_token` (credential tạm, sẽ hết hạn). */
  hasSessionToken: boolean
}

/** Tên section giữ NGUYÊN như trong file: `default`, `profile dev`, `sso-session corp`. */
export type AwsIniFile = Record<string, AwsIniSection>

function emptySection(): AwsIniSection {
  return { keys: {}, hasStaticKeys: false, hasSessionToken: false }
}

// Dò xem sau dấu `=` còn ký tự khác khoảng trắng không, KHÔNG tạo substring —
// đây là cách duy nhất để phân biệt `s3 =` (mở block thụt) với một dòng khoá
// thật mà không phải chạm vào giá trị của khoá secret.
function hasValueAfter(line: string, from: number): boolean {
  for (let i = from; i < line.length; i++) {
    const code = line.charCodeAt(i)
    if (code !== 32 && code !== 9) return true
  }
  return false
}

/**
 * Parse một file INI kiểu AWS. Dữ liệu vào là L1 (file của người dùng) nên hàm
 * không bao giờ throw: dòng không hiểu được thì bỏ qua.
 *
 * Xử lý: `[profile x]` (file config) vs `[x]` (file credentials) — tên section
 * trả về nguyên văn, việc bóc tiền tố `profile ` là của `profiles.ts`; comment
 * cả `;` lẫn `#`; CRLF; khoảng trắng quanh `=`; khoá trùng (cái sau thắng);
 * section trùng (gộp); dòng rác không có `=`; và nested key kiểu `s3 =` + các
 * dòng thụt bên dưới (bỏ qua cả block, kể cả khi khoá con trùng tên khoá thật).
 */
export function parseAwsIni(raw: string): AwsIniFile {
  const out: AwsIniFile = {}
  let current: AwsIniSection | null = null
  // Đang ở trong một block thụt (`s3 =` / `dynamodb =`)? Dòng thụt kế tiếp
  // thuộc về nó, không phải khoá của section.
  let inNestedBlock = false

  for (const rawLine of raw.split('\n')) {
    const indented = rawLine.charCodeAt(0) === 32 || rawLine.charCodeAt(0) === 9
    const line = rawLine.trim() // cắt luôn `\r` của CRLF

    if (line === '') {
      inNestedBlock = false
      continue
    }
    if (inNestedBlock && indented) continue
    inNestedBlock = false

    const first = line.charCodeAt(0)
    if (first === 59 /* ; */ || first === 35 /* # */) continue

    if (first === 91 /* [ */) {
      const close = line.lastIndexOf(']')
      // `[abc` thiếu ngoặc đóng: bỏ luôn, và huỷ section hiện tại để các khoá
      // bên dưới không bị gán nhầm vào section trước đó.
      if (close <= 1) {
        current = null
        continue
      }
      const name = line.slice(1, close).trim().replace(/\s+/g, ' ')
      if (name === '') {
        current = null
        continue
      }
      // Section trùng tên: gộp thay vì thay mới (cái sau thắng ở từng khoá).
      current = out[name] ?? emptySection()
      out[name] = current
      continue
    }

    if (!current) continue // khoá nằm trước section đầu tiên

    const eq = line.indexOf('=')
    if (eq < 1) continue // dòng rác, hoặc `= x` không có tên khoá

    const key = line.slice(0, eq).trim().toLowerCase()
    if (!hasValueAfter(line, eq + 1)) {
      // `s3 =` — mở block thụt. Không lưu gì, kể cả khi khoá nằm trong allowlist.
      inNestedBlock = true
      continue
    }

    // ↓↓↓ Secret: quy thành boolean rồi thoát NGAY, giá trị không được `slice`.
    if (STATIC_KEY_NAMES.has(key)) {
      current.hasStaticKeys = true
      continue
    }
    if (key === SESSION_TOKEN_NAME) {
      current.hasSessionToken = true
      continue
    }
    // ↑↑↑ Từ đây trở xuống mới được phép chạm vào giá trị.

    if (!ALLOWED_KEYS.has(key)) continue
    current.keys[key] = line.slice(eq + 1).trim()
  }

  return out
}
