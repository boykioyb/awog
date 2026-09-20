// Đọc bảng tiến trình của HỆ ĐIỀU HÀNH bằng `ps` — zero dependency.
//
// Vì sao `ps` chứ không phải một thư viện: AWOG cấm thêm dep khi chưa có ADR
// (CLAUDE.md §Quy tắc làm việc), và thứ duy nhất cần ở đây — pid/ppid/CPU tích
// luỹ/RSS/dòng lệnh — `ps` trả đủ trên cả macOS lẫn Linux với CÙNG một bộ cờ.
//
// ⚠ Cột `%CPU` của `ps` KHÔNG dùng được cho màn giám sát: trên BSD/macOS nó là
// trung bình suy giảm tính từ lúc tiến trình sinh ra, nên một tiến trình vừa
// ngốn 100% trong 3 giây mà đã sống 10 tiếng vẫn hiện ~0%. Ta lấy `time` (CPU
// TÍCH LUỸ) rồi tự lấy hiệu giữa hai lần đo — đúng cách Activity Monitor làm.
// Xem sampler.ts.
//
// BẢO MẬT: chỉ ĐỌC. Dòng lệnh có thể chứa đường dẫn/uuid phiên nên được lọc +
// cắt ở lớp classify trước khi lên UI; biến môi trường KHÔNG bao giờ đọc (và
// macOS cũng không cho — `ps -E` trên tiến trình con vẫn trả rỗng, đã đo).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { log } from '../util/logger.js'

const exec = promisify(execFile)

// Trần an toàn cho output của `ps`: máy nhiều tiến trình + dòng lệnh dài (CLI của
// claude dài hơn 400 ký tự) vẫn thừa sức nằm dưới ngưỡng này.
const PS_MAX_BUFFER = 8 * 1024 * 1024
const PS_TIMEOUT_MS = 5_000

export interface PsRow {
  pid: number
  ppid: number
  /** CPU tích luỹ tính bằng giây kể từ lúc tiến trình sinh ra. */
  cpuSeconds: number
  /** Bộ nhớ thường trú (resident set size) tính bằng KiB. */
  rssKb: number
  /** Số giây tiến trình đã sống — dùng để phát hiện pid bị tái sử dụng. */
  elapsedSeconds: number
  /** Dòng lệnh đầy đủ, chưa lọc. */
  command: string
}

// `ps` in thời lượng theo [[dd-]hh:]mm:ss[.cc]. Trả về giây (số thực).
export function parseDuration(raw: string): number {
  const text = raw.trim()
  if (!text) return 0
  const [dayPart, clockPart] = text.includes('-') ? text.split('-', 2) : [null, text]
  const days = dayPart === null ? 0 : Number(dayPart)
  const parts = (clockPart ?? '').split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return 0
  let seconds = 0
  for (const part of parts) seconds = seconds * 60 + part
  return (Number.isFinite(days) ? days : 0) * 86_400 + seconds
}

/**
 * Bộ cờ `ps` dùng chung cho MÁY NÀY và cho máy ở đầu kia SSH.
 *
 * `=` sau mỗi cột = bỏ dòng tiêu đề, nên không phải đoán vị trí header. Cùng một
 * chuỗi chạy được trên macOS lẫn Linux — đó là lý do phần đọc từ xa không cần
 * một bộ parser thứ hai.
 */
export const PS_ARGS = ['-Ao', 'pid=,ppid=,rss=,time=,etime=,args='] as const

/** Lệnh `ps` dạng chuỗi, cho đường SSH (chạy qua shell của máy từ xa). */
export const PS_COMMAND = `ps ${PS_ARGS.join(' ')}`

// Một dòng `ps`: 5 cột số/thời lượng cố định rồi PHẦN CÒN LẠI là dòng lệnh (bản
// thân dòng lệnh chứa khoảng trắng nên không thể split đều).
function parseRow(line: string): PsRow | null {
  const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line)
  if (!m) return null
  const [, pid, ppid, rss, time, etime, command] = m
  return {
    pid: Number(pid),
    ppid: Number(ppid),
    rssKb: Number(rss),
    cpuSeconds: parseDuration(time ?? ''),
    elapsedSeconds: parseDuration(etime ?? ''),
    command: command ?? '',
  }
}

/**
 * Chụp toàn bộ bảng tiến trình của người dùng hiện tại.
 *
 * Trả mảng rỗng (không ném) khi `ps` không có/không chạy được — màn giám sát
 * phải xuống thang tử tế chứ không được làm hỏng cả trang.
 */
export async function listProcesses(): Promise<PsRow[]> {
  if (process.platform === 'win32') return []
  try {
    // `=` sau mỗi cột = bỏ dòng tiêu đề, nên không phải đoán vị trí header.
    const { stdout } = await exec('ps', [...PS_ARGS], {
      maxBuffer: PS_MAX_BUFFER,
      timeout: PS_TIMEOUT_MS,
    })
    return parsePsOutput(stdout)
  } catch (err) {
    log.warn('monitor: ps failed', { message: err instanceof Error ? err.message : String(err) })
    return []
  }
}

/** Tách output `ps` thành hàng. Dùng chung cho máy này và cho máy từ xa qua SSH. */
export function parsePsOutput(stdout: string): PsRow[] {
  const rows: PsRow[] = []
  for (const line of stdout.split('\n')) {
    const row = parseRow(line)
    if (row) rows.push(row)
  }
  return rows
}
