// Gộp bản chụp tiến trình thành thứ người dùng hỏi: "phiên nào, tiến trình nào
// đang ăn máy của tôi".
//
// Ba tầng, theo đúng thứ tự tin cậy giảm dần:
//   1. SỔ ĐĂNG KÝ (`owned.ts`) — nơi spawn tự khai. Chính xác tuyệt đối.
//   2. DÒNG LỆNH (`classify.ts`) — `--resume=<uuid>` của CLI claude tra thẳng ra
//      `Session.sdkSessionId`. Cũng là tra bảng, không suy đoán.
//   3. QUAN HỆ CHA-CON — tiến trình không tự khai thì thuộc về chủ của tổ tiên
//      gần nhất đã xác định. Đây là cách một `rg`/`tsc` do model gọi rơi đúng vào
//      phiên đã sinh ra nó.
// Không tầng nào khớp ⇒ nằm ở nhóm hạ tầng của app, KHÔNG gán bừa vào một phiên.
//
// ⚠ Giới hạn có thật, UI phải nói ra chứ không được lấp liếm: chỉ nhánh Claude SDK
// mới có tiến trình RIÊNG cho từng phiên. Nhánh Pi chạy NGAY TRONG sidecar (một
// tiến trình dùng chung cho mọi phiên) và nhánh Codex dùng CHUNG một daemon cho
// mỗi account — CPU của hai nhánh đó về nguyên tắc không tách được theo phiên ở
// tầng hệ điều hành. Ta đánh dấu `attribution` để UI hiển thị trung thực.

import { sample, sampleRows, type SampledProcess } from './sampler.js'
import { listRemoteProcesses, remoteSource } from './remote.js'
import { appNameOf, classify, safeCommand, type ProcessKind } from './classify.js'
import { listOwnedProcesses, pruneOwnedProcesses, type OwnedKind } from './owned.js'
import { readGpuStats, type GpuStats } from './gpu.js'
import { isAwogProcess } from './identity.js'
import { readSystemStats, type SystemStats } from './system.js'
import { sessionManager } from '../sessions/session-manager.js'
import { activeSessionIds } from '../sessions/runner.js'

export interface MonitorProcess {
  pid: number
  ppid: number
  kind: ProcessKind
  /** Nhãn ngắn ("Claude CLI", "Renderer", "zsh"). */
  label: string
  command: string
  /** % một lõi. `null` ở nhịp đầu (chưa có gì để trừ). */
  cpuPercent: number | null
  /** % GPU của riêng tiến trình này. `null` khi không đo được (xem gpu.ts). */
  gpuPercent: number | null
  rssKb: number
  elapsedSeconds: number
  /** Phiên sở hữu tiến trình này, nếu quy được. */
  sessionId?: string
  /** Vì sao quy được — để UI giải thích thay vì bắt người dùng tin. */
  attribution?: 'registry' | 'sdk-session-id' | 'inherited'
  /** Loại đã khai trong sổ đăng ký, nếu có. */
  ownedKind?: OwnedKind
  model?: string
  /** Tiến trình AWOG KHÔNG thuộc instance đang chạy (tiến trình mồ côi). */
  orphan?: boolean
  /**
   * Thuộc cây của instance AWOG ĐANG CHẠY.
   *
   * UI cần đúng cờ này để biết có được dừng hay không: luật "cấm giết renderer /
   * sidecar" chỉ áp cho hạ tầng CỦA TA. Không có nó, ở phạm vi toàn máy mọi tiến
   * trình Chromium của Chrome/Claude — và cả sidecar AWOG mồ côi — đều mất nút
   * dừng, đúng lỗi người dùng phát hiện.
   */
  own?: boolean
  /** Ứng dụng mà tiến trình thuộc về, để gom nhóm ("Google Chrome", "OrbStack"). */
  app: string
  /** Tổng CPU/RAM của chính nó + toàn bộ con cháu. */
  treeCpuPercent: number | null
  treeRssKb: number
}

export type SessionRuntimeAttribution =
  /** Có tiến trình riêng ⇒ số liệu là của đúng phiên này. */
  | 'own-process'
  /** Chạy trong tiến trình engine dùng chung ⇒ không tách được. */
  | 'in-engine'
  /** Dùng chung daemon với các phiên khác cùng account. */
  | 'shared-daemon'

export interface MonitorSession {
  sessionId: string
  title: string
  running: boolean
  attribution: SessionRuntimeAttribution
  cpuPercent: number | null
  rssKb: number
  pids: number[]
}

/**
 * Phạm vi đo.
 *   'awog'    — chỉ cây tiến trình của AWOG (mặc định, rẻ nhất, ít nhiễu nhất)
 *   'machine' — toàn bộ tiến trình của máy này
 *   'ssh'     — máy ở đầu kia một kết nối SSH đang mở
 */
export type MonitorScope = 'awog' | 'machine' | 'ssh'

export interface SnapshotRequest {
  scope?: MonitorScope
  /** Bắt buộc khi scope = 'ssh'. */
  connId?: string
}

export interface MonitorSnapshot {
  scope: MonitorScope
  /** Kết nối SSH đang xem, khi scope = 'ssh'. */
  connId?: string
  /**
   * Danh sách đã bị CẮT vì máy có quá nhiều tiến trình (xem LIST_CAP). Số tổng ở
   * `totals` vẫn tính trên TẤT CẢ — cắt là chuyện của bảng, không phải của phép cộng.
   */
  truncated?: boolean
  at: number
  coreCount: number
  /** RAM vật lý của máy được đo, KiB. 0 = không đọc được (máy từ xa lạ). */
  totalMemKb: number
  /** Nhịp đầu tiên chưa có hiệu CPU — UI hiện "đang đo…" thay vì số 0. */
  warmingUp: boolean
  gpu: GpuStats
  /**
   * Số liệu của CẢ MÁY đang chạy AWOG: từng lõi, load average, RAM thật, swap.
   * `null` ở phạm vi SSH — đó là máy khác, đo nó cần thêm lệnh riêng.
   */
  system: SystemStats | null
  totals: {
    cpuPercent: number | null
    /** Tổng GPU của ĐÚNG tập tiến trình đang xem. `null` = nền tảng không đo được. */
    gpuPercent: number | null
    rssKb: number
    processCount: number
  }
  processes: MonitorProcess[]
  sessions: MonitorSession[]
  /** Tiến trình AWOG sót lại từ một lần chạy trước — thường là dấu hiệu rò rỉ. */
  orphans: MonitorProcess[]
}

// Cây tiến trình của instance HIỆN TẠI. Gốc là Electron main = cha của sidecar;
// sidecar mồ côi (cha đã chết, bị launchd/init nhận nuôi ⇒ ppid = 1) thì lấy
// chính nó làm gốc, nếu không cả cây sẽ biến mất khỏi màn hình đúng lúc cần nhìn
// nhất.
function rootPid(): number {
  const parent = process.ppid
  return parent > 1 ? parent : process.pid
}

// Bộ đo tự sinh ra tiến trình con để đo: `ps` mỗi nhịp và `ioreg`/`nvidia-smi`
// cho GPU. Chúng có mặt trong CHÍNH bản chụp mà chúng tạo ra, nên không lọc thì
// bảng lúc nào cũng thừa 2 dòng rác. Điều kiện hẹp có chủ ý — phải là con TRỰC
// TIẾP của sidecar và mang đúng tên một trong ba bộ đo; một `ps` do người dùng
// chạy luôn là con của shell chứ không phải của sidecar, nên không bị nuốt.
const PROBE_BINARIES = new Set(['ps', 'ioreg', 'nvidia-smi'])

function isOwnProbe(proc: SampledProcess): boolean {
  if (proc.ppid !== process.pid) return false
  const argv0 = proc.command.split(/\s+/)[0] ?? ''
  // `ps` của macOS bọc tên trong ngoặc — `(ioreg)` — khi tiến trình đã thoát mà
  // chưa được cha thu hồi, hoặc khi không đọc được argv. Bộ đo bắt được chính
  // `ioreg` của mình ở đúng trạng thái đó, nên phải bóc ngoặc trước khi so.
  const name = argv0.slice(argv0.lastIndexOf('/') + 1).replace(/^\(|\)$/g, '')
  return PROBE_BINARIES.has(name)
}

function buildChildren(processes: SampledProcess[]): Map<number, number[]> {
  const children = new Map<number, number[]>()
  for (const p of processes) {
    const list = children.get(p.ppid)
    if (list) list.push(p.pid)
    else children.set(p.ppid, [p.pid])
  }
  return children
}

function collectTree(root: number, children: Map<number, number[]>): Set<number> {
  const seen = new Set<number>()
  const stack = [root]
  while (stack.length > 0) {
    const pid = stack.pop()
    if (pid === undefined || seen.has(pid)) continue
    seen.add(pid)
    for (const child of children.get(pid) ?? []) stack.push(child)
  }
  return seen
}

/**
 * Trần số dòng gửi lên UI khi đo cả máy.
 *
 * Máy thật có ~650 tiến trình, và bảng poll 2 giây một lần. Gửi hết nghĩa là vài
 * trăm KB mỗi nhịp cho những dòng 0% mà không ai đọc. Cắt theo CPU **và** theo
 * RAM rồi hợp lại, vì người dùng sắp xếp được theo cả hai — cắt theo một chiều
 * thì chiều kia thành bảng nói dối.
 */
const LIST_CAP_CPU = 150
const LIST_CAP_MEM = 60

function capList(processes: MonitorProcess[], keep: Set<number>): { rows: MonitorProcess[]; truncated: boolean } {
  if (processes.length <= LIST_CAP_CPU) return { rows: processes, truncated: false }
  const byCpu = [...processes].sort((a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1))
  const byMem = [...processes].sort((a, b) => b.rssKb - a.rssKb)
  const picked = new Map<number, MonitorProcess>()
  for (const p of byCpu.slice(0, LIST_CAP_CPU)) picked.set(p.pid, p)
  for (const p of byMem.slice(0, LIST_CAP_MEM)) picked.set(p.pid, p)
  // Tiến trình của AWOG luôn được giữ: đó là thứ trang này tồn tại để nói về.
  for (const p of processes) if (keep.has(p.pid)) picked.set(p.pid, p)
  return { rows: [...picked.values()], truncated: picked.size < processes.length }
}

/**
 * Bản chụp của máy ở đầu kia một kết nối SSH.
 *
 * Cố ý KHÔNG có: cây AWOG, quy về phiên, tiến trình mồ côi, GPU. Máy đó không
 * chạy AWOG nên mọi khái niệm ấy đều vô nghĩa ở đây; dựng một cây "của ta" trên
 * máy người khác là bịa.
 */
export async function buildRemoteSnapshot(connId: string): Promise<MonitorSnapshot> {
  const { rows, coreCount, totalMemKb } = await listRemoteProcesses(connId)
  const { at, processes: sampled } = sampleRows(
    remoteSource(connId),
    rows,
    coreCount,
    totalMemKb,
  )

  const children = buildChildren(sampled)
  const byPid = new Map(sampled.map((p) => [p.pid, p]))
  const all: MonitorProcess[] = sampled.map((proc) => {
    const info = classify(proc.command)
    let cpu: number | null = null
    let rss = 0
    for (const d of collectTree(proc.pid, children)) {
      const child = byPid.get(d)
      if (!child) continue
      rss += child.rssKb
      if (child.cpuPercent !== null) cpu = (cpu ?? 0) + child.cpuPercent
    }
    return {
      pid: proc.pid,
      ppid: proc.ppid,
      kind: info.kind,
      label: info.label,
      app: appNameOf(proc.command),
      command: safeCommand(proc.command),
      cpuPercent: proc.cpuPercent,
      gpuPercent: null,
      rssKb: proc.rssKb,
      elapsedSeconds: proc.elapsedSeconds,
      treeCpuPercent: cpu,
      treeRssKb: rss,
    }
  })

  const capped = capList(all, new Set())
  return {
    scope: 'ssh',
    connId,
    at,
    coreCount,
    totalMemKb,
    warmingUp: all.every((p) => p.cpuPercent === null),
    gpu: { utilizationPercent: null, memoryUsedMb: null, source: null },
    system: null,
    totals: {
      cpuPercent: all.reduce<number | null>(
        (acc, p) => (p.cpuPercent === null ? acc : (acc ?? 0) + p.cpuPercent),
        null,
      ),
      gpuPercent: null,
      rssKb: all.reduce((acc, p) => acc + p.rssKb, 0),
      processCount: all.length,
    },
    ...(capped.truncated ? { truncated: true } : {}),
    processes: capped.rows.sort((a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)),
    sessions: [],
    orphans: [],
  }
}

export async function buildSnapshot(req: SnapshotRequest = {}): Promise<MonitorSnapshot> {
  if (req.scope === 'ssh') {
    if (!req.connId) throw new Error('connId is required for the ssh scope')
    return buildRemoteSnapshot(req.connId)
  }
  const scope: MonitorScope = req.scope === 'machine' ? 'machine' : 'awog'
  const [{ at, coreCount, totalMemKb, processes: sampledAll }, gpu, system] = await Promise.all([
    sample(),
    readGpuStats(),
    readSystemStats(),
  ])

  const sampled = sampledAll.filter((p) => !isOwnProbe(p))
  const byPid = new Map(sampled.map((p) => [p.pid, p]))
  pruneOwnedProcesses(new Set(byPid.keys()))

  const children = buildChildren(sampled)
  const ours = collectTree(rootPid(), children)

  const ownedByPid = new Map(listOwnedProcesses().map((o) => [o.pid, o]))
  const sdkIndex = sessionManager.getSdkSessionIndex()

  // ── Tầng 1 + 2: chủ sở hữu tự khai / khai qua dòng lệnh ────────────────────
  type Resolved = { sessionId?: string; attribution?: MonitorProcess['attribution'] }
  const resolved = new Map<number, Resolved>()
  const classified = new Map<number, ReturnType<typeof classify>>()

  for (const pid of ours) {
    const proc = byPid.get(pid)
    if (!proc) continue
    const info = classify(proc.command)
    classified.set(pid, info)

    const owned = ownedByPid.get(pid)
    if (owned?.sessionId) {
      resolved.set(pid, { sessionId: owned.sessionId, attribution: 'registry' })
      continue
    }
    if (info.sdkSessionId) {
      const session = sdkIndex.get(info.sdkSessionId)
      if (session) resolved.set(pid, { sessionId: session.id, attribution: 'sdk-session-id' })
    }
  }

  // ── Tầng 3: thừa kế từ tổ tiên gần nhất đã xác định ────────────────────────
  // Đi lên theo ppid, có chặn vòng lặp: ppid về nguyên tắc không tạo chu trình,
  // nhưng bảng tiến trình là ảnh chụp của một hệ thống đang đổi, nên một cây méo
  // do pid tái sử dụng không được phép làm treo vòng lặp này.
  function inherit(pid: number): Resolved | undefined {
    const seen = new Set<number>()
    let cur = byPid.get(pid)?.ppid
    while (cur !== undefined && cur > 1 && !seen.has(cur)) {
      seen.add(cur)
      const hit = resolved.get(cur)
      if (hit?.sessionId) return { sessionId: hit.sessionId, attribution: 'inherited' }
      cur = byPid.get(cur)?.ppid
    }
    return undefined
  }

  for (const pid of ours) {
    if (resolved.has(pid)) continue
    const inherited = inherit(pid)
    if (inherited) resolved.set(pid, inherited)
  }

  // ── Cuộn CPU/RAM theo cây con ──────────────────────────────────────────────
  function rollup(pid: number): { cpu: number | null; rss: number } {
    let cpu: number | null = null
    let rss = 0
    for (const descendant of collectTree(pid, children)) {
      const proc = byPid.get(descendant)
      if (!proc) continue
      rss += proc.rssKb
      if (proc.cpuPercent !== null) cpu = (cpu ?? 0) + proc.cpuPercent
    }
    return { cpu, rss }
  }

  const toMonitorProcess = (proc: SampledProcess, orphan: boolean): MonitorProcess => {
    const info = classified.get(proc.pid) ?? classify(proc.command)
    const own = resolved.get(proc.pid)
    const owned = ownedByPid.get(proc.pid)
    const tree = rollup(proc.pid)
    // Nhãn của tiến trình con Chromium ("GPU", "Renderer") chỉ có nghĩa khi nó là
    // của AWOG. Ở phạm vi toàn máy, Chrome và mọi app Electron khác cũng có tiến
    // trình `--type=gpu-process`, và ba dòng cùng tên "GPU" thì không nói được gì.
    // Với tiến trình KHÔNG thuộc ta, tên file chạy mang nhiều thông tin hơn.
    const inOurTree = ours.has(proc.pid)
    const app = appNameOf(proc.command)
    // Nhãn tiến trình con Chromium ("GPU", "Renderer") chỉ có nghĩa khi nó là của
    // AWOG; ở phạm vi toàn máy, Chrome và mọi app Electron khác cũng có
    // `--type=gpu-process`. Với app khác, ghép TÊN APP vào để ba dòng "Renderer"
    // của ba ứng dụng khác nhau phân biệt được.
    const label =
      owned?.label ??
      (!inOurTree && info.kind.startsWith('electron-') ? `${app} · ${info.label}` : info.label)
    return {
      pid: proc.pid,
      ppid: proc.ppid,
      kind: info.kind,
      label,
      command: safeCommand(proc.command),
      cpuPercent: proc.cpuPercent,
      gpuPercent: proc.gpuPercent,
      rssKb: proc.rssKb,
      elapsedSeconds: proc.elapsedSeconds,
      ...(own?.sessionId ? { sessionId: own.sessionId } : {}),
      ...(own?.attribution ? { attribution: own.attribution } : {}),
      ...(owned ? { ownedKind: owned.kind } : {}),
      ...(info.model ? { model: info.model } : {}),
      ...(orphan ? { orphan: true } : {}),
      ...(inOurTree ? { own: true } : {}),
      app,
      treeCpuPercent: tree.cpu,
      treeRssKb: tree.rss,
    }
  }

  // Phạm vi 'machine' liệt kê MỌI tiến trình của máy; 'awog' chỉ cây của app.
  // Phân loại + quy về phiên vẫn chỉ chạy trên cây AWOG — gán nhãn phiên cho một
  // tiến trình của app khác là bịa.
  const listPids = scope === 'machine' ? sampled.map((p) => p.pid) : [...ours]
  const processes = listPids
    .map((pid) => byPid.get(pid))
    .filter((p): p is SampledProcess => p !== undefined)
    .map((p) => toMonitorProcess(p, false))

  // ── Mồ côi: tiến trình mang dấu vết AWOG nhưng nằm ngoài cây của ta ────────
  const orphans = sampled
    .filter((p) => !ours.has(p.pid) && isAwogProcess(p.command))
    .map((p) => toMonitorProcess(p, true))

  // ── Gộp theo phiên ─────────────────────────────────────────────────────────
  const running = new Set(activeSessionIds())
  const titles = new Map(sessionManager.getSessions().map((s) => [s.id, s.title]))
  const perSession = new Map<string, MonitorSession>()

  for (const proc of processes) {
    if (!proc.sessionId) continue
    const entry = perSession.get(proc.sessionId) ?? {
      sessionId: proc.sessionId,
      title: titles.get(proc.sessionId) ?? proc.sessionId,
      running: running.has(proc.sessionId),
      attribution: 'own-process' as SessionRuntimeAttribution,
      cpuPercent: null,
      rssKb: 0,
      pids: [],
    }
    entry.pids.push(proc.pid)
    entry.rssKb += proc.rssKb
    if (proc.cpuPercent !== null) entry.cpuPercent = (entry.cpuPercent ?? 0) + proc.cpuPercent
    perSession.set(proc.sessionId, entry)
  }

  // Phiên đang chạy mà KHÔNG có tiến trình nào của riêng nó ⇒ nó sống trong
  // engine (nhánh Pi) hoặc trong daemon dùng chung (nhánh Codex). Vẫn phải liệt
  // kê, kèm lý do, chứ bỏ đi thì người dùng tưởng phiên đã dừng.
  for (const sessionId of running) {
    if (perSession.has(sessionId)) continue
    perSession.set(sessionId, {
      sessionId,
      title: titles.get(sessionId) ?? sessionId,
      running: true,
      attribution: 'in-engine',
      cpuPercent: null,
      rssKb: 0,
      pids: [],
    })
  }

  const totalCpu = processes.reduce<number | null>(
    (acc, p) => (p.cpuPercent === null ? acc : (acc ?? 0) + p.cpuPercent),
    null,
  )
  // GPU của ĐÚNG tập đang xem — ở phạm vi 'awog' đây là GPU THẬT SỰ của app, khác
  // hẳn `Device Utilization %` (số của cả máy) vẫn để riêng ở `gpu`.
  const totalGpu = processes.reduce<number | null>(
    (acc, p) => (p.gpuPercent === null ? acc : (acc ?? 0) + p.gpuPercent),
    null,
  )

  // Cắt SAU khi đã cộng tổng: `totals` nói về cả máy, bảng chỉ hiện phần nặng nhất.
  const capped = capList(processes, ours)

  return {
    scope,
    at,
    coreCount,
    totalMemKb,
    warmingUp: processes.every((p) => p.cpuPercent === null),
    gpu,
    system,
    totals: {
      cpuPercent: totalCpu,
      gpuPercent: totalGpu,
      rssKb: processes.reduce((acc, p) => acc + p.rssKb, 0),
      processCount: processes.length,
    },
    ...(capped.truncated ? { truncated: true } : {}),
    processes: capped.rows.sort((a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)),
    sessions: [...perSession.values()].sort((a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)),
    orphans: orphans.sort((a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)),
  }
}
