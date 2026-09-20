// Biến CPU TÍCH LUỸ thành CPU TỨC THỜI bằng hiệu giữa hai lần chụp.
//
// Trạng thái duy nhất của module là bản chụp trước đó. Lần gọi ĐẦU TIÊN không có
// gì để trừ nên mọi tiến trình trả `cpuPercent = null` — UI hiện "—" thay vì một
// con số bịa. Đây là lý do trang giám sát phải poll: một phát chụp đơn lẻ về
// nguyên tắc KHÔNG nói được tiến trình đang bận hay đang ngủ.
//
// Quy ước %: 100% = một lõi chạy hết công suất (giống `top` và Activity Monitor
// của macOS), nên trên máy 10 lõi tổng có thể lên tới 1000%. `coreCount` đi kèm
// bản chụp để UI muốn quy ra "% toàn máy" thì tự chia.

import { cpus, totalmem } from 'node:os'
import { listProcesses, type PsRow } from './process-table.js'
import { readGpuClientTimes, type GpuClientTimes } from './gpu.js'
import { resetSystemSampler } from './system.js'

export interface SampledProcess extends PsRow {
  /** % một lõi. `null` ở lần chụp đầu, hoặc khi pid vừa bị tái sử dụng. */
  cpuPercent: number | null
  /**
   * % GPU của riêng tiến trình này. Cùng phép tính với CPU (hiệu thời gian tích
   * luỹ / thời gian trôi), nguồn là `accumulatedGPUTime` trong IORegistry.
   * `null` = nhịp đầu, hoặc nền tảng không cho đọc, hoặc tiến trình không đụng GPU.
   */
  gpuPercent: number | null
}

export interface Sample {
  at: number
  coreCount: number
  /** RAM vật lý của máy được đo, KiB. Ngưỡng màu suy từ đây chứ không từ số chọn bừa. */
  totalMemKb: number
  processes: SampledProcess[]
}

interface Previous {
  cpuSeconds: number
  /** Thời gian GPU tích luỹ (ns) ở nhịp trước; 0 khi không đo được. */
  gpuNs: number
  /** Mốc sinh của tiến trình (ms epoch, xấp xỉ) — chốt chặn pid tái sử dụng. */
  startedAtMs: number
}

/**
 * Bản chụp trước, KEY THEO NGUỒN.
 *
 * Một `Map` duy nhất là sai ngay khi có nhiều nguồn: pid trên máy này và pid trên
 * máy ở đầu kia SSH trùng nhau như chơi, và trừ CPU tích luỹ của hai tiến trình
 * khác máy cho nhau thì ra một con số vô nghĩa. Khoá: `'local'` hoặc `ssh:<connId>`.
 */
const previousBySource = new Map<string, { rows: Map<number, Previous>; at: number }>()

export const LOCAL_SOURCE = 'local'

// pid trên Unix quay vòng: một pid vừa chết có thể được cấp lại cho tiến trình
// khác trước lần chụp sau. Nếu cứ trừ thẳng thì "CPU tích luỹ" của tiến trình
// mới (nhỏ) trừ của tiến trình cũ (lớn) ra số âm, hoặc tệ hơn là ra một mức
// tăng vọt vô nghĩa. Mốc sinh lệch quá ngưỡng ⇒ coi như tiến trình khác.
const START_DRIFT_TOLERANCE_MS = 2_000

/** Biến hàng `ps` THÔ của một nguồn thành mẫu có CPU tức thời. */
export function sampleRows(
  source: string,
  rows: PsRow[],
  coreCount: number,
  totalMemKb: number,
  gpuTimes: GpuClientTimes = new Map(),
): Sample {
  const at = Date.now()
  const prevEntry = previousBySource.get(source)
  const elapsedMs = prevEntry === undefined ? 0 : at - prevEntry.at
  const next = new Map<number, Previous>()
  const processes: SampledProcess[] = []

  const haveGpu = gpuTimes.size > 0
  for (const row of rows) {
    const startedAtMs = at - row.elapsedSeconds * 1000
    const gpuNs = gpuTimes.get(row.pid) ?? 0
    next.set(row.pid, { cpuSeconds: row.cpuSeconds, gpuNs, startedAtMs })

    const prev = prevEntry?.rows.get(row.pid)
    const sameProcess =
      prev !== undefined && Math.abs(prev.startedAtMs - startedAtMs) <= START_DRIFT_TOLERANCE_MS
    const cpuPercent =
      sameProcess && elapsedMs > 0
        ? Math.max(0, ((row.cpuSeconds - prev.cpuSeconds) * 1000 * 100) / elapsedMs)
        : null
    // ns / ms → nhân 100 cho phần trăm, chia 1e6 để đưa ms về ns.
    const gpuPercent =
      haveGpu && sameProcess && elapsedMs > 0
        ? Math.max(0, ((gpuNs - prev.gpuNs) * 100) / (elapsedMs * 1e6))
        : null

    processes.push({ ...row, cpuPercent, gpuPercent })
  }

  previousBySource.set(source, { rows: next, at })
  return { at, coreCount, totalMemKb, processes }
}

/** Một nhịp đo của MÁY NÀY. */
export async function sample(): Promise<Sample> {
  const [rows, gpuTimes] = await Promise.all([listProcesses(), readGpuClientTimes()])
  return sampleRows(
    LOCAL_SOURCE,
    rows,
    cpus().length || 1,
    Math.round(totalmem() / 1024),
    gpuTimes,
  )
}

// Quên bản chụp trước — dùng khi UI rời trang giám sát rồi quay lại sau một lúc
// lâu, hoặc khi đổi nguồn: hiệu CPU trên một khoảng nghỉ dài là trung bình của cả
// khoảng đó, không phải "bây giờ", nên thà bỏ một nhịp còn hơn hiện số sai.
export function resetSampler(source?: string): void {
  if (source === undefined) {
    previousBySource.clear()
    resetSystemSampler()
  } else previousBySource.delete(source)
}
