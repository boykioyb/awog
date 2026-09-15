// Mở URL uỷ quyền của `aws login` trong cửa sổ ẩn danh/riêng tư.
//
// VÌ SAO CÓ FILE NÀY. `aws login` mở URL bằng trình duyệt MẶC ĐỊNH. Nếu trình
// duyệt đó còn cookie cũ của `signin.aws.amazon.com`, trang đăng nhập trả `400
// Bad Request` và CLI treo im lặng cho tới hết timeout 300s (aws/aws-cli#10186)
// — người dùng nhìn một trang lỗi, còn phía AWOG không có tín hiệu nào để báo.
//
// AWOG KHÔNG được phép chữa bằng cách đọc/xoá cookie trình duyệt của người dùng
// (dữ liệu riêng của họ, và phải đóng trình duyệt mới xoá được), cũng không cần:
// mở đúng URL uỷ quyền trong một cửa sổ SẠCH là đủ, vì 400 đến từ phiên cookie
// cũ chứ không từ URL.
//
// Đo trên máy 2026-09-13 (aws-cli 2.35.9, macOS): `aws login` tôn trọng biến
// `$BROWSER` — trỏ nó vào một script bất kỳ thì script nhận đúng URL uỷ quyền
// kèm `redirect_uri=http://127.0.0.1:<port>/oauth/callback`. Nghĩa là có hai
// đường mở cửa sổ sạch: (a) đặt `$BROWSER` ngay từ lúc spawn để CLI tự mở, hoặc
// (b) mở lấy URL mà CLI đã in ra. File này làm (b), vì nó dùng được NGAY giữa
// phiên đang chờ — người dùng đang nhìn trang 400 thì bấm một nút là xong, không
// phải Huỷ rồi chạy lại `aws login` (mà lần chạy sau vẫn mở đúng trình duyệt cũ
// nếu chưa đổi `$BROWSER`).
//
// Bề mặt của CON NGƯỜI: không AgentTool nào gọi tới. Việc duy nhất file này làm
// là mở một URL uỷ quyền trong trình duyệt — nó không đọc, không ghi credential,
// nên không có bản ghi audit nào ở đây (khác mọi RPC chạm `~/.aws`).

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type PrivateBrowser = { app: string; path: string; flags: string[] }

/**
 * Trình duyệt mở được cửa sổ riêng tư BẰNG CỜ DÒNG LỆNH.
 *
 * Safari KHÔNG có trong bảng này: nó chỉ bật cửa sổ riêng tư qua menu (hoặc
 * AppleScript điều khiển UI — cần quyền Accessibility và vỡ mỗi lần Apple đổi
 * giao diện). Máy chỉ có Safari sẽ nhận `NO_BROWSER`, và UI giữ lại đường "sao
 * chép URL" — trung thực hơn là mở một cửa sổ thường rồi dính đúng 400.
 */
const CANDIDATES: readonly { bundleId: string; app: string; flags: string[] }[] = [
  { bundleId: 'com.google.chrome', app: 'Google Chrome', flags: ['--incognito'] },
  { bundleId: 'com.brave.Browser', app: 'Brave Browser', flags: ['--incognito'] },
  { bundleId: 'com.microsoft.edgemac', app: 'Microsoft Edge', flags: ['--incognito'] },
  { bundleId: 'company.thebrowser.Browser', app: 'Arc', flags: ['--incognito'] },
  { bundleId: 'com.vivaldi.Vivaldi', app: 'Vivaldi', flags: ['--incognito'] },
  { bundleId: 'org.chromium.Chromium', app: 'Chromium', flags: ['--incognito'] },
  { bundleId: 'org.mozilla.firefox', app: 'Firefox', flags: ['-private-window'] },
]

const LS_PLIST = 'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist'

/** `~/Applications` trước `/Applications`: bản cài riêng của người dùng thắng. */
export function candidateDirs(home: string = homedir()): string[] {
  return [join(home, 'Applications'), '/Applications']
}

/**
 * Bundle id của trình duyệt mặc định cho http/https.
 *
 * Hỏng, thiếu file, hay máy chưa từng đổi trình duyệt mặc định ⇒ `null` (người
 * gọi rơi về thứ tự trong `CANDIDATES`), nên hàm này không bao giờ ném.
 */
export function parseDefaultBrowserBundleId(raw: string): string | null {
  try {
    const data = JSON.parse(raw) as {
      LSHandlers?: {
        LSHandlerURLScheme?: string
        LSHandlerRoleAll?: string
        LSHandlerRoleViewer?: string
      }[]
    }
    const handlers = data.LSHandlers ?? []
    for (const scheme of ['https', 'http']) {
      const hit = handlers.find((h) => h.LSHandlerURLScheme === scheme)
      const id = hit?.LSHandlerRoleAll ?? hit?.LSHandlerRoleViewer
      // `-` là giá trị "chưa chọn" của LaunchServices, không phải bundle id.
      if (id && id !== '-') return id
    }
    return null
  } catch {
    return null
  }
}

/**
 * Đọc bundle id trình duyệt mặc định qua `plutil`.
 *
 * `plutil -convert json` là cách duy nhất đọc plist NHỊ PHÂN này mà không thêm
 * phụ thuộc; đổi lại phải chịu được cả ca lệnh không tồn tại.
 */
export async function readDefaultBrowserBundleId(home: string = homedir()): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      join(home, LS_PLIST),
    ])
    return parseDefaultBrowserBundleId(stdout)
  } catch {
    return null
  }
}

/**
 * Chọn trình duyệt để mở cửa sổ sạch: ưu tiên ĐÚNG trình duyệt mặc định của
 * người dùng (họ không phải thấy một app khác tự dưng mở lên), rồi mới tới thứ
 * tự trong `CANDIDATES`.
 */
export function pickPrivateBrowser(deps: {
  bundleId?: string | null
  dirs?: string[]
  exists?: (path: string) => boolean
} = {}): PrivateBrowser | null {
  const exists = deps.exists ?? existsSync
  const dirs = deps.dirs ?? candidateDirs()
  const find = (app: string): string | null => {
    for (const dir of dirs) {
      const path = join(dir, `${app}.app`)
      if (exists(path)) return path
    }
    return null
  }
  const ordered = deps.bundleId
    ? [
        ...CANDIDATES.filter((c) => c.bundleId === deps.bundleId),
        ...CANDIDATES.filter((c) => c.bundleId !== deps.bundleId),
      ]
    : CANDIDATES
  for (const c of ordered) {
    const path = find(c.app)
    if (path) return { app: c.app, path, flags: c.flags }
  }
  return null
}

/**
 * Host của trang đăng nhập AWS, theo từng partition. Danh sách ĐÓNG (không phải
 * `signin.*`) vì đây là hàng rào duy nhất giữa một chuỗi do renderer gửi lên và
 * một tiến trình `open`: khớp rộng thì RPC này thành "mở URL https bất kỳ bằng
 * cờ ẩn danh" — đúng thứ một lỗ XSS cần. Tiền tố region là tuỳ chọn
 * (`ap-southeast-1.signin.aws.amazon.com`), còn GovCloud/Trung Quốc là host
 * riêng (`signin.amazonaws-us-gov.com`, `signin.amazonaws.cn`).
 */
const AUTHORIZE_HOSTS: readonly RegExp[] = [
  /^([a-z0-9-]+\.)?signin\.aws\.amazon\.com$/,
  /^([a-z0-9-]+\.)?signin\.amazonaws\.com$/,
  /^([a-z0-9-]+\.)?signin\.amazonaws-us-gov\.com$/,
  /^([a-z0-9-]+\.)?signin\.amazonaws\.cn$/,
]

/**
 * Chỉ nhận đúng URL uỷ quyền của `aws login`: https + host trong danh sách trên
 * + path `/v1/authorize`.
 */
export function isAuthorizeUrl(raw: string): boolean {
  if (raw.length === 0 || raw.length > 4096) return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (!AUTHORIZE_HOSTS.some((re) => re.test(url.hostname))) return false
  if (url.pathname !== '/v1/authorize') return false
  // URL uỷ quyền THẬT luôn mang query (`response_type`, `state`, `code_challenge`,
  // `redirect_uri`); URL trần đúng host + path nhưng rỗng query không phải thứ
  // CLI in ra, nên không có lý do gì để mở nó.
  return url.search.length > 1
}

/**
 * Tham số cho `open`.
 *
 * `-n` (tiến trình MỚI) là phần dễ mất nhất: thiếu nó, `open` chỉ chuyển URL
 * cho instance đang chạy và BỎ QUA `--args` — cờ ẩn danh biến mất, cửa sổ mở ra
 * dính đúng phiên cookie mà ta đang trốn.
 */
export function buildPrivateOpenArgs(browser: PrivateBrowser, url: string): string[] {
  return ['-n', '-a', browser.path, '--args', ...browser.flags, url]
}

export type OpenPrivateResult =
  | { ok: true; browser: string }
  | { ok: false; error: 'BAD_URL' | 'NO_BROWSER' | 'LAUNCH_FAILED' }

/**
 * Mở `url` trong cửa sổ ẩn danh của trình duyệt mặc định (hoặc trình duyệt đầu
 * tiên trong `CANDIDATES` có mặt trên máy).
 *
 * Đăng ký cửa sổ sạch với callback `127.0.0.1` của CLI: chính cửa sổ này hoàn
 * tất vòng uỷ quyền, nên KHÔNG cần chạy lại `aws login` — URL đang chờ trong
 * tiến trình cũ vẫn dùng được.
 */
export async function openInPrivateWindow(
  url: string,
  deps: {
    bundleId?: string | null
    pick?: () => PrivateBrowser | null
    run?: (args: string[]) => Promise<void>
  } = {},
): Promise<OpenPrivateResult> {
  if (!isAuthorizeUrl(url)) return { ok: false, error: 'BAD_URL' }
  const browser = deps.pick
    ? deps.pick()
    : pickPrivateBrowser(
        deps.bundleId !== undefined
          ? { bundleId: deps.bundleId }
          : { bundleId: await readDefaultBrowserBundleId() },
      )
  if (!browser) return { ok: false, error: 'NO_BROWSER' }
  const run =
    deps.run ??
    (async (args: string[]): Promise<void> => {
      await execFileAsync('open', args)
    })
  try {
    await run(buildPrivateOpenArgs(browser, url))
  } catch {
    return { ok: false, error: 'LAUNCH_FAILED' }
  }
  return { ok: true, browser: browser.app }
}
