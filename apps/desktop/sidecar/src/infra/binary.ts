// Dò binary `aws` / `terraform` / `kubectl` theo allowlist — ADR 0088 §3 (task 0.1).
//
// SECURITY (invariant #8): đường dẫn binary KHÔNG BAO GIỜ do UI hay model cung
// cấp. Nó được resolve từ danh sách ứng viên hardcode theo OS rồi verify bằng
// `realpath` (phải là file THƯỜNG và EXECUTABLE) trước khi được dùng làm arg[0]
// của `execFile`. Symlink hợp lệ — Homebrew link `/opt/homebrew/bin/aws` →
// `…/Cellar/awscli/<ver>/…` — miễn realpath vẫn nằm dưới một prefix cài đặt tin
// cậy, nên không ai chuyển hướng được sang binary trong `/tmp` hay thư mục home.
//
// Khuôn lấy nguyên từ vpn/binary.ts: thiếu binary là trạng thái BÌNH THƯỜNG, trả
// `null` / `found:false` kèm hint cài đặt chứ không throw — `infra.status` phải
// trả lời được "máy này có gì" ngay cả khi không có công cụ nào.

import { execFile } from 'node:child_process'
import { access, realpath, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { INFRA_TOOLS, type InfraBinaryStatus, type InfraTool } from './types.js'
import { addVouchedBinaryPath, loadVouchedBinaryPaths } from './policy-store.js'
import { recordInfraAction } from './audit/store.js'
import { log } from '../util/logger.js'

// Thư mục cài đặt quen thuộc trên POSIX, xếp theo thứ tự ưu tiên. Homebrew khác
// nhau theo kiến trúc (Apple silicon = /opt/homebrew, Intel = /usr/local),
// MacPorts = /opt/local. AWS CLI v2 bản pkg chính chủ đặt shim ở /usr/local/bin.
const POSIX_DIRS: Record<string, readonly string[]> = {
  darwin: ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'],
  linux: ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'],
}

// Windows không có một thư mục bin chung, mỗi trình cài một chỗ ⇒ liệt kê đủ
// đường dẫn tuyệt đối. Bản cài qua Chocolatey/Scoop nằm ngoài `C:\Program Files`
// nên CỐ TÌNH không được nhận: prefix tin cậy quan trọng hơn tỉ lệ dò trúng.
const WIN_CANDIDATES: Record<InfraTool, readonly string[]> = {
  aws: ['C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe'],
  terraform: [
    'C:\\Program Files\\Terraform\\terraform.exe',
    'C:\\Program Files\\HashiCorp\\Terraform\\terraform.exe',
  ],
  kubectl: [
    'C:\\Program Files\\Kubernetes\\kubectl.exe',
    'C:\\Program Files\\Docker\\Docker\\resources\\bin\\kubectl.exe',
  ],
}

// Prefix cài đặt do root/admin sở hữu mà realpath phải nằm dưới. Người dùng
// thường không ghi được vào đây trên một máy cài đặt bình thường.
const ALLOWED_PREFIXES: Record<string, readonly string[]> = {
  darwin: ['/opt/homebrew/', '/usr/local/', '/opt/local/', '/usr/'],
  linux: ['/usr/', '/opt/'],
  win32: ['C:\\Program Files\\', 'C:\\Program Files (x86)\\'],
}

// kubectl KHÔNG có cờ `--version` (đo trên v1.33.9: `error: unknown flag`), phải
// dùng `version --client` — và `--client` là bắt buộc để lệnh dò không gọi ra
// API server (dò binary không được chạm hạ tầng).
const VERSION_ARGS: Record<InfraTool, readonly string[]> = {
  aws: ['--version'],
  terraform: ['--version'],
  kubectl: ['version', '--client'],
}

const VERSION_TIMEOUT_MS = 5_000
const VERSION_MAX_BUFFER = 64 * 1024

function candidatesFor(tool: InfraTool, platform: NodeJS.Platform): readonly string[] {
  if (platform === 'win32') return WIN_CANDIDATES[tool]
  const dirs = POSIX_DIRS[platform]
  if (!dirs) return []
  return dirs.map((dir) => `${dir}/${tool}`)
}

// Realpath này có nằm dưới một prefix cài đặt tin cậy không.
function underAllowedPrefix(resolved: string, platform: NodeJS.Platform): boolean {
  const prefixes = ALLOWED_PREFIXES[platform] ?? []
  const isWin = platform === 'win32'
  const target = isWin ? resolved.toLowerCase() : resolved
  return prefixes.some((p) => target.startsWith(isWin ? p.toLowerCase() : p))
}

// Một ứng viên hợp lệ = file THƯỜNG, EXECUTABLE, và realpath hoặc nằm dưới prefix
// tin cậy hoặc được NGƯỜI DÙNG bảo lãnh tường minh (task 0.1b).
//
// Vì sao cần đường bảo lãnh: trên máy dev `/usr/local/bin/kubectl` realpath ra
// `/Applications/OrbStack.app/…`, tức allowlist prefix đang từ chối một kubectl
// CÓ THẬT (`found:false`). Nới prefix sang `/Applications/` là hạ hàng rào cho
// mọi app bundle; bảo lãnh từng đường dẫn giữ mặc-định-từ-chối mà không chặn máy
// thật. Bảo lãnh KHÔNG nới hai kiểm tra kia — file thường + executable vẫn bắt buộc.
//
// Bảo lãnh cũng không đủ để tự nó chạy được cái gì: danh sách ứng viên vẫn là
// hardcode theo OS (`candidatesFor`), nên một realpath được bảo lãnh chỉ có tác
// dụng khi CHÍNH một ứng viên hardcode trỏ tới nó — muốn lợi dụng thì đã phải
// ghi được vào `/usr/local/bin` từ trước (invariant #8).
async function validateCandidate(
  candidate: string,
  platform: NodeJS.Platform,
  vouched: readonly string[],
): Promise<string | null> {
  try {
    const resolved = await realpath(candidate)
    const info = await stat(resolved)
    if (!info.isFile()) return null
    // Windows không có exec bit; tồn tại + đuôi .exe là phép thử thực tế.
    if (platform !== 'win32') {
      await access(resolved, fsConstants.X_OK)
    }
    if (underAllowedPrefix(resolved, platform)) return resolved
    return vouched.includes(resolved) ? resolved : null
  } catch {
    return null
  }
}

const resolveCache = new Map<InfraTool, Promise<string | null>>()

/**
 * Dò một lần rồi memoize theo vòng đời tiến trình. Trả realpath đã verify, hoặc
 * null khi không có bản cài nào nằm trong allowlist.
 */
export async function resolveInfraBinary(tool: InfraTool): Promise<string | null> {
  const cached = resolveCache.get(tool)
  if (cached) return cached
  const pending = (async () => {
    const platform = process.platform
    const vouched = await loadVouchedBinaryPaths()
    for (const candidate of candidatesFor(tool, platform)) {
      // eslint-disable-next-line no-await-in-loop
      const valid = await validateCandidate(candidate, platform, vouched)
      if (valid) return valid
    }
    return null
  })()
  resolveCache.set(tool, pending)
  return pending
}

/**
 * Người dùng bảo lãnh một đường dẫn binary nằm ngoài allowlist prefix (task 0.1b).
 *
 * Bề mặt của CON NGƯỜI: không có tool nào của agent map tới hàm này — nếu agent
 * tự bảo lãnh được đường dẫn thì allowlist hết là allowlist. Verify trước khi
 * ghi (file thường + executable), lưu **realpath** chứ không lưu symlink người
 * dùng đưa vào — nếu lưu symlink thì ai trỏ lại nó là đổi được binary sau lưng
 * lời bảo lãnh — và để lại một dòng nhật ký vì đây là một lần nới rào chắn.
 */
export async function vouchBinaryPath(path: string): Promise<{ path: string }> {
  const resolved = await realpath(path)
  const info = await stat(resolved)
  if (!info.isFile()) throw new Error(`Not a regular file: ${resolved}`)
  if (process.platform !== 'win32') await access(resolved, fsConstants.X_OK)

  await addVouchedBinaryPath(resolved)
  // Kết quả dò đã memoize theo vòng đời tiến trình, mà lời bảo lãnh vừa đổi câu
  // trả lời — không xoá thì `infra.status` vẫn báo `found:false` tới lần khởi
  // động lại, và người dùng tưởng nút bảo lãnh hỏng.
  resolveCache.clear()
  await recordInfraAction({
    actor: 'human',
    surface: 'settings',
    tool: 'infra_binary',
    argv: ['vouch', resolved],
    context: {},
    class: 'write',
    decision: 'approved',
    result: { summary: `vouched binary path ${resolved}` },
  })
  log.info('infra binary: vouched a path outside the install allowlist', { path: resolved })
  return { path: resolved }
}

// Dòng version đầu tiên. Arg array + `windowsHide`, KHÔNG qua shell; timeout để
// một CLI treo (aws v2 lúc nạp Python) không giữ `infra.status` mãi mãi.
function probeVersion(tool: InfraTool, bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      bin,
      [...VERSION_ARGS[tool]],
      { timeout: VERSION_TIMEOUT_MS, maxBuffer: VERSION_MAX_BUFFER, windowsHide: true },
      (err, stdout, stderr) => {
        // aws in version ra stdout, một số bản cũ ra stderr ⇒ lấy luồng nào có chữ.
        const out = `${stdout ?? ''}`.trim() || `${stderr ?? ''}`.trim()
        if (err && !out) {
          resolve(null)
          return
        }
        const first = out.split('\n')[0]?.trim()
        resolve(first ? first : null)
      },
    )
  })
}

/** Gợi ý cài đặt hiển thị khi thiếu binary — không bao giờ throw thay cho nó. */
export function installHint(tool: InfraTool): string {
  switch (process.platform) {
    case 'darwin':
      return `Install ${tool}, e.g. \`brew install ${tool}\`.`
    case 'linux':
      return `Install ${tool} from your package manager, e.g. \`sudo apt install ${tool}\`.`
    case 'win32':
      return `Install ${tool} to its default location under "C:\\Program Files".`
    default:
      return `${tool} is not supported on this platform.`
  }
}

/** Ba dòng cho `infra.status`: công cụ nào có, ở đâu, bản nào. */
export async function infraBinaryStatus(): Promise<InfraBinaryStatus[]> {
  return Promise.all(
    INFRA_TOOLS.map(async (tool): Promise<InfraBinaryStatus> => {
      const path = await resolveInfraBinary(tool)
      if (!path) {
        return { tool, found: false, path: null, version: null, hint: installHint(tool) }
      }
      return { tool, found: true, path, version: await probeVersion(tool, path), hint: null }
    }),
  )
}
