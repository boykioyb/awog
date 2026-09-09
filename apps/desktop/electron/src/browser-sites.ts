import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SitePolicy } from './browser'
import { log } from './logger'

// Danh sách site được phép cho trình duyệt của agent (ADR 0086 phần E).
//
// Đây là lớp THÊM, không phải lớp thay thế: guard private/loopback trong
// browser.ts vẫn chạy ở MỌI chế độ (invariant #7). `mode: 'off'` = chỉ có guard
// đó; `mode: 'allowlist'` = ngoài guard đó, chỉ host trong danh sách mới được
// tải. Danh sách rỗng ở chế độ allowlist nghĩa là chặn hết — cố ý: "bật
// allowlist mà chưa khai gì" phải là trạng thái ĐÓNG, không phải mở.
//
// Một entry phủ cả subdomain: `example.com` khớp `example.com` và
// `docs.example.com`, KHÔNG khớp `evil-example.com` — so khớp theo NHÃN
// (`.example.com`) chứ không phải theo chuỗi con.
//
// PHẠM VI THI HÀNH, nói thẳng để không ai tưởng nó rộng hơn thực tế: luật này
// gác các lần ĐIỀU HƯỚNG (navigate / URL bar / target=_blank / redirect /
// iframe) vì đó là chỗ `hostBlocked` được gọi. Subresource (ảnh, script, XHR
// do trang phát) KHÔNG đi qua đây; muốn chặn tới mức đó thì phải là
// `webRequest.onBeforeRequest`, một quyết định khác và tốn kém hơn.
//
// Nhà của file là `~/.awog/browser-sites.json`, không phải file trong project:
// một bản ghi "site nào được phép" mà đi theo git repo thì clone về là tự nới
// quyền hộ người dùng — đúng cái bẫy remote-devices.json phải tránh.

const STORE_FILE = join(homedir(), '.awog', 'browser-sites.json')
const MAX_HOSTS = 200
// Host sau khi chuẩn hoá: nhãn chữ-số-gạch, phân cách bằng dấu chấm. IDN phải
// ở dạng punycode (`xn--…`) — đúng dạng `URL.hostname` trả về, nên so khớp
// không bao giờ phải Unicode-normalize.
const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

// Chưa cấu hình = OFF. Không phải "fail-open": guard private/loopback vẫn đứng.
const DEFAULT_POLICY: SitePolicy = { mode: 'off', hosts: [] }

// Đọc một lần rồi giữ trong bộ nhớ: `hostBlocked` chạy trên MỌI lần điều hướng
// của mọi tab, không thể đọc đĩa mỗi lần. `saveSites` cập nhật cache nên không
// có đường nào lệch giữa file và luật đang thi hành.
let cached: SitePolicy | null = null

// Rút phần host từ thứ người dùng gõ. Họ dán cả URL ("https://example.com/x"),
// gõ wildcard ("*.example.com") hay kèm cổng ("example.com:8443") đều là bình
// thường; tất cả rút về đúng một host vì `URL.hostname` — thứ ta so khớp — không
// bao giờ chứa scheme/đường dẫn/cổng.
function normalizeHost(raw: string): string {
  let host = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (!host) return ''
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme
  host = host.split('/')[0] ?? '' // đường dẫn
  host = host.split('@').pop() ?? '' // userinfo
  if (host.startsWith('[')) {
    // IPv6 dạng có ngoặc: giữ phần trong ngoặc, bỏ cổng phía sau.
    host = host.slice(1, host.indexOf(']') === -1 ? undefined : host.indexOf(']'))
  } else {
    host = host.split(':')[0] ?? '' // cổng
  }
  host = host.replace(/^\*+\./, '').replace(/^\.+/, '') // *.example.com | .example.com
  return host.replace(/\.+$/, '') // FQDN có dấu chấm cuối
}

function readStore(): SitePolicy {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(STORE_FILE, 'utf8')) as unknown
  } catch {
    // Thiếu file hoặc file hỏng → coi như chưa cấu hình.
    return DEFAULT_POLICY
  }
  const file = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  const hosts: string[] = []
  if (Array.isArray(file.hosts)) {
    for (const raw of file.hosts) {
      if (typeof raw !== 'string') continue
      const host = normalizeHost(raw)
      // Nội dung file là L2: bỏ entry rác thay vì tin. Bỏ bớt entry chỉ làm
      // luật CHẶT hơn, nên hướng sai số ở đây là hướng an toàn.
      if (host && HOST_RE.test(host) && !hosts.includes(host)) hosts.push(host)
    }
  }
  return {
    mode: file.mode === 'allowlist' ? 'allowlist' : 'off',
    hosts: hosts.slice(0, MAX_HOSTS),
  }
}

function policy(): SitePolicy {
  if (!cached) cached = readStore()
  return cached
}

// Bản sao cho người gọi: cache là luật đang thi hành, không ai được sửa nó qua
// tham chiếu trả về.
export function loadSites(): SitePolicy {
  const current = policy()
  return { mode: current.mode, hosts: [...current.hosts] }
}

// Validate + chuẩn hoá + ghi đĩa. Ném khi input sai thay vì âm thầm hạ về 'off':
// đây là một công tắc bảo mật, "lưu xong mà không đúng cái vừa bấm" là kiểu lỗi
// tệ nhất nó có thể có. Ghi TRƯỚC rồi mới cập nhật cache, nên một lần ghi thất
// bại không để lại luật chỉ tồn tại trong RAM.
export function saveSites(input: unknown): SitePolicy {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const mode = o.mode
  if (mode !== 'off' && mode !== 'allowlist') {
    throw new Error("browser sites: mode must be 'off' or 'allowlist'")
  }
  const rawHosts = Array.isArray(o.hosts) ? o.hosts : []
  if (rawHosts.length > MAX_HOSTS) {
    throw new Error(`browser sites: too many hosts (${rawHosts.length}, max ${MAX_HOSTS})`)
  }
  const hosts: string[] = []
  for (const raw of rawHosts) {
    if (typeof raw !== 'string') throw new Error('browser sites: every host must be a string')
    const host = normalizeHost(raw)
    if (!host) continue // dòng trống người dùng để lại
    if (!HOST_RE.test(host)) {
      throw new Error(`browser sites: invalid host ${JSON.stringify(String(raw).trim())}`)
    }
    if (!hosts.includes(host)) hosts.push(host)
  }
  const next: SitePolicy = { mode, hosts }
  mkdirSync(dirname(STORE_FILE), { recursive: true, mode: 0o700 })
  writeFileSync(STORE_FILE, `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  })
  cached = next
  log.info('browser sites updated', {
    mode: next.mode,
    hosts: next.hosts.length,
  })
  return loadSites()
}

// `hostname` là `URL.hostname` (đã lowercase, không cổng). Khớp chính nó hoặc
// là subdomain của một entry.
export function isHostAllowed(hostname: string): boolean {
  const current = policy()
  if (current.mode !== 'allowlist') return true
  const host = String(hostname ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
  if (!host) return false
  return current.hosts.some((entry) => host === entry || host.endsWith(`.${entry}`))
}
