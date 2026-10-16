// Ghim tài khoản GitHub (gh) của PROJECT cho shell của agent (tool Bash, lệnh nền)
// — docs/features/session-issue-tracking.md §3.7.
//
// Vấn đề: `gh` / `git push` trong Bash của agent dùng tài khoản ĐANG ACTIVE của gh
// trên toàn máy. Người dùng `gh auth switch` ở terminal là mọi phiên của project
// đang ghim tài khoản khác đọc repo bằng nhầm người (404 ở repo của org).
//
// Vì sao không dùng GH_CONFIG_DIR: gh đọc token "active" từ một ô keyring chung
// (không theo user trong hosts.yml) — `gh auth status` thì đúng người nhưng
// `gh api` vẫn ra tài khoản active toàn máy (đã đo, gh 2.97).
//
// Vì sao không tiêm GH_TOKEN vào env của shell: token nằm sẵn trong env thì một
// `env` / `printenv` bất kỳ đổ nó thẳng vào transcript.
//
// Cách làm: mỗi tài khoản một SHIM `~/.awog/gh-shims/<login>/gh` đứng đầu PATH của
// shell. Shim lấy token của đúng tài khoản ngay lúc chạy (`gh auth token --user`) và
// chỉ đặt GH_TOKEN cho tiến trình gh THẬT nó exec — shell của agent không bao giờ
// cầm token. `git` qua HTTPS cũng được trỏ vào shim bằng config qua env
// (`GIT_CONFIG_COUNT` — xoá helper toàn cục cho github.com rồi đặt
// `!<shim> auth git-credential`), nên push/pull theo đúng tài khoản.
//
// Chỉ POSIX (shim là script sh). Windows: không ghim — giữ hành vi cũ.
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { awogHome, sanitizeChild } from '../../util/path.js'
import { log } from '../../util/logger.js'

// Cùng charset với isValidGhLogin (github/runner.ts) — chép lại thay vì import để
// module shell không kéo cả đồ thị transport/rpc vào. Login đi vào ĐƯỜNG DẪN và vào
// script, nên đây là biên chặt.
const LOGIN_RE = /^[A-Za-z\d](?:-?[A-Za-z\d]){0,38}$/

let realGhCache: { path: string | null } | null = null

// Tìm `gh` thật trên PATH của sidecar một lần (bỏ qua thư mục shim của chính AWOG).
function findRealGh(pathVar: string | undefined): string | null {
  if (realGhCache) return realGhCache.path
  const shimRoot = join(awogHome(), 'gh-shims')
  let found: string | null = null
  for (const dir of (pathVar ?? '').split(delimiter)) {
    if (!dir || dir.startsWith(shimRoot)) continue
    const cand = join(dir, 'gh')
    try {
      accessSync(cand, constants.X_OK)
      found = cand
      break
    } catch {
      // không có ở thư mục này — thử thư mục kế
    }
  }
  realGhCache = { path: found }
  return found
}

// Bọc chuỗi vào nháy đơn cho sh (đường dẫn gh thật có thể chứa khoảng trắng).
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

function shimScript(realGh: string, login: string): string {
  return `#!/bin/sh
# Sinh bởi AWOG (runtime/tools/gh-shim.ts) — KHÔNG sửa tay, bị ghi lại mỗi lượt.
# Chạy gh bằng tài khoản ${login} (tài khoản GitHub đã ghim cho project), không phụ
# thuộc tài khoản đang active của gh trên máy. Token chỉ sống trong tiến trình gh.
REAL_GH=${shq(realGh)}
case "$1 $2" in
  "auth login"*|"auth logout"*|"auth switch"*|"auth refresh"*|"auth setup-git"*) exec "$REAL_GH" "$@" ;;
esac
if [ -z "$GH_TOKEN" ] && [ -z "$GITHUB_TOKEN" ]; then
  GH_TOKEN=$("$REAL_GH" auth token --user ${shq(login)} --hostname github.com 2>/dev/null)
  if [ -n "$GH_TOKEN" ]; then export GH_TOKEN; else unset GH_TOKEN; fi
fi
exec "$REAL_GH" "$@"
`
}

// Đảm bảo shim của `login` tồn tại + đúng nội dung; trả thư mục chứa nó, hoặc null
// khi không ghim được (Windows, không có gh, login lạ, ghi file lỗi).
function ensureShim(login: string, pathVar: string | undefined): string | null {
  if (process.platform === 'win32' || !LOGIN_RE.test(login)) return null
  const realGh = findRealGh(pathVar)
  if (!realGh) return null
  const dir = join(awogHome(), 'gh-shims', sanitizeChild(login))
  const file = join(dir, 'gh')
  const body = shimScript(realGh, login)
  try {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== body) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      writeFileSync(file, body, { mode: 0o700 })
      chmodSync(file, 0o700)
    }
    return dir
  } catch (err) {
    log.warn('gh-shim: failed to write shim', { err: err instanceof Error ? err.message : String(err) })
    return null
  }
}

// Biến môi trường cần THÊM vào shell của agent để gh/git chạy bằng `login`. Rỗng khi
// không ghim (login vắng / '' = theo tài khoản active, hoặc không dựng được shim).
export function ghShimEnv(login: string | undefined, pathVar: string | undefined): Record<string, string> {
  const wanted = (login ?? '').trim()
  if (!wanted) return {}
  const dir = ensureShim(wanted, pathVar)
  if (!dir) return {}
  const shim = join(dir, 'gh')
  return {
    PATH: pathVar ? `${dir}${delimiter}${pathVar}` : dir,
    // Config git qua env (git ≥ 2.31): helper rỗng XOÁ danh sách helper toàn cục cho
    // github.com, rồi đặt shim — `gh auth git-credential` của gh thật trả token theo
    // GH_TOKEN mà shim vừa đặt.
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
    GIT_CONFIG_VALUE_1: `!${shq(shim)} auth git-credential`,
  }
}
