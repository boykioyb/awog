// `aws login` — đăng nhập Console bằng trình duyệt rồi ghi `login_session` vào
// profile (bổ sung 2026-09-13, đo trên aws-cli 2.35.9).
//
// VÌ SAO CÓ FILE NÀY. Trước nó, người chỉ có `Account ID/alias + IAM username +
// Password` — bộ ba đăng nhập Console — không có đường nào trong app: AWOG chỉ
// nhận access key / SSO / assume-role, còn khối trợ giúp thì bảo họ mở Console
// tạo khoá dài hạn bằng tay. `aws login` xoá bỏ bước thủ công đó: CLI mở trình
// duyệt, người dùng đăng nhập bằng chính phiên Console, CLI nhận credential tạm
// + refresh token và ghi `login_session` vào profile.
//
// BA RÀNG BUỘC CỦA THIẾT KẾ NÀY:
//
//  1. LUẬT GHI `~/.aws` KHÔNG BỊ NỚI. `aws login` tự ghi file config, mà luật §1b
//     nói mọi đường ghi vào `~/.aws` phải đi qua `applyAwsIniEdits` (sửa phẫu
//     thuật · sao lưu · ghi nguyên tử · chmod 600). Nên lời gọi CLI được trỏ
//     `AWS_CONFIG_FILE` vào một file TẠM: CLI ghi vào đó, ta đọc đúng MỘT khoá
//     `login_session` rồi tự ghi vào config thật bằng `applyAwsIniEdits`. File
//     tạm bị xoá trong `finally`.
//  2. TOKEN KHÔNG ĐI QUA AWOG. Refresh/access token nằm trong thư mục cache của
//     chính CLI (`~/.aws/login/cache`, hoặc `AWS_LOGIN_CACHE_DIRECTORY` — biến
//     này được luồn xuống ở `run.ts` để hai bên đọc cùng một chỗ). Ta chỉ chép
//     `login_session` — một ĐỊNH DANH, không phải credential.
//  3. KHÔNG TỰ CHẠY. Lệnh này mở trình duyệt và chờ người dùng, nên nó chỉ chạy
//     sau một cú bấm (`decision: 'approved'`, `actor: 'human'`) và không có
//     AgentTool nào gọi tới (ADR 0088 §1b luật 4).
//
// Bề mặt của CON NGƯỜI. Không có đường nào để agent chạy file này.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emit } from '../../transport/stdio.js'
import { applyAwsIniEdits } from './write.js'
import { parseAwsIni } from './ini.js'
import { runInfra } from '../run.js'
import { recordInfraAction } from '../audit/store.js'
import { AWS_PROFILE_NAME_RE, listAwsProfiles } from './profiles.js'

/**
 * Người dùng còn phải mở trình duyệt, đăng nhập (và MFA) — 180s như `aws sso
 * login` là sát quá, vì `aws login` còn một vòng gọi token sau khi duyệt.
 */
const LOGIN_TIMEOUT_MS = 300_000

/** Loại sự kiện đẩy URL đăng nhập lên UI NGAY khi CLI in ra (xem `onOutput`). */
export const CONSOLE_LOGIN_URL_EVENT = 'infra.console-login.url'

/**
 * `aws login` in ra URL uỷ quyền trên stdout rồi mới chờ người dùng duyệt.
 *
 * Bóc nó ra là để UI hiện được URL cho người dùng — cần cho hai ca có thật:
 * (1) trình duyệt mặc định không mở, (2) trang đăng nhập trả **400 Bad Request**
 * vì cookie AWS cũ trong trình duyệt (lỗi đã biết của aws-cli, aws/aws-cli#10186
 * — lúc đó CLI treo im lặng cho tới hết timeout). Có URL trong tay, người dùng
 * dán sang cửa sổ ẩn danh là đi tiếp được, không phải chờ hết 5 phút.
 *
 * Export cho bộ test: đây là chỗ duy nhất biến stdout của CLI thành thứ hiện lên
 * màn hình, và URL là đầu vào của một cú bấm "mở trong trình duyệt".
 */
export function extractAuthorizeUrl(text: string): string | null {
  const match = text.match(/https:\/\/[^\s"'<>]*\/v1\/authorize\?[^\s"'<>]+/)
  return match ? match[0] : null
}

/**
 * Tiến trình `aws login` đang chạy (nhiều nhất MỘT — lệnh chỉ chạy sau một cú
 * bấm của người dùng).
 *
 * Cần con trỏ này để "Huỷ" là huỷ THẬT: không giết được tiến trình thì nó vẫn
 * treo tới hết timeout 300s, và — tệ hơn — vẫn ghi `login_session` nếu người
 * dùng đăng nhập xong ở trình duyệt sau khi đã bấm Huỷ (profile tự dưng xuất
 * hiện, UI không biết). Trước đây chỉ huỷ MỀM phía UI (nợ N7).
 */
let activeLogin: AbortController | null = null

/** Huỷ cứng phiên `aws login` đang chờ. Trả `false` nếu không có gì để huỷ. */
export function cancelConsoleLogin(): boolean {
  if (!activeLogin) return false
  activeLogin.abort()
  return true
}

/** Region của AWS CLI: chữ thường, số, gạch ngang (khớp `REGION_RE` của sso.ts). */
const REGION_RE = /^[a-z0-9-]{1,32}$/

export type ConsoleLoginInput = { profile: string; region: string }

export type ConsoleLoginResult =
  | { ok: true; profile: string; backups: string[] }
  | { ok: false; error: string }

function sectionOf(profile: string): string {
  return profile === 'default' ? 'default' : `profile ${profile}`
}

/**
 * Bóc `login_session` của một profile ra khỏi NỘI DUNG file config.
 *
 * Export cho bộ test: đây là hàng rào duy nhất giữa "CLI ghi gì đó vào file tạm"
 * và "ta ghi gì vào config thật", nên nó phải đo được trực tiếp. Trả `null` thay
 * vì ném: người gọi cần phân biệt "CLI không ghi gì" (lỗi có mã riêng) với
 * "đọc file lỗi".
 */
export function readLoginSession(raw: string, profile: string): string | null {
  const config = parseAwsIni(raw)
  const value = config[sectionOf(profile)]?.keys.login_session
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/**
 * Chặn ghi đè profile đã có KIỂU credential khác.
 *
 * `aws login` tự có hàng rào này, nhưng nó chạy trên file TẠM (rỗng), nên hàng
 * rào đó không bao giờ bắn. Thiếu bản sao ở đây thì `aws login` lên một profile
 * static sẽ ghi thêm `login_session` mà khoá tĩnh vẫn có quyền cao hơn ⇒ người
 * dùng tưởng đã đăng nhập bằng phiên Console nhưng thực tế vẫn là access key cũ
 * (im lặng, đúng kiểu lỗi tệ nhất). Chỉ cho phép khi profile chưa có, hoặc đã
 * đúng kiểu `login` (đăng nhập lại).
 */
export function assertLoginTarget(name: string, existingKind: string | undefined): void {
  if (existingKind === undefined || existingKind === 'login') return
  throw new Error(
    `EXISTS_OTHER_STYLE: profile "${name}" đã có credential kiểu ${existingKind}. ` +
      'Đăng nhập Console ghi được vào profile trống hoặc profile login; ' +
      'hãy chọn tên khác, hoặc xoá kiểu credential cũ trước.',
  )
}

function assertProfileName(name: string): string {
  const trimmed = name.trim()
  if (!AWS_PROFILE_NAME_RE.test(trimmed)) {
    throw new Error(`INVALID_NAME: "${trimmed.slice(0, 64)}" is not a valid AWS profile name`)
  }
  return trimmed
}

function assertRegion(region: string): string {
  const trimmed = region.trim()
  if (!REGION_RE.test(trimmed)) {
    throw new Error(`INVALID_REGION: "${trimmed.slice(0, 32)}" is not a valid AWS region`)
  }
  return trimmed
}

/**
 * Chạy `aws login` cho một profile rồi ghi `login_session` vào `~/.aws/config`.
 *
 * `region` là bắt buộc chứ không phải tuỳ chọn: thiếu nó, CLI rơi vào prompt
 * chọn region trên TTY (xem `_prompt_for_region` trong awscli) — mà tiến trình
 * này không có TTY, nên lời gọi sẽ treo tới lúc hết timeout.
 */
export async function consoleLogin(input: ConsoleLoginInput): Promise<ConsoleLoginResult> {
  const profile = assertProfileName(input.profile)
  const region = assertRegion(input.region)

  const existing = (await listAwsProfiles()).find((p) => p.name === profile)
  assertLoginTarget(profile, existing?.kind)

  const controller = new AbortController()
  let urlSent = false
  let tail = ''

  const dir = await mkdtemp(join(tmpdir(), 'awog-login-'))
  const tmpConfig = join(dir, 'config')
  // File phải TỒN TẠI trước: CLI đọc file để dựng profile map, và một đường dẫn
  // trỏ vào file không có sẽ được nó tạo với umask của tiến trình — ta không
  // muốn phụ thuộc umask cho một file có thể chứa `login_session`.
  await writeFile(tmpConfig, '', { mode: 0o600 })

  try {
    // Đăng ký trong `try`: mọi đường thoát đều đi qua `finally` gỡ nó ra, còn
    // `mkdtemp`/`writeFile` hỏng phía trên thì chưa có gì để huỷ.
    activeLogin = controller
    // `--profile`/`--region` KHÔNG nằm trong `args`: `runInfra` từ chối argv tự
    // mang cờ ngữ cảnh và tự chèn từ `context` (đúng một chỗ, có ghi nhật ký).
    const result = await runInfra({
      tool: 'aws',
      args: ['login'],
      context: { profile, region },
      env: { AWS_CONFIG_FILE: tmpConfig },
      signal: controller.signal,
      onOutput: (chunk) => {
        if (urlSent) return
        // Giữ một đuôi ngắn: URL có thể bị cắt qua hai lần đọc của pipe.
        tail = (tail + chunk).slice(-2048)
        const url = extractAuthorizeUrl(tail)
        if (!url) return
        urlSent = true
        emit(CONSOLE_LOGIN_URL_EVENT, { profile, url })
      },
      actor: 'human',
      surface: 'settings',
      toolName: 'console_login',
      decision: 'approved',
      timeoutMs: LOGIN_TIMEOUT_MS,
    })

    if (!result.ok) {
      if (controller.signal.aborted) return { ok: false, error: 'CANCELLED' }
      // `exitCode === null` = tiến trình KHÔNG tự thoát (bị timeout/giết), khác
      // hẳn "CLI thoát với mã lỗi". Ca phổ biến nhất của nhánh này là lỗi cookie
      // cũ của chính aws-cli (#10186): trình duyệt nhận 400, CLI treo im lặng
      // tới hết giờ. UI có câu riêng cho mã này (nói cách đi tiếp), nên ở đây
      // chỉ trả MÃ chứ không trả stderr thô ("Command failed: …").
      if (result.exitCode === null && result.rejected === undefined) {
        return { ok: false, error: 'LOGIN_TIMEOUT' }
      }
      return {
        ok: false,
        error:
          result.stderr.trim() ||
          `aws login failed (exit ${String(result.exitCode)}) — kiểm tra aws-cli đã được cập nhật chưa.`,
      }
    }

    const sessionId = readLoginSession(await readFile(tmpConfig, 'utf8'), profile)
    if (!sessionId) {
      return {
        ok: false,
        error:
          'LOGIN_NO_SESSION: aws login kết thúc nhưng không ghi login_session. ' +
          'Bản aws-cli này có thể quá cũ — cần v2 có lệnh `aws login`.',
      }
    }

    const { backup } = await applyAwsIniEdits('config', [
      { op: 'upsertSection', section: sectionOf(profile), keys: { login_session: sessionId, region } },
    ])

    await recordInfraAction({
      actor: 'human',
      surface: 'settings',
      tool: 'console_login',
      argv: ['login', '--profile', profile, '--region', region],
      context: { profile, region },
      class: 'write',
      decision: 'approved',
      result: { summary: `wrote login_session for ${profile} to ~/.aws/config` },
    })

    return { ok: true, profile, backups: backup ? [backup] : [] }
  } finally {
    // File tạm chứa `login_session` — xoá cả thư mục, không để lại rác.
    await rm(dir, { recursive: true, force: true })
    if (activeLogin === controller) activeLogin = null
  }
}
