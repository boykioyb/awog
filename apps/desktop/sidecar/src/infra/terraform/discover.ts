// Dò thư mục Terraform + metadata của state (ADR 0088 §7, việc 12 / P1).
//
// CHỈ ĐỌC. Không spawn `terraform` ở đây: `terraform workspace list` phải chạy
// qua `infra.run.ts` (luật cứng #3) và cần credential + state thật, nên nó là
// một lời gọi RIÊNG, do người dùng bấm (luật cứng #4). Module này chỉ trả lời
// "trên đĩa có những thư mục nào trông như Terraform, và state của chúng khai
// ở đâu" — đủ để chip nói cho người dùng biết mình sắp động vào cái gì.
//
// Không có giá trị secret nào đi qua đây: backend block của Terraform chứa
// ĐỊA CHỈ state (bucket/key/region), không chứa khoá — khoá nằm trong env hoặc
// trong biến. Dù vậy bảng khoá ở dưới vẫn là allowlist: `access_key`,
// `secret_key`, `password`, `token` KHÔNG bao giờ được cắt ra.

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { log } from '../../util/logger.js'

/** Một thư mục có file `.tf`. */
export type TerraformDir = {
  /** Đường dẫn TUYỆT ĐỐI — `-chdir=` chạy đúng bất kể cwd của sidecar. */
  path: string
  /** Nhãn hiển thị: đường dẫn tương đối so với gốc quét ('' = chính gốc). */
  label: string
  /** Số file `.tf` nhìn thấy (đã bỏ qua file quá lớn). */
  fileCount: number
  /** `required_version` khai trong `terraform { … }`, '' nếu không có. */
  requiredVersion: string
  /** Loại backend: 's3' · 'gcs' · 'azurerm' · 'local' · 'cloud' · '' khi không khai. */
  backendType: string
  /** Các khoá ĐỊA CHỈ có mặt trong block backend (tên khoá, không giá trị). */
  backendKeys: string[]
  /** Dòng mô tả ngắn vị trí state, dựng từ allowlist khoá địa chỉ. '' nếu chịu. */
  backendSummary: string
  /** Đã `terraform init` (có thư mục `.terraform/`) hay chưa. */
  initialized: boolean
}

const MAX_DEPTH = 2
const MAX_DIRS = 400
const MAX_TF_FILES = 40
const MAX_TF_BYTES = 256 * 1024

// Thư mục không bao giờ chứa `*.tf` của người dùng, và đi vào thì tốn thời gian
// vô ích. `.terraform` bị loại vì bên trong là bản sao module đã tải về.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.terraform',
  '.terragrunt-cache',
  'vendor',
  'dist',
  'build',
  '.next',
  '.venv',
  '__pycache__',
])

// Khoá ĐỊA CHỈ của state — thứ người dùng cần biết trước khi gõ `apply`. Cố ý
// KHÔNG có `access_key`/`secret_key`/`password`/`token`: chúng là credential, và
// một allowlist là thứ duy nhất đứng được trước một block backend lạ.
const LOCATION_KEYS: ReadonlySet<string> = new Set([
  'bucket',
  'key',
  'region',
  'prefix',
  'path',
  'container',
  'resource_group_name',
  'storage_account_name',
  'organization',
  'workspaces_prefix',
  'dynamodb_table',
])

// Khoá chứa credential: nếu tên khớp mấy mẫu này thì bỏ, kể cả khi trùng
// LOCATION_KEYS (phòng một backend lạ đặt tên `bucket_password`).
const SECRET_KEY_RE = /secret|password|token|access[_-]?key|credential|private/i

type BlockMeta = {
  requiredVersion: string
  backendType: string
  backendValues: Map<string, string>
  backendKeys: Set<string>
}

/** Bỏ comment `#`/`//` cuối dòng, tôn trọng dấu nháy. */
function stripTfComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"') {
      quote = ch
      continue
    }
    if (ch === '#') return line.slice(0, i)
    if (ch === '/' && line[i + 1] === '/') return line.slice(0, i)
  }
  return line
}

function unquote(raw: string): string {
  const v = raw.trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1)
  return v
}

/**
 * Metadata của một file `.tf`: `required_version` + block `backend`.
 *
 * Quét theo dòng với bộ đếm ngoặc thay vì parse HCL đầy đủ — đủ cho hai thứ cần
 * đọc, và hỏng thì trả về rỗng chứ không ném: một file `.tf` lạ không được phép
 * làm chết cả danh sách ngữ cảnh.
 */
export function parseTerraformFile(text: string): BlockMeta {
  const meta: BlockMeta = {
    requiredVersion: '',
    backendType: '',
    backendValues: new Map(),
    backendKeys: new Set(),
  }
  let depth = 0
  // Độ sâu của block `terraform { }` đang mở (0 = không mở).
  let terraformDepth = -1
  // Độ sâu của block `backend "x" { }` đang mở.
  let backendDepth = -1
  let cloudDepth = -1

  for (const rawLine of text.split('\n')) {
    const line = stripTfComment(rawLine.replace(/\r$/, '')).trim()
    if (line.length === 0) continue

    if (terraformDepth < 0 && /^terraform\b/.test(line) && line.includes('{')) {
      terraformDepth = depth
    }
    if (terraformDepth >= 0 && backendDepth < 0 && cloudDepth < 0) {
      const backend = /^backend\s+"([^"]+)"\s*\{/.exec(line)
      if (backend) {
        meta.backendType = backend[1]
        backendDepth = depth
      } else if (/^cloud\s*\{/.test(line)) {
        meta.backendType = 'cloud'
        cloudDepth = depth
      } else {
        const rv = /^required_version\s*=\s*(.+)$/.exec(line)
        if (rv) meta.requiredVersion = unquote(rv[1])
      }
    }
    if (backendDepth >= 0 || cloudDepth >= 0) {
      const kv = /^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+)$/.exec(line)
      if (kv) {
        const name = kv[1]
        meta.backendKeys.add(name)
        if (LOCATION_KEYS.has(name) && !SECRET_KEY_RE.test(name)) {
          meta.backendValues.set(name, unquote(kv[2]))
        }
      }
    }

    for (const ch of line) {
      if (ch === '{') depth += 1
      else if (ch === '}') depth -= 1
    }
    if (backendDepth >= 0 && depth <= backendDepth) backendDepth = -1
    if (cloudDepth >= 0 && depth <= cloudDepth) cloudDepth = -1
    if (terraformDepth >= 0 && depth <= terraformDepth) terraformDepth = -1
  }
  return meta
}

function summaryOf(type: string, values: Map<string, string>): string {
  const parts: string[] = []
  for (const [k, v] of values) {
    if (v.length === 0 || v.startsWith('var.') || v.startsWith('local.')) continue
    parts.push(`${k}=${v}`)
  }
  if (parts.length === 0) return type
  return `${type} · ${parts.join(' · ')}`
}

async function readDirFiles(dir: string): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  return names.filter((n) => n.endsWith('.tf')).slice(0, MAX_TF_FILES)
}

async function describeDir(root: string, dir: string): Promise<TerraformDir | null> {
  const files = await readDirFiles(dir)
  if (files.length === 0) return null

  let backendType = ''
  let requiredVersion = ''
  const backendValues = new Map<string, string>()
  const backendKeys = new Set<string>()

  for (const name of files) {
    let text: string
    try {
      const info = await stat(join(dir, name))
      if (!info.isFile() || info.size > MAX_TF_BYTES) continue
      text = await readFile(join(dir, name), 'utf8')
    } catch {
      continue
    }
    const meta = parseTerraformFile(text)
    if (!requiredVersion && meta.requiredVersion) requiredVersion = meta.requiredVersion
    if (!backendType && meta.backendType) backendType = meta.backendType
    for (const k of meta.backendKeys) backendKeys.add(k)
    for (const [k, v] of meta.backendValues) if (!backendValues.has(k)) backendValues.set(k, v)
  }

  let initialized = false
  try {
    initialized = (await stat(join(dir, '.terraform'))).isDirectory()
  } catch {
    initialized = false
  }

  const rel = relative(root, dir)
  return {
    path: resolve(dir),
    label: rel === '' ? '.' : rel.split(sep).join('/'),
    fileCount: files.length,
    requiredVersion,
    backendType,
    backendKeys: [...backendKeys].sort(),
    backendSummary: backendType ? summaryOf(backendType, backendValues) : '',
    initialized,
  }
}

/**
 * Quét `root` tối đa 2 cấp tìm thư mục có `*.tf`. Trả về danh sách đã sắp xếp
 * theo label để UI không nhảy thứ tự giữa hai lần gọi.
 */
export async function listTerraformDirs(root: string): Promise<TerraformDir[]> {
  const found: TerraformDir[] = []
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  let visited = 0

  while (queue.length > 0 && visited < MAX_DIRS) {
    const next = queue.shift()
    if (!next) break
    visited += 1
    const described = await describeDir(root, next.dir)
    if (described) found.push(described)
    if (next.depth >= MAX_DEPTH) continue

    let entries: { name: string; isDirectory: () => boolean }[]
    try {
      entries = await readdir(next.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const name = entry.name
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue
      queue.push({ dir: join(next.dir, name), depth: next.depth + 1 })
    }
  }

  if (visited >= MAX_DIRS) {
    log.warn('terraform discover: directory cap reached', { root, cap: MAX_DIRS })
  }
  return found.sort((a, b) => a.label.localeCompare(b.label))
}
