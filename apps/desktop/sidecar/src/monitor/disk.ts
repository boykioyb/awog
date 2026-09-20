// Giám sát đĩa: dung lượng ổ, danh mục rác quen thuộc, và quét sâu một thư mục.
//
// ĐỌC THÔI. Module này KHÔNG xoá gì cả — việc xoá đi qua `shell.trashItem` của
// Electron (chuyển vào Thùng rác, hoàn tác được) chứ không phải `rm -rf` ở đây.
// Ranh giới đó là cố ý: một lời gọi `rm -rf` sai đường dẫn không có đường lùi.
//
// ⚠ `du` CHẬM và không có cách nào làm nó nhanh: đo trên máy thật,
// `du -sk ~/Library/Caches` (19.7 GB) mất **19.5 giây**. Vì thế API chia làm hai:
// `listTargets()` trả về danh sách tức thì (chỉ `stat`), rồi UI hỏi kích thước
// TỪNG mục một — hiện dần chứ không treo cả trang chờ một con số tổng.

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import { readdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { RpcError } from '../transport/rpc.js'
import { emit } from '../transport/stdio.js'

const exec = promisify(execFile)

/** `du` trên một cây lớn có thể chạy rất lâu; cắt để một mục hỏng không treo mãi. */
const DU_TIMEOUT_MS = 120_000
const DF_TIMEOUT_MS = 5_000

export interface DiskVolume {
  mount: string
  filesystem: string
  totalKb: number
  usedKb: number
  freeKb: number
}

export type JunkKind = 'cache' | 'build' | 'store' | 'trash' | 'logs'

/**
 * `safe`   — hệ thống/công cụ tự sinh lại; xoá đi chỉ mất thời gian tải lại.
 * `review` — xoá được nhưng người dùng phải tự quyết (mất state, phải build lại lâu).
 */
export type JunkSafety = 'safe' | 'review'

export interface JunkTarget {
  id: string
  label: string
  path: string
  kind: JunkKind
  safety: JunkSafety
  /** Nói rõ mất gì khi xoá — người dùng không đoán được từ đường dẫn. */
  hint: string
}

// ─── Dung lượng ổ ───────────────────────────────────────────────────────────

/** `/dev/disk3s5` → `disk3`. Hai volume cùng container APFS dùng chung dung lượng. */
function containerOf(filesystem: string): string {
  return /^\/dev\/(disk\d+)/.exec(filesystem)?.[1] ?? ''
}

function parseDfLine(line: string): DiskVolume | null {
  // "filesystem 1024-blocks used available capacity ... mounted-on"
  const m = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%.*?\s(\/.*)$/.exec(line.trim())
  if (!m) return null
  const [, filesystem, total, used, free, mount] = m
  return {
    filesystem: filesystem ?? '',
    totalKb: Number(total),
    usedKb: Number(used),
    freeKb: Number(free),
    mount: mount ?? '',
  }
}

/**
 * Ổ đáng quan tâm: ổ chứa thư mục nhà, cộng các ổ gắn ngoài.
 *
 * KHÔNG liệt kê cả `df`: trên APFS, `/`, `/System/Volumes/VM`, `/…/Preboot`,
 * `/…/Update`, `/…/Data` dùng CHUNG một container nên `df` in ra bảy dòng cùng
 * dung lượng tổng — một bảng như thế chỉ làm người đọc rối. Ổ thật sự chứa dữ
 * liệu người dùng là ổ mà `df <home>` trỏ tới (đo được: 377 GB/482 GB, 86%).
 */
export async function listVolumes(): Promise<DiskVolume[]> {
  if (process.platform === 'win32') return []
  const out: DiskVolume[] = []
  const seen = new Set<string>()

  const add = (line: string): void => {
    const v = parseDfLine(line)
    if (!v || seen.has(v.filesystem)) return
    seen.add(v.filesystem)
    out.push(v)
  }

  try {
    const { stdout } = await exec('df', ['-k', homedir()], { timeout: DF_TIMEOUT_MS })
    for (const line of stdout.split('\n').slice(1)) add(line)
  } catch {
    return out
  }

  // Ổ gắn ngoài (macOS gắn ở /Volumes, Linux ở /media|/mnt).
  //
  // Hai thứ phải lọc, đo được trên máy thật:
  //   • `/Volumes/Recovery` nằm CÙNG container APFS với ổ nhà nên `df` in ra đúng
  //     một bộ số tổng/còn trống — hiện nó là lặp lại dòng trên với nhãn khác.
  //   • Ảnh đĩa đang mount (`.dmg` của một trình cài đặt) ra 0.0/0.0 GB.
  const homeContainer = containerOf(out[0]?.filesystem ?? '')
  try {
    const { stdout } = await exec('df', ['-k'], { timeout: DF_TIMEOUT_MS })
    for (const line of stdout.split('\n').slice(1)) {
      const v = parseDfLine(line)
      if (!v || !/^\/(Volumes|media|mnt)\//.test(v.mount)) continue
      if (homeContainer && containerOf(v.filesystem) === homeContainer) continue
      if (v.totalKb < 1024 * 1024) continue
      add(line)
    }
  } catch {
    // Không có ổ ngoài cũng không sao.
  }
  return out
}

// ─── Danh mục rác ───────────────────────────────────────────────────────────

interface Candidate extends Omit<JunkTarget, 'path'> {
  rel: string
}

// Đường dẫn TƯƠNG ĐỐI với thư mục nhà — không bao giờ ghép từ input nào.
const CANDIDATES: readonly Candidate[] = [
  {
    id: 'lib-caches',
    label: 'Cache ứng dụng',
    rel: 'Library/Caches',
    kind: 'cache',
    safety: 'safe',
    hint: 'Ứng dụng tự tạo lại. Lần mở đầu sau khi xoá sẽ chậm hơn một chút.',
  },
  {
    id: 'lib-logs',
    label: 'Log hệ thống của ứng dụng',
    rel: 'Library/Logs',
    kind: 'logs',
    safety: 'safe',
    hint: 'Chỉ mất lịch sử log cũ.',
  },
  {
    id: 'xcode-derived',
    label: 'Xcode DerivedData',
    rel: 'Library/Developer/Xcode/DerivedData',
    kind: 'build',
    safety: 'safe',
    hint: 'Xcode build lại từ đầu ở lần mở project sau.',
  },
  {
    id: 'xcode-devicesupport',
    label: 'Xcode iOS DeviceSupport',
    rel: 'Library/Developer/Xcode/iOS DeviceSupport',
    kind: 'cache',
    safety: 'review',
    hint: 'Symbol để debug trên máy thật; tải lại khi cắm lại thiết bị đó.',
  },
  {
    id: 'coresim-caches',
    label: 'CoreSimulator caches',
    rel: 'Library/Developer/CoreSimulator/Caches',
    kind: 'cache',
    safety: 'safe',
    hint: 'Simulator tự tạo lại.',
  },
  {
    id: 'pnpm-store',
    label: 'pnpm store',
    rel: 'Library/pnpm/store',
    kind: 'store',
    safety: 'review',
    hint: 'Kho gói dùng chung. Xoá xong mọi project phải tải lại dependency.',
  },
  {
    id: 'pnpm-store-dot',
    label: 'pnpm store (.pnpm-store)',
    rel: '.pnpm-store',
    kind: 'store',
    safety: 'review',
    hint: 'Như trên, cho bản cấu hình store-dir khác.',
  },
  {
    id: 'npm-cache',
    label: 'npm cache',
    rel: '.npm/_cacache',
    kind: 'store',
    safety: 'safe',
    hint: 'npm tự tải lại khi cần.',
  },
  {
    id: 'yarn-cache',
    label: 'Yarn cache',
    rel: 'Library/Caches/Yarn',
    kind: 'store',
    safety: 'safe',
    hint: 'Yarn tự tải lại khi cần.',
  },
  {
    id: 'cargo-registry',
    label: 'Cargo registry',
    rel: '.cargo/registry',
    kind: 'store',
    safety: 'safe',
    hint: 'Cargo tải lại crate khi build lần sau.',
  },
  {
    id: 'gradle-caches',
    label: 'Gradle caches',
    rel: '.gradle/caches',
    kind: 'store',
    safety: 'review',
    hint: 'Build Gradle kế tiếp sẽ tải lại toàn bộ dependency.',
  },
  {
    id: 'maven-repo',
    label: 'Maven repository',
    rel: '.m2/repository',
    kind: 'store',
    safety: 'review',
    hint: 'Build Maven kế tiếp sẽ tải lại toàn bộ dependency.',
  },
  {
    id: 'xdg-cache',
    label: 'Cache ~/.cache',
    rel: '.cache',
    kind: 'cache',
    safety: 'safe',
    hint: 'Nơi nhiều công cụ dòng lệnh để cache; tự tạo lại.',
  },
  {
    id: 'trash',
    label: 'Thùng rác',
    rel: '.Trash',
    kind: 'trash',
    safety: 'safe',
    hint: 'Đã nằm trong thùng rác rồi — xoá là dọn hẳn.',
  },
]

/** Thư mục build/dependency trong một project, tìm ở cấp 1. */
const PROJECT_JUNK: readonly { name: string; kind: JunkKind; hint: string }[] = [
  { name: 'node_modules', kind: 'store', hint: 'Cài lại bằng một lệnh install.' },
  { name: '.nuxt', kind: 'build', hint: 'Nuxt tự sinh lại khi chạy dev/build.' },
  { name: '.output', kind: 'build', hint: 'Kết quả build; sinh lại bằng lệnh build.' },
  { name: '.next', kind: 'build', hint: 'Next.js tự sinh lại.' },
  { name: 'dist', kind: 'build', hint: 'Kết quả build; sinh lại bằng lệnh build.' },
  { name: 'target', kind: 'build', hint: 'Thư mục build của Rust/Java; sinh lại khi build.' },
]

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Danh sách mục CÓ THẬT trên máy. Nhanh (chỉ `stat`) — kích thước hỏi riêng
 * từng mục, vì `du` là phần đắt.
 *
 * `projectRoots` là các thư mục project AWOG đang quản lý; chỉ quét cấp 1 trong
 * mỗi project, không lần xuống sâu.
 */
export async function listJunkTargets(projectRoots: string[] = []): Promise<JunkTarget[]> {
  const home = homedir()
  const found: JunkTarget[] = []

  for (const c of CANDIDATES) {
    const path = join(home, c.rel)
    if (await exists(path)) {
      const { rel: _rel, ...rest } = c
      found.push({ ...rest, path })
    }
  }

  for (const root of projectRoots) {
    if (!isAbsolute(root)) continue
    const name = root.split('/').filter(Boolean).pop() ?? root
    for (const j of PROJECT_JUNK) {
      const path = join(root, j.name)
      if (!(await exists(path))) continue
      found.push({
        id: `proj:${path}`,
        label: `${name} · ${j.name}`,
        path,
        kind: j.kind,
        safety: 'review',
        hint: j.hint,
      })
    }
  }
  return found
}

// ─── Kích thước + quét sâu ──────────────────────────────────────────────────

/**
 * Thư mục giả / mount đặc biệt: đo chúng là vô nghĩa hoặc treo hẳn.
 *
 * `/dev`, `/proc`, `/sys` là filesystem ảo; `.timemachine` và `.Snapshot` là
 * snapshot mà `du` sẽ bò qua hàng terabyte ảo.
 */
const UNSCANNABLE = ['/dev', '/proc', '/sys', '/Volumes/.timemachine', '/.Snapshot']

/**
 * Cổng cho phần ĐỌC (đo kích thước, liệt kê thư mục).
 *
 * ⚠ Bản đầu chặn ngoài thư mục nhà. Nới ra vì nó chặn luôn CÂU HỎI CHÍNH của
 * trang: "360 GB trên ổ nằm ở đâu" — mà phần lớn câu trả lời (`/Applications`,
 * `/Library`, ổ gắn ngoài) nằm ngoài nhà. Đây là thao tác CHỈ ĐỌC và chỉ cộng
 * kích thước; hệ điều hành vẫn từ chối những thư mục người dùng không có quyền.
 *
 * ⚠ Ranh giới XOÁ thì KHÔNG nới: `shell.trashItem` ở Electron main vẫn chỉ nhận
 * đường dẫn trong nhà, sâu ≥ 2 cấp. Nhìn được cả đĩa ≠ xoá được cả đĩa.
 */
function assertScannable(path: string): string {
  const abs = canonicalPath(resolve(path))
  if (!isAbsolute(abs)) throw new RpcError(-32602, 'Path must be absolute')
  if (UNSCANNABLE.some((p) => abs === p || abs.startsWith(`${p}/`))) {
    throw new RpcError(-32602, `Refusing to scan ${abs}`)
  }
  return abs
}

/**
 * Trên APFS, MỘT thư mục có HAI đường dẫn hợp lệ: `/Users/kyro` và
 * `/System/Volumes/Data/Users/kyro` (firmlink). Ổ dữ liệu mount ở
 * `/System/Volumes/Data`, nên duyệt từ thẻ ổ sinh ra dạng thứ hai — và mọi thứ
 * so khớp theo tiền tố đều trượt:
 *   • breadcrumb không nhận ra `~` nên thành một mẩu chết không bấm được;
 *   • `canTrash` không thấy tiền tố thư mục nhà nên nút xoá biến mất;
 *   • người dùng thấy ba lỗi rời rạc, thực ra là MỘT.
 * Chuẩn hoá ở BIÊN (chỗ duy nhất đường dẫn đi vào) thay vì bắt mọi nơi so khớp
 * phải nhớ cả hai dạng.
 */
export function canonicalPath(abs: string): string {
  const DATA = '/System/Volumes/Data'
  if (abs === DATA) return '/'
  return abs.startsWith(`${DATA}/`) ? abs.slice(DATA.length) : abs
}

/** Thư mục nhà — UI cần nó để biết mục nào xoá được (xem chú thích trên). */
export function homeRoot(): string {
  return homedir()
}

export async function measure(path: string): Promise<{ path: string; sizeKb: number }> {
  const abs = assertScannable(path)
  try {
    // `-x`: không vượt sang filesystem khác (tránh đi lạc vào ổ gắn ngoài hoặc
    // network mount và treo ở đó).
    const { stdout } = await exec('du', ['-skx', abs], { timeout: DU_TIMEOUT_MS })
    return { path: abs, sizeKb: Number(stdout.trim().split(/\s+/)[0]) || 0 }
  } catch (err) {
    // `du` trả mã khác 0 khi gặp thư mục không đọc được, NHƯNG vẫn in tổng ra
    // stdout — nên một lỗi quyền không được làm mất cả con số.
    const out = (err as { stdout?: string }).stdout ?? ''
    const n = Number(out.trim().split(/\s+/)[0])
    if (Number.isFinite(n) && n > 0) return { path: abs, sizeKb: n }
    throw new RpcError(-32603, err instanceof Error ? err.message : String(err))
  }
}

export interface TreeEntry {
  path: string
  name: string
  sizeKb: number
  /** Thư mục thì lần xuống được, file thì không — UI cần biết để khỏi mời bấm. */
  isDir: boolean
}

/**
 * Quét một cấp con, phát kết quả DẦN.
 *
 * ⚠ Bản đầu chạy `du -kx -d 1 <parent>` rồi đọc stdout theo dòng, tin rằng `du`
 * in mỗi thư mục con ngay khi duyệt xong nó. ĐO ĐƯỢC LÀ KHÔNG: trên macOS, khi
 * stdout là pipe thì libc đệm theo KHỐI, nên toàn bộ 400 dòng về cùng một lúc ở
 * giây thứ 21.7 — đúng bằng lúc `du` kết thúc. Streaming trên giấy, spinner trên
 * thực tế.
 *
 * Cách hiện tại, cho tiến độ thật:
 *   1. `readdir` thư mục cha — TỨC THÌ, nên danh sách tên hiện ra ngay.
 *   2. File thì lấy kích thước từ `stat` (không cần `du`).
 *   3. Thư mục thì chạy `du -skx` cho TỪNG cái, tối đa `SCAN_CONCURRENCY` cùng lúc,
 *      phát kết quả ngay khi mỗi cái xong.
 *
 * Cùng khối lượng công việc như `du -d 1`, nhưng người dùng thấy danh sách dài
 * dần và biết còn bao nhiêu mục nữa.
 */
export interface TreeScan {
  scanId: string
  /** Đường dẫn ĐÃ CHUẨN HOÁ — UI phải dùng cái này, không phải cái nó gửi lên. */
  path: string
}

/** Trần số mục: một thư mục 10k mục con không được biến thành 10k event. */
const TREE_EMIT_CAP = 400
/** `du` là I/O nặng; mở quá nhiều chỉ làm đĩa nghẽn và chậm đi. */
const SCAN_CONCURRENCY = 4

let scanCounter = 0
/** scanId → các tiến trình `du` đang chạy của lượt đó, để huỷ được. */
const activeScans = new Map<string, Set<ChildProcess>>()

function duSize(path: string, register: (c: ChildProcess) => void): Promise<number> {
  return new Promise((resolve) => {
    // `-x`: không vượt sang filesystem khác (tránh đi lạc vào ổ mạng rồi treo).
    const child = spawn('du', ['-skx', path], { stdio: ['ignore', 'pipe', 'pipe'] })
    register(child)
    let out = ''
    child.stdout.on('data', (b: Buffer) => {
      out += b.toString()
    })
    // stderr là những dòng "Permission denied" — bình thường khi quét thư mục hệ
    // thống, và `du` vẫn in tổng của phần đọc được, nên KHÔNG coi là lỗi.
    child.stderr.resume()
    child.on('close', () => resolve(Number(out.trim().split(/\s+/)[0]) || 0))
    child.on('error', () => resolve(0))
  })
}

export function startTreeScan(path: string): TreeScan {
  const abs = assertScannable(path)
  scanCounter += 1
  const scanId = `scan-${scanCounter}`
  const running = new Set<ChildProcess>()
  activeScans.set(scanId, running)

  void (async () => {
    let names: Dirent[]
    try {
      names = await readdir(abs, { withFileTypes: true })
    } catch (err) {
      activeScans.delete(scanId)
      emit('disk.tree-done', {
        scanId,
        count: 0,
        error: err instanceof Error ? err.message : String(err),
      })
      return
    }

    const picked = names.slice(0, TREE_EMIT_CAP)
    // Danh sách tên đi TRƯỚC, kích thước theo sau: người dùng thấy ngay thư mục
    // có gì, và biết còn bao nhiêu mục phải đợi.
    emit('disk.tree-list', {
      scanId,
      total: picked.length,
      truncated: names.length > picked.length,
    })

    const queue = [...picked]
    const worker = async (): Promise<void> => {
      for (;;) {
        if (!activeScans.has(scanId)) return
        const dirent = queue.shift()
        if (!dirent) return
        const entryPath = join(abs, dirent.name)
        const isDir = dirent.isDirectory()
        let sizeKb = 0
        if (isDir) {
          sizeKb = await duSize(entryPath, (c) => running.add(c))
        } else {
          try {
            const st = await stat(entryPath)
            sizeKb = Math.round(st.size / 1024)
          } catch {
            sizeKb = 0
          }
        }
        if (!activeScans.has(scanId)) return
        emit('disk.tree-entry', {
          scanId,
          entry: { path: entryPath, name: dirent.name, sizeKb, isDir },
        })
      }
    }

    await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker))
    if (!activeScans.has(scanId)) return
    activeScans.delete(scanId)
    emit('disk.tree-done', {
      scanId,
      count: picked.length,
      truncated: names.length > picked.length,
    })
  })()

  return { scanId, path: abs }
}

/**
 * Dừng một lượt quét đang chạy.
 *
 * Người dùng đóng drawer hoặc lần sang thư mục khác giữa chừng thì mọi tiến trình
 * `du` của lượt cũ phải chết theo — nếu không, quét vài thư mục lớn là để lại một
 * đống tiến trình đang cày đĩa mà không ai đọc kết quả.
 */
export function cancelTreeScan(scanId: string): void {
  const running = activeScans.get(scanId)
  if (!running) return
  activeScans.delete(scanId)
  for (const child of running) child.kill('SIGTERM')
  running.clear()
}
