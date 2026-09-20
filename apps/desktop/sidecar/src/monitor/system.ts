// Số liệu của CẢ MÁY: từng lõi CPU, load average, RAM thật, swap.
//
// VÌ SAO CẦN, dù đã có bảng tiến trình: cộng RSS của mọi tiến trình KHÔNG phải là
// "RAM đang dùng" — bộ nhớ dùng chung bị cộng nhiều lần, và phần nén/wired của
// nhân không thuộc tiến trình nào. Đo trên máy thật: tổng RSS ra 9.9 GB trong khi
// máy 16 GB đang dùng 15.9 GB và đã phải swap 10.9 GB. Con số đầu làm người dùng
// yên tâm nhầm.
//
// Per-core KHÔNG cần native module: `os.cpus()` của Node gọi `host_processor_info`
// trên macOS và đọc /proc/stat trên Linux, trả về thời gian TÍCH LUỸ của từng lõi
// — lấy hiệu giữa hai nhịp là ra %, đúng cách làm với CPU tiến trình và GPU.
// (`kern.cp_times` không tồn tại trên macOS, và `powermetrics` đòi root — đã thử.)
//
// Nhiệt độ và điện năng (thứ `macmon` hiển thị) thì KHÔNG lấy được đường này:
// chúng nằm sau IOReport, cần native code. Cố ý không đoán chúng.

import { execFile } from 'node:child_process'
import { cpus, loadavg, totalmem } from 'node:os'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const TIMEOUT_MS = 3_000

export interface SystemStats {
  /** % bận của từng lõi, cùng thứ tự `os.cpus()`. Rỗng ở nhịp đầu. */
  cores: number[]
  /** % bận trung bình của cả máy (0..100). `null` ở nhịp đầu. */
  cpuPercent: number | null
  /** Load average 1/5/15 phút. */
  loadAvg: [number, number, number]
  /**
   * Bộ nhớ ĐANG BỊ CHIẾM THẬT, theo cách Activity Monitor tính:
   * App (anonymous − purgeable) + Wired + phần nén.
   *
   * ⚠ CỐ Ý KHÔNG dùng `total − free`. Bản đầu dùng công thức đó (khớp `top`) và
   * kết quả là **99% trên mọi máy Mac chạy được vài tiếng**, vì nó tính cả trang
   * `inactive` — vốn phần lớn là file cache macOS thu hồi tức thì. Một vạch lúc
   * nào cũng đỏ thì không mang thông tin gì.
   */
  memUsedKb: number
  /** File cache thu hồi được — hiện thành đoạn nhạt trên vạch, không tính là "đã dùng". */
  memCachedKb: number
  memTotalKb: number
  /**
   * Swap ĐANG DÙNG. `swapTotalKb` cố ý KHÔNG được hiểu là trần: macOS tự nới
   * swapfile khi cần, nên "11.4/12.0 GB" không phải "sắp hết swap" mà chỉ là
   * "swapfile hiện lớn ngần ấy". Tỷ lệ used/total ở đây là số vô nghĩa.
   */
  swapUsedKb: number
  swapTotalKb: number
  /**
   * Áp lực bộ nhớ do CHÍNH nhân báo — tín hiệu sức khoẻ thật, và là thứ quyết
   * định màu. `null` khi nền tảng không cung cấp.
   */
  pressure: 'normal' | 'warn' | 'critical' | null
}

type CoreTimes = { idle: number; total: number }

type MemoryStats = Pick<
  SystemStats,
  'memUsedKb' | 'memCachedKb' | 'memTotalKb' | 'swapUsedKb' | 'swapTotalKb' | 'pressure'
>

let previousCores: CoreTimes[] | null = null

function snapshotCores(): CoreTimes[] {
  return cpus().map((c) => {
    const t = c.times
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq }
  })
}

export function resetSystemSampler(): void {
  previousCores = null
}

function coreUtilization(): { cores: number[]; cpuPercent: number | null } {
  const now = snapshotCores()
  const prev = previousCores
  previousCores = now
  // Nhịp đầu, hoặc số lõi đổi (máy ảo thêm/bớt vCPU): không có gì để trừ.
  if (!prev || prev.length !== now.length) return { cores: [], cpuPercent: null }

  const cores = now.map((t, i) => {
    const p = prev[i]
    if (!p) return 0
    const total = t.total - p.total
    if (total <= 0) return 0
    return Math.min(100, Math.max(0, (1 - (t.idle - p.idle) / total) * 100))
  })
  const avg = cores.reduce((s, x) => s + x, 0) / (cores.length || 1)
  return { cores, cpuPercent: avg }
}

// macOS: `vm_stat` cho trang, `sysctl vm.swapusage` cho swap.
//
// "Đang dùng" = tổng − (free + speculative). Công thức này khớp CHÍNH XÁC con số
// `top` in ra (đã đối chiếu: wired 3240M khớp từng MiB) — khác hẳn cách cộng
// active+wired+compressor, vốn bỏ sót phần inactive mà macOS vẫn tính là đã dùng.
async function macosMemory(): Promise<MemoryStats> {
  const totalKb = Math.round(totalmem() / 1024)
  const empty: MemoryStats = {
    memUsedKb: 0,
    memCachedKb: 0,
    memTotalKb: totalKb,
    swapUsedKb: 0,
    swapTotalKb: 0,
    pressure: null,
  }
  let usedKb = 0
  let cachedKb = 0
  try {
    const { stdout } = await exec('vm_stat', [], { timeout: TIMEOUT_MS })
    const pageSize = Number(/page size of (\d+) bytes/.exec(stdout)?.[1] ?? 4096)
    const pages = (label: string): number =>
      Number(new RegExp(`${label}:\\s+(\\d+)`).exec(stdout)?.[1] ?? 0)
    const toKb = (n: number): number => Math.round((n * pageSize) / 1024)

    // App + Wired + phần nén — đúng định nghĩa "Memory Used" của Activity Monitor,
    // tức con số người dùng đối chiếu được bằng công cụ của chính hệ điều hành.
    const app = Math.max(0, pages('Anonymous pages') - pages('Pages purgeable'))
    usedKb = Math.min(totalKb, toKb(app + pages('Pages wired down') + pages('Pages occupied by compressor')))
    const freeKb = toKb(pages('Pages free') + pages('Pages speculative'))
    cachedKb = Math.max(0, totalKb - usedKb - freeKb)
  } catch {
    return empty
  }

  let swapUsedKb = 0
  let swapTotalKb = 0
  try {
    const { stdout } = await exec('sysctl', ['-n', 'vm.swapusage'], { timeout: TIMEOUT_MS })
    // "total = 12288.00M  used = 10978.06M  free = 1309.94M"
    const mb = (label: string): number =>
      Number(new RegExp(`${label} = ([\\d.]+)M`).exec(stdout)?.[1] ?? 0) * 1024
    swapTotalKb = Math.round(mb('total'))
    swapUsedKb = Math.round(mb('used'))
  } catch {
    // Máy không bật swap là chuyện bình thường.
  }

  return { memUsedKb: usedKb, memCachedKb: cachedKb, memTotalKb: totalKb, swapUsedKb, swapTotalKb, pressure: await macosPressure() }
}

/**
 * `kern.memorystatus_vm_pressure_level`: 1 = bình thường, 2 = cảnh báo, 4 = nguy cấp.
 * Đây là phán quyết của CHÍNH nhân — thứ nó dùng để quyết định nén và swap — nên
 * nó nói đúng "máy có đang ngạt không", điều mà một tỷ lệ phần trăm không nói được.
 */
async function macosPressure(): Promise<SystemStats['pressure']> {
  try {
    const { stdout } = await exec('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], {
      timeout: TIMEOUT_MS,
    })
    const n = Number(stdout.trim())
    if (n >= 4) return 'critical'
    if (n === 2) return 'warn'
    if (n === 1) return 'normal'
    return null
  } catch {
    return null
  }
}

// Linux: /proc/meminfo. `MemAvailable` là ước lượng của chính nhân về phần còn
// cấp phát được (đã trừ cache thu hồi được) — nên `MemTotal − MemAvailable` vốn
// đã là "dùng thật", không dính bẫy đếm-cả-cache như công thức macOS cũ.
async function linuxMemory(): Promise<MemoryStats> {
  const fallback = Math.round(totalmem() / 1024)
  try {
    const text = await readFile('/proc/meminfo', 'utf8')
    const kb = (label: string): number =>
      Number(new RegExp(`^${label}:\\s+(\\d+) kB`, 'm').exec(text)?.[1] ?? 0)
    const total = kb('MemTotal')
    const available = kb('MemAvailable')
    const swapTotal = kb('SwapTotal')
    return {
      memTotalKb: total,
      memUsedKb: Math.max(0, total - available),
      memCachedKb: kb('Cached') + kb('Buffers'),
      swapTotalKb: swapTotal,
      swapUsedKb: Math.max(0, swapTotal - kb('SwapFree')),
      pressure: null,
    }
  } catch {
    return {
      memUsedKb: 0,
      memCachedKb: 0,
      memTotalKb: fallback,
      swapUsedKb: 0,
      swapTotalKb: 0,
      pressure: null,
    }
  }
}

export async function readSystemStats(): Promise<SystemStats> {
  const [avg1 = 0, avg5 = 0, avg15 = 0] = loadavg()
  const memory =
    process.platform === 'darwin'
      ? await macosMemory()
      : process.platform === 'linux'
        ? await linuxMemory()
        : {
          memUsedKb: 0,
          memCachedKb: 0,
          memTotalKb: Math.round(totalmem() / 1024),
          swapUsedKb: 0,
          swapTotalKb: 0,
          pressure: null,
        }

  return { ...coreUtilization(), loadAvg: [avg1, avg5, avg15], ...memory }
}
