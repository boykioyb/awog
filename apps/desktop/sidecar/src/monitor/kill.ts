// Dừng một tiến trình từ màn giám sát.
//
// BẢO MẬT: pid do UI gửi lên là dữ liệu L1 và pid bị tái sử dụng liên tục, nên
// KHÔNG bao giờ được `process.kill` thẳng cái UI đưa. Mỗi lần gọi đều chụp lại
// bảng tiến trình và tự kiểm: pid đó lúc NÀY có còn là tiến trình của AWOG
// không, và nó có thuộc diện được phép giết không. Một ảnh chụp cũ 2 giây trên
// UI là quá đủ để pid đã đổi chủ.
//
// Chính sách (nới sau khi người dùng bổ sung phạm vi toàn máy):
//   ✅ Mọi tiến trình mà HỆ ĐIỀU HÀNH cho phép người dùng này giết — kể cả tiến
//      trình không thuộc AWOG. Đây là máy của họ; công cụ giám sát mà phải mở
//      Activity Monitor của macOS để giết thì không giải quyết việc gì.
//   ❌ Hạ tầng của CHÍNH instance đang chạy (Electron main, sidecar, renderer,
//      GPU, utility) — giết là tự bắn vào chân, người dùng có nút Thoát app.
//   ❌ pid ≤ 1 (`launchd`/`init`) — không có ca dùng hợp lệ nào.
//   Phần còn lại để hệ điều hành phán: tiến trình của người dùng khác trả EPERM
//   và lỗi đó được đưa thẳng lên UI thay vì bị nuốt.
//
// Tiến trình trên máy TỪ XA đi qua `killRemote` (SSH), không qua `process.kill`.

import { listProcesses } from './process-table.js'
import { classify, type ProcessKind } from './classify.js'
import { isAwogProcess } from './identity.js'
import { log } from '../util/logger.js'
import { RpcError } from '../transport/rpc.js'
import { killRemote } from './remote.js'

// Hạ tầng của instance đang chạy — không cho giết.
const PROTECTED: ReadonlySet<ProcessKind> = new Set<ProcessKind>([
  'electron-main',
  'electron-renderer',
  'electron-gpu',
  'electron-utility',
  'sidecar',
])

export interface KillResult {
  pid: number
  signal: 'SIGTERM' | 'SIGKILL'
}

export async function killProcess(
  pid: number,
  force: boolean,
  connId?: string,
): Promise<KillResult> {
  // Máy từ xa: không có cây AWOG nào để bảo vệ ở đó, và `process.kill` của
  // sidecar sẽ nhắm vào MÁY NÀY — đúng loại nhầm lẫn phải chặn từ đầu hàm.
  if (connId) {
    await killRemote(connId, pid, force)
    return { pid, signal: force ? 'SIGKILL' : 'SIGTERM' }
  }
  if (!Number.isInteger(pid) || pid <= 1) throw new RpcError(-32602, 'Invalid pid')
  if (pid === process.pid || pid === process.ppid) {
    throw new RpcError(-32602, 'Refusing to kill the app itself')
  }

  const rows = await listProcesses()
  const row = rows.find((r) => r.pid === pid)
  if (!row) throw new RpcError(-32602, `Process ${pid} is gone`)

  // Cây của instance hiện tại — để biết pid này là "của ta" hay là mồ côi.
  const childrenOf = new Map<number, number[]>()
  for (const r of rows) {
    const list = childrenOf.get(r.ppid)
    if (list) list.push(r.pid)
    else childrenOf.set(r.ppid, [r.pid])
  }
  const root = process.ppid > 1 ? process.ppid : process.pid
  const ours = new Set<number>()
  const stack = [root]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (cur === undefined || ours.has(cur)) continue
    ours.add(cur)
    for (const c of childrenOf.get(cur) ?? []) stack.push(c)
  }

  const inOurTree = ours.has(pid)
  const kind = classify(row.command).kind
  if (inOurTree && PROTECTED.has(kind)) {
    throw new RpcError(-32602, `Refusing to kill AWOG's own ${kind}`)
  }

  const signal = force ? 'SIGKILL' : 'SIGTERM'
  try {
    process.kill(pid, signal)
  } catch (err) {
    throw new RpcError(-32603, err instanceof Error ? err.message : String(err))
  }
  log.info('monitor: killed process', {
    pid,
    signal,
    kind,
    awog: inOurTree || isAwogProcess(row.command),
  })
  return { pid, signal }
}
