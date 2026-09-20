// Đọc bảng tiến trình của máy ở ĐẦU KIA một kết nối SSH.
//
// Không có gì mới về cách đo: cùng bộ cờ `ps`, cùng parser, cùng cách lấy hiệu
// CPU giữa hai nhịp (sampler key theo nguồn nên pid của hai máy không trộn vào
// nhau). Khác duy nhất là đường truyền.
//
// CỐ Ý CHỈ DÙNG KẾT NỐI ĐANG MỞ. Module này không tự `connect`: một trang giám
// sát mở ra mà âm thầm mở kết nối SSH tới máy chủ của người dùng là hành vi
// vượt quyền. Người dùng kết nối ở trang SSH; ở đây chỉ chọn trong các kết nối
// đang sống.
//
// BẢO MẬT: lệnh gửi đi là HẰNG (`PS_COMMAND`) — không ghép chuỗi từ input nào.
// Lệnh dừng tiến trình ghép đúng một số nguyên đã kiểm (xem `killRemote`).

import { sshManager } from '../ssh/manager.js'
import { PS_COMMAND, parsePsOutput, type PsRow } from './process-table.js'
import { RpcError } from '../transport/rpc.js'

/** Khoá nguồn cho sampler — pid của máy từ xa không được trộn với pid máy này. */
export function remoteSource(connId: string): string {
  return `ssh:${connId}`
}

export interface RemoteTable {
  rows: PsRow[]
  coreCount: number
  totalMemKb: number
}

export async function listRemoteProcesses(connId: string): Promise<RemoteTable> {
  const res = await sshManager.exec(connId, PS_COMMAND)
  if (res.code !== 0) {
    const detail = res.stderr.trim().slice(0, 200) || `exit ${res.code}`
    throw new RpcError(-32603, `ps failed on remote host: ${detail}`)
  }
  return { rows: parsePsOutput(res.stdout), ...(await remoteCapacity(connId)) }
}

/**
 * Dung lượng của máy từ xa: số lõi + RAM vật lý. Ngưỡng màu của UI suy từ hai số
 * này, nên không có chúng thì "đỏ" chỉ là một con số đoán.
 *
 * Hỏi MỘT lần cho mỗi kết nối (chúng không đổi trong đời một phiên SSH) và trong
 * MỘT lệnh (mỗi lần hỏi là một channel SSH). Linux in KiB ở /proc/meminfo, macOS
 * in BYTE ở hw.memsize — nên mỗi nhánh tự dán đơn vị vào, đoán đơn vị theo độ lớn
 * là cách chắc chắn sai trên một máy 4 GB.
 */
const capacityCache = new Map<string, { coreCount: number; totalMemKb: number }>()

const CAPACITY_COMMAND = [
  '(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)',
  "(awk '/MemTotal/{print $2\"kB\"; exit}' /proc/meminfo 2>/dev/null",
  '|| echo "$(sysctl -n hw.memsize 2>/dev/null)B")',
].join(' ; ')

function parseMem(raw: string): number {
  const text = raw.trim()
  const n = Number(text.replace(/[kKbB]+$/, ''))
  if (!Number.isFinite(n) || n <= 0) return 0
  return /kB$/i.test(text) ? Math.round(n) : Math.round(n / 1024)
}

async function remoteCapacity(connId: string): Promise<{ coreCount: number; totalMemKb: number }> {
  const cached = capacityCache.get(connId)
  if (cached !== undefined) return cached
  try {
    const res = await sshManager.exec(connId, CAPACITY_COMMAND)
    const [coreLine = '', memLine = ''] = res.stdout.trim().split('\n')
    const cores = Number(coreLine.trim())
    const out = {
      coreCount: Number.isFinite(cores) && cores > 0 ? Math.floor(cores) : 1,
      totalMemKb: parseMem(memLine),
    }
    capacityCache.set(connId, out)
    return out
  } catch {
    return { coreCount: 1, totalMemKb: 0 }
  }
}

export function forgetRemote(connId: string): void {
  capacityCache.delete(connId)
}

/**
 * Dừng một tiến trình trên máy từ xa.
 *
 * `pid` đã được kiểm là số nguyên > 1 ở lớp gọi VÀ được nội suy vào chuỗi dưới
 * dạng số, nên không có đường nào để một chuỗi tuỳ ý lọt vào shell của máy chủ.
 */
export async function killRemote(connId: string, pid: number, force: boolean): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 1) throw new RpcError(-32602, 'Invalid pid')
  const signal = force ? 'KILL' : 'TERM'
  const res = await sshManager.exec(connId, `kill -${signal} ${pid}`)
  if (res.code !== 0) {
    const detail = res.stderr.trim().slice(0, 200) || `exit ${res.code}`
    throw new RpcError(-32603, detail)
  }
}
