// Đọc BA khoá tĩnh của MỘT profile để đổ vào form SỬA (2026-09-14).
//
// ĐÂY LÀ NGOẠI LỆ CÓ Ý THỨC CỦA INVARIANT #1, không phải chỗ luật đó bị nới lỏng:
// `ini.ts` vẫn vứt giá trị secret ngay trong vòng lặp parse, và `infra.contexts`
// vẫn KHÔNG BAO GIỜ trả secret. Ngoại lệ nằm đúng ở đây — một hàm đọc MỘT
// profile theo TÊN mà người dùng gọi từ form sửa, và chỉ ba khoá trong
// `SECRET_KEYS` được cắt ra.
//
// Bốn ràng buộc của hàm này, giữ nguyên khi sửa tiếp:
//   1. Mọi khoá khác bị bỏ TẠI CHỖ trong vòng lặp — không "parse hết rồi lọc
//      sau", vì lọc sau nghĩa là secret đã nằm trong một object có tên.
//   2. Không log giá trị, không log nội dung file, không đẩy `raw` qua event.
//   3. Khoá vắng mặt ⇒ chuỗi rỗng, KHÔNG ném: "profile không có khoá" là trạng
//      thái hợp lệ (form vẫn mở được để người dùng dán khoá mới vào).
//   4. Chuỗi trả về sống trong bộ nhớ renderer tới khi modal đóng — nửa còn lại
//      của luật nằm ở UI (`clearSecrets()` của AwsProfileEditor.vue).
import { readFile } from 'node:fs/promises'
import { log } from '../../util/logger.js'
import { AWS_PROFILE_NAME_RE, awsConfigPath, awsCredentialsPath } from './profiles.js'

export type AwsStaticSecrets = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
}

/** Allowlist khoá đọc: đúng ba, và tên khoá trong file ⇄ tên trường ở UI. */
const SECRET_KEYS: ReadonlyMap<string, keyof AwsStaticSecrets> = new Map([
  ['aws_access_key_id', 'accessKeyId'],
  ['aws_secret_access_key', 'secretAccessKey'],
  ['aws_session_token', 'sessionToken'],
])

function emptySecrets(): AwsStaticSecrets {
  return { accessKeyId: '', secretAccessKey: '', sessionToken: '' }
}

/**
 * Tên section chứa profile trong từng file. `config` dùng `[default]` /
 * `[profile x]`; `credentials` dùng `[x]` trần — cùng quy ước `profiles.ts` và
 * cùng quy ước botocore, nên một section `[x]` trần trong `config` KHÔNG được
 * đọc (AWS CLI cũng bỏ qua nó).
 */
function sectionNamesIn(file: 'config' | 'credentials', name: string): ReadonlySet<string> {
  if (file === 'credentials') return new Set([name])
  return new Set([name === 'default' ? 'default' : `profile ${name}`])
}

/**
 * Quét một file INI, chỉ cắt giá trị của `SECRET_KEYS` trong `wanted`.
 * Cú pháp xử lý y hệt `ini.ts` (comment `;`/`#`, CRLF, block thụt `s3 =`), để
 * hai đường đọc không lệch nhau ở chỗ dễ lệch nhất là tên section.
 */
function scanSecrets(raw: string, wanted: ReadonlySet<string>): Partial<AwsStaticSecrets> {
  const out: Partial<AwsStaticSecrets> = {}
  let current: string | null = null
  let inNestedBlock = false

  for (const rawLine of raw.split('\n')) {
    const indented = rawLine.charCodeAt(0) === 32 || rawLine.charCodeAt(0) === 9
    const line = rawLine.trim()
    if (line === '') {
      inNestedBlock = false
      continue
    }
    if (inNestedBlock && indented) continue
    inNestedBlock = false

    const first = line.charCodeAt(0)
    if (first === 59 /* ; */ || first === 35 /* # */) continue

    if (first === 91 /* [ */) {
      // `]` ĐẦU TIÊN, như `ini.ts`: phần đuôi sau nó không thuộc tên section.
      const close = line.indexOf(']')
      current = close <= 1 ? null : line.slice(1, close).trim().replace(/\s+/g, ' ')
      continue
    }
    if (current === null || !wanted.has(current)) continue

    const eq = line.indexOf('=')
    if (eq < 1) continue
    const value = line.slice(eq + 1).trim()
    if (value === '') {
      // `s3 =` — mở block thụt: mọi dòng thụt sau nó thuộc block, không thuộc
      // section. Cùng luật `ini.ts`, và đây là ca dễ lệch nhất giữa hai đường đọc.
      inNestedBlock = true
      continue
    }
    const key = line.slice(0, eq).trim().toLowerCase()
    const field = SECRET_KEYS.get(key)
    if (!field) continue
    // Khoá trùng trong cùng section: cái SAU thắng, cùng luật `ini.ts`.
    out[field] = value
  }
  return out
}

async function readQuietly(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // Thiếu file là trạng thái bình thường (máy chưa cài AWS CLI). Lỗi khác thì
    // warn theo `code` — KHÔNG kèm đường dẫn nội dung hay giá trị nào.
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      log.warn('aws: cannot read credentials file for the editor', { path, code })
    }
    return ''
  }
}

/**
 * Ba khoá tĩnh của profile `name`, đọc từ `credentials` rồi `config`.
 *
 * `credentials` THẮNG `config` khi hai file khai cùng khoá — đúng thứ tự
 * botocore, cùng thứ tự `mergeInto()` của `profiles.ts`.
 */
export async function readStaticSecrets(name: string): Promise<AwsStaticSecrets> {
  if (!AWS_PROFILE_NAME_RE.test(name)) {
    throw new Error(`INVALID_NAME: ${name.slice(0, 64)}`)
  }
  const fromConfig = scanSecrets(
    await readQuietly(awsConfigPath()),
    sectionNamesIn('config', name),
  )
  const fromCredentials = scanSecrets(
    await readQuietly(awsCredentialsPath()),
    sectionNamesIn('credentials', name),
  )
  return { ...emptySecrets(), ...fromConfig, ...fromCredentials }
}
