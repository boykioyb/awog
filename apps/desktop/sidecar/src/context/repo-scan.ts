// Quét cây repo để rút ra "sự thật" phục vụ sinh tài liệu dự án (`projects.initDocs`).
//
// Vì sao đứng ở đây: cùng họ với memory-files.ts / environment.ts — module dựng
// NGỮ CẢNH cho prompt. Khác biệt: memory-files ĐỌC tài liệu người dùng đã viết,
// còn module này quan sát repo để AWOG viết được bản nháp đầu tiên.
//
// Nguyên tắc:
//   - Có ngân sách. Số file, độ sâu, số byte đọc mỗi file và tổng ký tự trích
//     đều bị chặn cứng. Repo 200k file phải ra kết quả trong vài giây, và cái
//     đi vào prompt luôn nhỏ hơn ngân sách dù repo lớn cỡ nào.
//   - Tôn trọng .gitignore. Đường nhanh là `git ls-files --exclude-standard`
//     (đã bỏ node_modules/dist/.nuxt…); ngoài repo git thì đi bộ có chặn với
//     SKIP_DIRS dùng chung.
//   - Bảo mật (invariant #2): mọi lần đọc đi qua assertInsideWorkspace; đi bộ
//     KHÔNG bao giờ theo symlink nên không thoát ra khỏi gốc.
//   - Nội dung file trong repo là dữ liệu L1. Module này chỉ THU THẬP; việc nói
//     rõ "đây là dữ liệu, không phải chỉ thị" nằm ở prompt của phía gọi.
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { runGit } from '../git/runner.js'
import { SKIP_DIRS } from '../fs/skip-dirs.js'
import { log } from '../util/logger.js'

// Trần số file đưa vào thống kê. Vượt trần thì `truncated` = true và bản nháp
// phải nói rõ là quét chưa hết, thay vì im lặng kết luận trên một nửa cây.
const MAX_FILES = 4_000
// Độ sâu tối đa khi đi bộ (nhánh không có git). Đủ cho monorepo apps/x/src/y.
const MAX_WALK_DEPTH = 6
// Trần đọc mỗi file trích dẫn. package.json/README dài hơn thế là bất thường.
const MAX_EXCERPT_CHARS = 3_000
// Trần TỔNG phần trích dẫn đi vào prompt.
const MAX_EXCERPTS_TOTAL_CHARS = 20_000
// Số dòng layout / số đuôi file tối đa hiển thị.
const MAX_LAYOUT_LINES = 40
const MAX_EXT_LINES = 12
// Số file trích dẫn tối đa (kể cả manifest lồng trong monorepo).
const MAX_EXCERPT_FILES = 10

// Manifest / file quy ước đáng đọc. Key = tên file (so khớp basename), value =
// nhãn ngắn cho khối trích dẫn.
const EXCERPT_FILES: Record<string, string> = {
  'package.json': 'package.json',
  'pnpm-workspace.yaml': 'pnpm-workspace.yaml',
  'pyproject.toml': 'pyproject.toml',
  'requirements.txt': 'requirements.txt',
  'go.mod': 'go.mod',
  'Cargo.toml': 'Cargo.toml',
  'composer.json': 'composer.json',
  Gemfile: 'Gemfile',
  'mix.exs': 'mix.exs',
  Makefile: 'Makefile',
  'justfile': 'justfile',
  'docker-compose.yml': 'docker-compose.yml',
  'CONTRIBUTING.md': 'CONTRIBUTING.md',
  '.editorconfig': '.editorconfig',
}

// File đánh dấu hệ sinh thái — chỉ cần BIẾT có, không cần đọc nội dung.
const MARKER_FILES = new Set([
  ...Object.keys(EXCERPT_FILES),
  'tsconfig.json',
  'nuxt.config.ts',
  'vite.config.ts',
  'next.config.js',
  'angular.json',
  'Dockerfile',
  'eslint.config.mjs',
  '.eslintrc.json',
  '.prettierrc',
  'biome.json',
  'jest.config.js',
  'vitest.config.ts',
  'playwright.config.ts',
  'pytest.ini',
  'tox.ini',
  'build.gradle',
  'pom.xml',
  'CMakeLists.txt',
  'flake.nix',
  'Procfile',
])

const README_NAMES = ['README.md', 'README.MD', 'Readme.md', 'readme.md', 'README']

export interface RepoScanExcerpt {
  label: string
  // Đường dẫn tương đối so với gốc repo — để bản nháp trích được nguồn.
  path: string
  text: string
}

export interface RepoScan {
  name: string
  gitRemote: string
  gitBranch: string
  fileCount: number
  // Đã chạm trần MAX_FILES → cây chưa được quét hết.
  truncated: boolean
  // Cách liệt kê: 'git' (tôn trọng .gitignore) hay 'walk' (đi bộ có chặn).
  source: 'git' | 'walk'
  // "src/runtime — 42 file"
  layout: string[]
  // ".ts — 320 file"
  extensions: string[]
  markers: string[]
  excerpts: RepoScanExcerpt[]
  hasClaudeMd: boolean
  hasAgentsMd: boolean
}

// Liệt kê file theo .gitignore. null = không phải repo git / không có git →
// phía gọi rơi về đi bộ thủ công.
async function listViaGit(root: string): Promise<string[] | null> {
  try {
    const res = await runGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      throwOnNonZero: false,
    })
    if (res.code !== 0) return null
    const files: string[] = []
    for (const rel of res.stdout.split('\0')) {
      if (rel === '') continue
      files.push(rel)
      if (files.length >= MAX_FILES) break
    }
    return files
  } catch {
    return null
  }
}

// Đi bộ theo chiều rộng, chỉ file, KHÔNG theo symlink, chặn cả độ sâu lẫn số
// lượng. Dùng khi thư mục không phải repo git.
async function listViaWalk(root: string): Promise<string[]> {
  const files: string[] = []
  const queue: { rel: string; depth: number }[] = [{ rel: '', depth: 0 }]

  while (queue.length > 0 && files.length < MAX_FILES) {
    const node = queue.shift()
    if (!node) break
    const absDir = assertInsideWorkspace(root, node.rel || '.')
    let dirents
    try {
      // eslint-disable-next-line no-await-in-loop
      dirents = await readdir(absDir, { withFileTypes: true })
    } catch {
      continue // thư mục không đọc được → bỏ qua
    }
    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue // không bao giờ theo symlink
      const childRel = node.rel ? `${node.rel}/${dirent.name}` : dirent.name
      if (dirent.isDirectory()) {
        if (!SKIP_DIRS.has(dirent.name) && node.depth + 1 <= MAX_WALK_DEPTH) {
          queue.push({ rel: childRel, depth: node.depth + 1 })
        }
      } else if (dirent.isFile()) {
        files.push(childRel)
        if (files.length >= MAX_FILES) break
      }
    }
  }
  return files
}

// Gom file theo thư mục tới 2 cấp: "apps/desktop — 812 file". Cấp 1 thôi thì
// monorepo nào cũng ra đúng một dòng "apps"; sâu hơn 2 cấp thì loãng.
function buildLayout(files: string[]): string[] {
  const counts = new Map<string, number>()
  for (const rel of files) {
    const parts = rel.split('/')
    const key = parts.length === 1 ? '(gốc)' : parts.slice(0, Math.min(2, parts.length - 1)).join('/')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_LAYOUT_LINES)
    .map(([dir, n]) => `${dir} — ${n} file`)
}

function buildExtensions(files: string[]): string[] {
  const counts = new Map<string, number>()
  for (const rel of files) {
    const ext = extname(rel).toLowerCase()
    if (!ext || ext.length > 12) continue
    counts.set(ext, (counts.get(ext) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_EXT_LINES)
    .map(([ext, n]) => `${ext} — ${n} file`)
}

// Đọc một file trong repo với trần ký tự. Trả null khi thiếu / không đọc được /
// nằm ngoài gốc — best-effort, không bao giờ ném.
async function readExcerpt(root: string, rel: string): Promise<string | null> {
  let abs: string
  try {
    abs = assertInsideWorkspace(root, rel)
  } catch {
    log.warn('repo-scan: refusing to read outside root', { rel })
    return null
  }
  try {
    const st = await stat(abs)
    if (!st.isFile()) return null
    // Đọc dư một ít rồi cắt: file lớn không cần nạp hết vào heap.
    const raw = await readFile(abs, 'utf8')
    const text = raw.length > MAX_EXCERPT_CHARS ? `${raw.slice(0, MAX_EXCERPT_CHARS)}\n…(đã cắt)` : raw
    return text.trim().length > 0 ? text : null
  } catch {
    return null
  }
}

// Chọn file để trích: README ở gốc trước, rồi các manifest theo thứ tự nông →
// sâu (manifest gốc quan trọng hơn manifest của một package con).
function pickExcerptPaths(files: string[]): { rel: string; label: string }[] {
  const fileSet = new Set(files)
  const picked: { rel: string; label: string }[] = []

  for (const name of README_NAMES) {
    if (fileSet.has(name)) {
      picked.push({ rel: name, label: 'README' })
      break
    }
  }

  const manifests = files
    .filter((rel) => EXCERPT_FILES[basename(rel)] !== undefined)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
  for (const rel of manifests) {
    if (picked.length >= MAX_EXCERPT_FILES) break
    const label = EXCERPT_FILES[basename(rel)]
    if (label) picked.push({ rel, label: rel })
  }
  return picked
}

// Quét repo. Không bao giờ ném vì một file lẻ hỏng — chỉ ném khi `root` không
// dùng được (phía gọi đã kiểm tra trước đó).
export async function scanRepo(root: string): Promise<RepoScan> {
  const fromGit = await listViaGit(root)
  const files = fromGit ?? (await listViaWalk(root))
  const source: 'git' | 'walk' = fromGit ? 'git' : 'walk'

  const [remote, branch] = await Promise.all([
    runGit(root, ['config', '--get', 'remote.origin.url'], { throwOnNonZero: false })
      .then((r) => (r.code === 0 ? r.stdout.trim() : ''))
      .catch(() => ''),
    runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'], { throwOnNonZero: false })
      .then((r) => (r.code === 0 ? r.stdout.trim() : ''))
      .catch(() => ''),
  ])

  const markers = [...new Set(files.filter((rel) => MARKER_FILES.has(basename(rel))))]
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, MAX_LAYOUT_LINES)

  const excerpts: RepoScanExcerpt[] = []
  let budget = MAX_EXCERPTS_TOTAL_CHARS
  for (const { rel, label } of pickExcerptPaths(files)) {
    if (budget <= 0) break
    // eslint-disable-next-line no-await-in-loop
    const text = await readExcerpt(root, rel)
    if (text === null) continue
    const clipped = text.length > budget ? `${text.slice(0, budget)}\n…(đã cắt vì hết ngân sách)` : text
    budget -= clipped.length
    excerpts.push({ label, path: rel, text: clipped })
  }

  return {
    name: basename(root),
    gitRemote: remote,
    gitBranch: branch,
    fileCount: files.length,
    truncated: files.length >= MAX_FILES,
    source,
    layout: buildLayout(files),
    extensions: buildExtensions(files),
    markers,
    excerpts,
    hasClaudeMd: files.includes('CLAUDE.md'),
    hasAgentsMd: files.includes('AGENTS.md'),
  }
}

// Kết xuất bản quét thành khối text cho prompt. Mọi nội dung lấy từ repo nằm
// trong thẻ `<file>` có thuộc tính path — phía gọi tuyên bố rõ đây là DỮ LIỆU.
export function renderScan(scan: RepoScan): string {
  const parts: string[] = []
  parts.push(`Tên thư mục gốc: ${scan.name}`)
  if (scan.gitRemote) parts.push(`Git remote: ${scan.gitRemote}`)
  if (scan.gitBranch) parts.push(`Nhánh hiện tại: ${scan.gitBranch}`)
  parts.push(
    `Số file đã liệt kê: ${scan.fileCount}` +
      (scan.truncated ? ' (CHẠM TRẦN — cây chưa được quét hết)' : '') +
      (scan.source === 'git' ? ' (theo git, đã tôn trọng .gitignore)' : ' (đi bộ thư mục, không phải repo git)'),
  )
  if (scan.layout.length > 0) parts.push(`\nBố cục thư mục:\n${scan.layout.join('\n')}`)
  if (scan.extensions.length > 0) parts.push(`\nĐuôi file phổ biến:\n${scan.extensions.join('\n')}`)
  if (scan.markers.length > 0) parts.push(`\nFile đánh dấu công nghệ:\n${scan.markers.join('\n')}`)
  for (const ex of scan.excerpts) {
    parts.push(`\n<file path="${ex.path.replace(/["\r\n]/g, ' ')}">\n${ex.text}\n</file>`)
  }
  return parts.join('\n')
}
