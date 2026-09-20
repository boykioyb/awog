// GPU: hai số liệu khác nhau, đừng lẫn.
//
//   1. TOÀN MÁY — `Device Utilization %` của driver trong IORegistry. Một lát cắt
//      tức thời của cả GPU.
//   2. THEO TIẾN TRÌNH — `accumulatedGPUTime` trong `AppUsage` của mỗi
//      `AGXDeviceUserClient`, kèm `IOUserClientCreator` = "pid N, tên". Đây đúng
//      là thứ tương đương `ps -o time` nhưng cho GPU: thời gian GPU TÍCH LUỸ tính
//      bằng nanosecond, nên lấy hiệu giữa hai nhịp là ra % tức thời — y hệt cách
//      tính CPU (xem sampler.ts).
//
// ⚠ Ghi lại cho lần sau: bản đầu của tính năng này khẳng định "GPU theo tiến trình
// đòi `powermetrics`, tức quyền root, nên không làm được". SAI. Đo trên máy thật:
// `ioreg -r -c IOAccelerator -l -w 0` chạy với quyền người dùng thường trả về 70
// client kèm pid trong 17ms / 67 KB. Chỉ `powermetrics` mới cần root, còn
// IORegistry thì không.
//
// Chỉ có trên macOS. Linux/Windows: `null`, cột GPU tự ẩn.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const TIMEOUT_MS = 3_000

export interface GpuStats {
  /** % sử dụng GPU của CẢ MÁY. `null` khi nền tảng không cho đọc. */
  utilizationPercent: number | null
  /** Bộ nhớ GPU đang dùng (MiB), toàn máy. */
  memoryUsedMb: number | null
  /** Nguồn số liệu, để UI ghi chú trung thực. */
  source: 'ioreg' | 'nvidia-smi' | null
}

const UNAVAILABLE: GpuStats = { utilizationPercent: null, memoryUsedMb: null, source: null }

async function macos(): Promise<GpuStats> {
  const { stdout } = await exec('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], {
    timeout: TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  })
  const util = /"Device Utilization %"=(\d+)/.exec(stdout)?.[1]
  const mem = /"In use system memory"=(\d+)/.exec(stdout)?.[1]
  if (util === undefined) return UNAVAILABLE
  return {
    utilizationPercent: Number(util),
    memoryUsedMb: mem === undefined ? null : Math.round(Number(mem) / (1024 * 1024)),
    source: 'ioreg',
  }
}

async function linux(): Promise<GpuStats> {
  const { stdout } = await exec(
    'nvidia-smi',
    ['--query-gpu=utilization.gpu,memory.used', '--format=csv,noheader,nounits'],
    { timeout: TIMEOUT_MS },
  )
  const [util, mem] = (stdout.split('\n')[0] ?? '').split(',').map((s) => Number(s.trim()))
  if (!Number.isFinite(util)) return UNAVAILABLE
  return {
    utilizationPercent: util,
    memoryUsedMb: Number.isFinite(mem) ? (mem as number) : null,
    source: 'nvidia-smi',
  }
}

export async function readGpuStats(): Promise<GpuStats> {
  try {
    if (process.platform === 'darwin') return await macos()
    if (process.platform === 'linux') return await linux()
    return UNAVAILABLE
  } catch {
    // Không có GPU rời, không có `nvidia-smi`, hoặc IORegistry đổi khoá — đều là
    // "không đo được", không phải lỗi cần ném lên UI.
    return UNAVAILABLE
  }
}


/** pid → thời gian GPU tích luỹ (nanosecond). Rỗng khi nền tảng không cho đọc. */
export type GpuClientTimes = Map<number, number>

// Cây IORegistry: mỗi client là một khối `+-o …UserClient` chứa `AppUsage` (có thể
// nhiều mục, mỗi mục một `accumulatedGPUTime`) và `IOUserClientCreator`. Gom theo
// KHỐI chứ không theo thứ tự dòng: một pid có nhiều client, và không có gì bảo đảm
// hai khoá luôn xuất hiện cùng một thứ tự.
export async function readGpuClientTimes(): Promise<GpuClientTimes> {
  const times: GpuClientTimes = new Map()
  if (process.platform !== 'darwin') return times
  let stdout: string
  try {
    const res = await exec('ioreg', ['-r', '-c', 'IOAccelerator', '-l', '-w', '0'], {
      timeout: TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    })
    stdout = res.stdout
  } catch {
    return times
  }

  let pid: number | null = null
  let ns = 0
  const flush = (): void => {
    if (pid !== null && ns > 0) times.set(pid, (times.get(pid) ?? 0) + ns)
    pid = null
    ns = 0
  }

  for (const line of stdout.split('\n')) {
    if (line.includes('+-o ')) flush()
    const usage = /"AppUsage" = \((.*)\)\s*$/.exec(line)
    if (usage?.[1]) {
      for (const m of usage[1].matchAll(/"accumulatedGPUTime"=(\d+)/g)) ns += Number(m[1])
      continue
    }
    const creator = /"IOUserClientCreator" = "pid (\d+),/.exec(line)
    if (creator?.[1]) pid = Number(creator[1])
  }
  flush()
  return times
}
