// Bóc số từ các bảng chữ của kubectl — phần tính toán của màn `/infra → Kubernetes
// → Báo cáo`. Hàm THUẦN, không Vue, không RPC: mọi thứ ở đây test được bằng một
// chuỗi và một kỳ vọng.
//
// VÌ SAO LÀ TEXT. Tab Kubernetes cố ý dùng bảng mặc định (`--no-headers`) thay cho
// `-o json`: định dạng JSON in NỘI DUNG object nên `sensitiveReadOf()` xếp nó vào
// nhóm phải hỏi duyệt, tức mỗi lần nạp báo cáo là một hộp thoại. Giá của lựa chọn
// đó là phải đọc chữ, và đây là chỗ trả giá — đúng một chỗ.
//
// LUẬT CHUNG CỦA FILE: không đọc được thì trả `null`, KHÔNG trả 0. Một ô CPU rỗng
// hiện ra là "—" thì người dùng đi tìm nguồn số; hiện ra là "0m" thì họ tin cụm
// đang rảnh.

/** Một hàng bảng đã bóc cột (khớp `KubeRow` của `useInfraKube`). */
export type Row = { name: string; cells: string[] }

// ─── Ô RESTARTS ─────────────────────────────────────────────────────────────
/**
 * `RESTARTS` của `kubectl get pods` KHÔNG phải một con số: khi có lần khởi động
 * lại gần đây kubectl in `3 (2m ago)`. `Number('3 (2m ago)')` là `NaN`, và bản
 * đầu của màn Báo cáo quy `NaN` về 0 ⇒ **đúng những pod vừa restart lại được đếm
 * là 0 lần restart**, tức ô đáng báo động nhất của báo cáo hiện số đẹp nhất.
 *
 * Phần trong ngoặc cũng là thông tin: 3 lần restart từ hôm qua khác hẳn 3 lần
 * restart trong 2 phút vừa rồi, nên nó được giữ lại chứ không bỏ đi.
 */
export function parseRestarts(cell: string): { n: number; ago: string } {
  const raw = cell.trim()
  const m = /^(\d+)(?:\s*\(([^)]*)\))?$/.exec(raw)
  if (!m) return { n: 0, ago: '' }
  const n = Number(m[1])
  return { n: Number.isFinite(n) ? n : 0, ago: (m[2] ?? '').replace(/\s*ago$/i, '').trim() }
}

// ─── Ô AGE ──────────────────────────────────────────────────────────────────
const AGE_UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400, y: 31_536_000 }

/**
 * `5d2h`, `13m`, `47s`, `2y14d` → giây. kubectl in tối đa hai đơn vị và bỏ đơn vị
 * nhỏ khi đã lớn, nên cộng dồn mọi cặp số+đơn vị tìm được là đủ.
 */
export function parseAge(cell: string): number | null {
  const raw = cell.trim()
  if (raw === '' || raw === '<unknown>') return null
  let total = 0
  let found = false
  for (const m of raw.matchAll(/(\d+)([smhdy])/g)) {
    const mult = AGE_UNITS[m[2] ?? '']
    if (mult === undefined) continue
    total += Number(m[1]) * mult
    found = true
  }
  return found ? total : null
}

// ─── Đại lượng của `kubectl top` ────────────────────────────────────────────
/**
 * CPU → **milli-core**. `kubectl top` in `12m` (milli), `1` (một core) và, tuỳ
 * phiên bản metrics-server, `1500u`/`800n` (micro/nano core).
 */
export function parseCpu(cell: string): number | null {
  const raw = cell.trim()
  if (raw === '' || raw.startsWith('<')) return null
  const m = /^([0-9.]+)\s*([munk]?)$/.exec(raw)
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value)) return null
  switch (m[2]) {
    case 'n':
      return value / 1_000_000
    case 'u':
      return value / 1000
    case 'm':
      return value
    case 'k':
      return value * 1_000_000
    default:
      return value * 1000 // không đơn vị = core
  }
}

const MEM_UNITS: Record<string, number> = {
  '': 1,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  K: 1000,
  M: 1000 ** 2,
  G: 1000 ** 3,
  T: 1000 ** 4,
  P: 1000 ** 5,
}

/** Bộ nhớ → **byte**. `45Mi`, `1Gi`, `900K`, hoặc số byte trần. */
export function parseMemory(cell: string): number | null {
  const raw = cell.trim()
  if (raw === '' || raw.startsWith('<')) return null
  const m = /^([0-9.]+)\s*([KMGTP]i?)?$/.exec(raw)
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value)) return null
  const mult = MEM_UNITS[m[2] ?? '']
  return mult === undefined ? null : value * mult
}

/** `31%` → 31. `<unknown>` (metrics chưa có cho node đó) → `null`. */
export function parsePercent(cell: string): number | null {
  const m = /^([0-9.]+)\s*%$/.exec(cell.trim())
  if (!m) return null
  const value = Number(m[1])
  return Number.isFinite(value) ? value : null
}

/** `1200` milli → `1.2 core`; `120` → `120m`. Số core lẻ đọc dễ hơn bốn chữ số milli. */
export function formatCpu(milli: number): string {
  if (milli >= 1000) return `${(milli / 1000).toFixed(milli >= 10_000 ? 0 : 1)} core`
  return `${Math.round(milli)}m`
}

// ─── Bảng `get nodes` ───────────────────────────────────────────────────────
export type NodeStat = {
  name: string
  /** Nguyên văn cột STATUS: `Ready`, `NotReady`, `Ready,SchedulingDisabled`. */
  status: string
  ready: boolean
  /** `true` khi node bị cordon — nó vẫn `Ready` nhưng không nhận pod mới. */
  cordoned: boolean
  version: string
  ageSec: number | null
}

export type NodeSummary = {
  total: number
  ready: number
  /** MỌI node, đúng thứ tự kubectl in — khối chip node hiện cả node khoẻ. */
  all: NodeStat[]
  notReady: NodeStat[]
  cordoned: NodeStat[]
  /** Các phiên bản kubelet khác nhau — >1 nghĩa là cụm đang lệch phiên bản. */
  versions: string[]
}

/**
 * `NAME STATUS ROLES AGE VERSION` ⇒ `cells = [STATUS, ROLES, AGE, VERSION]`.
 *
 * `Ready,SchedulingDisabled` được tính là READY nhưng có cờ riêng: node cordon
 * không hỏng, nhưng nó là lý do thật khiến pod mới `Pending` mãi — gộp nó vào
 * "NotReady" sẽ báo động sai, bỏ hẳn nó thì báo cáo không giải thích được vì sao
 * pod không lên.
 */
export function nodeSummary(rows: readonly Row[]): NodeSummary {
  const out: NodeSummary = {
    total: rows.length,
    ready: 0,
    all: [],
    notReady: [],
    cordoned: [],
    versions: [],
  }
  const seen = new Set<string>()
  for (const row of rows) {
    const status = (row.cells[0] ?? '').trim()
    const parts = status.split(',').map((s) => s.trim())
    const stat: NodeStat = {
      name: row.name,
      status: status || '—',
      ready: parts.includes('Ready'),
      cordoned: parts.includes('SchedulingDisabled'),
      version: (row.cells[3] ?? '').trim(),
      ageSec: parseAge(row.cells[2] ?? ''),
    }
    out.all.push(stat)
    if (stat.ready) out.ready += 1
    else out.notReady.push(stat)
    if (stat.cordoned) out.cordoned.push(stat)
    if (stat.version && !seen.has(stat.version)) {
      seen.add(stat.version)
      out.versions.push(stat.version)
    }
  }
  return out
}

// ─── Bảng `top nodes` ───────────────────────────────────────────────────────
export type NodeUsage = {
  name: string
  cpuMilli: number | null
  cpuPct: number | null
  memBytes: number | null
  memPct: number | null
}

/** `NAME CPU(cores) CPU% MEMORY(bytes) MEMORY%` ⇒ `cells` bốn ô. */
export function nodeUsage(rows: readonly Row[]): NodeUsage[] {
  return rows.map((row) => ({
    name: row.name,
    cpuMilli: parseCpu(row.cells[0] ?? ''),
    cpuPct: parsePercent(row.cells[1] ?? ''),
    memBytes: parseMemory(row.cells[2] ?? ''),
    memPct: parsePercent(row.cells[3] ?? ''),
  }))
}

// ─── Bảng `top pods` ────────────────────────────────────────────────────────
export type PodUsage = { name: string; cpuMilli: number | null; memBytes: number | null }

/** `NAME CPU(cores) MEMORY(bytes)` ⇒ `cells` hai ô. */
export function podUsage(rows: readonly Row[]): PodUsage[] {
  return rows.map((row) => ({
    name: row.name,
    cpuMilli: parseCpu(row.cells[0] ?? ''),
    memBytes: parseMemory(row.cells[1] ?? ''),
  }))
}

// ─── Nối pod với node (`kubectl get pods -o wide`) ──────────────────────────
/**
 * Vị trí ô NODE trong `cells` của một hàng pod. `-o wide` in
 * `NAME READY STATUS RESTARTS AGE IP NODE NOMINATED-NODE READINESS-GATES`, và
 * `cells` đã bỏ cột NAME ⇒ NODE là ô thứ 5 (0-based).
 *
 * Hằng số này là chỗ DUY NHẤT biết con số đó. Rải `cells[5]` khắp nơi thì ngày
 * kubectl thêm một cột là một cuộc đi săn.
 */
export const POD_NODE_CELL = 5

/** Pod đang chạy trên một node, kèm mức dùng nếu `kubectl top` có trả lời. */
export type NodePods = {
  /** Tổng số pod trên node — KHÔNG phải độ dài của `top`. */
  n: number
  /** Nặng nhất trước (RAM), cắt còn `topN`. */
  top: PodUsage[]
}

/**
 * Gộp pod theo node.
 *
 * Vì sao phải nối hai bảng: cột NODE chỉ có ở `kubectl get pods -o wide`, còn số
 * RAM/CPU chỉ có ở `kubectl top pods`. Không nối thì báo cáo nói được "node này
 * RAM 100%" nhưng không nói được ai đang ăn — đúng chỗ người đọc phải mở terminal.
 *
 * Pod KHÔNG có số đo vẫn được giữ (giá trị `null`) chứ không bị loại: cụm không
 * cài metrics-server thì mọi pod đều không có số, và một danh sách rỗng ở đó đọc
 * ra thành "node này không có pod nào" — sai hẳn. Cùng lý do, `n` đếm mọi pod chứ
 * không đếm số pod đo được.
 */
export function podsByNode(
  pods: readonly Row[],
  usage: readonly PodUsage[],
  topN: number,
): Map<string, NodePods> {
  const measured = new Map(usage.map((u) => [u.name, u]))
  const byNode = new Map<string, PodUsage[]>()
  for (const row of pods) {
    const node = (row.cells[POD_NODE_CELL] ?? '').trim()
    // Pod `Pending` chưa được xếp lên node nào: kubectl in `<none>`.
    if (node === '' || node === '<none>') continue
    const list = byNode.get(node) ?? []
    list.push(measured.get(row.name) ?? { name: row.name, cpuMilli: null, memBytes: null })
    byNode.set(node, list)
  }
  const out = new Map<string, NodePods>()
  for (const [node, list] of byNode) {
    // Pod chưa đo được xuống cuối: chúng không trả lời được câu "ai đang ăn RAM".
    const sorted = [...list].sort((a, b) => (b.memBytes ?? -1) - (a.memBytes ?? -1))
    out.set(node, { n: list.length, top: sorted.slice(0, topN) })
  }
  return out
}

/** Tổng của một cột, `null` khi KHÔNG ô nào đọc được (khác với tổng bằng 0). */
export function sumOf(values: readonly (number | null)[]): number | null {
  let total = 0
  let any = false
  for (const v of values) {
    if (v === null) continue
    total += v
    any = true
  }
  return any ? total : null
}

// ─── Bảng `get events --field-selector type=Warning` ────────────────────────
export type EventGroup = {
  reason: string
  object: string
  message: string
  /** Số dòng event cùng (reason, object) trong lượt đọc này. */
  count: number
  /** Nguyên văn cột LAST SEEN của dòng mới nhất trong nhóm. */
  lastSeen: string
  rate: 'bad' | 'warn'
}

/**
 * Lý do mà một event `Warning` là dấu hiệu HỎNG chứ không phải nhiễu. Mọi event
 * lọt vào đây đều đã là `type=Warning`, nhưng `Warning` của kubernetes rất rộng:
 * `FailedScheduling` vì thiếu node là một sự cố, còn một lần `Unhealthy` do probe
 * chậm lúc khởi động thì không. Chia hai mức để dải màu nói đúng mức độ.
 */
const BAD_REASONS: ReadonlySet<string> = new Set([
  'OOMKilling',
  'OOMKilled',
  'Evicted',
  'FailedScheduling',
  'FailedMount',
  'FailedAttachVolume',
  'FailedCreatePodSandBox',
  'BackOff',
  'Failed',
  'FailedCreate',
  'NodeNotReady',
  'NodeHasDiskPressure',
  'NodeHasMemoryPressure',
  'FreeDiskSpaceFailed',
])

/**
 * Bảng event của kubectl là bảng DUY NHẤT ở đây mà cột đầu KHÔNG phải tên
 * (`LAST SEEN TYPE REASON OBJECT MESSAGE`), và số cột từng đổi giữa các phiên bản
 * kubectl (cột `COUNT` đã bị bỏ). Nên thay vì đếm cột, ta NEO vào ô `Warning`/
 * `Normal` — giá trị duy nhất trong hàng có tập giá trị đóng — rồi đọc hai bên nó.
 * Hàng lạ ⇒ bỏ, không đoán.
 */
export function warningEvents(rows: readonly string[][]): EventGroup[] {
  const groups = new Map<string, EventGroup>()
  for (const cells of rows) {
    const i = cells.findIndex((c) => c === 'Warning' || c === 'Normal')
    if (i === -1 || cells[i] !== 'Warning') continue
    const reason = (cells[i + 1] ?? '').trim() || '—'
    const object = (cells[i + 2] ?? '').trim() || '—'
    const message = cells
      .slice(i + 3)
      .join(' ')
      .trim()
    const lastSeen = i > 0 ? (cells[i - 1] ?? '').trim() : ''
    const key = `${reason} ${object}`
    const hit = groups.get(key)
    if (hit) {
      hit.count += 1
      // Hàng đến sau là hàng mới hơn (`--sort-by=.metadata.creationTimestamp`).
      hit.lastSeen = lastSeen || hit.lastSeen
      if (message) hit.message = message
      continue
    }
    groups.set(key, {
      reason,
      object,
      message,
      count: 1,
      lastSeen,
      rate: BAD_REASONS.has(reason) ? 'bad' : 'warn',
    })
  }
  // Nặng trước, rồi nhiều lần trước: thứ tự người đọc cần, không phải thứ tự kubectl in.
  return [...groups.values()].sort((a, b) => {
    if (a.rate !== b.rate) return a.rate === 'bad' ? -1 : 1
    return b.count - a.count
  })
}

// ─── `kubectl describe nodes` → sức chứa thật ───────────────────────────────
/**
 * Sức chứa của MỘT node. Hai thứ khác nhau mà người ta hay trộn:
 *   · **đang dùng** (`kubectl top`) — CPU/RAM thật sự đang tiêu thụ;
 *   · **đã đặt chỗ** (`requests` trong `Allocated resources`) — phần scheduler đã
 *     hứa cho pod và KHÔNG cho ai khác dùng, dù pod đó đang chạy không tải.
 *
 * Pod `Pending` gần như luôn vì hết phần ĐẶT CHỖ, không vì CPU thật đang cao —
 * một node dùng 9% mà đã đặt chỗ 98% thì không nhận thêm pod nào nữa. Thiếu con
 * số này thì báo cáo nhìn cụm đó và nói "còn rảnh".
 */
export type NodeCapacity = {
  name: string
  /** `Allocatable` — phần scheduler được phép chia, ĐÃ trừ dành riêng cho kubelet/OS. */
  cpuAllocMilli: number | null
  memAllocBytes: number | null
  /** Trần số pod của node (`Allocatable.pods`) và số pod đang chạy trên đó. */
  podCapacity: number | null
  podCount: number | null
  cpuReqMilli: number | null
  cpuReqPct: number | null
  cpuLimPct: number | null
  memReqBytes: number | null
  memReqPct: number | null
  memLimPct: number | null
  /**
   * Tên các condition đang `True`, **trừ `Ready`**. `Ready=True` là trạng thái
   * bình thường của mọi node khoẻ — đưa nó vào đây thì mỗi node đóng góp một chip
   * vô nghĩa và `DiskPressure` thật lẫn vào giữa chúng. Cái người trực cần thấy là
   * phần CÒN LẠI: `MemoryPressure`, `DiskPressure`, `PIDPressure`,
   * `NetworkUnavailable` — những condition mà `kubectl get nodes` vẫn in `Ready`.
   */
  conditions: string[]
}

/** `760m (39%)` → `{ raw: '760m', pct: 39 }`; `0 (0%)` cũng hợp lệ. */
const ALLOCATED_ROW = /^\s+(cpu|memory)\s+(\S+)\s*\((\d+)%\)\s+(\S+)\s*\((\d+)%\)/

function emptyCapacity(name: string): NodeCapacity {
  return {
    name,
    cpuAllocMilli: null,
    memAllocBytes: null,
    podCapacity: null,
    podCount: null,
    cpuReqMilli: null,
    cpuReqPct: null,
    cpuLimPct: null,
    memReqBytes: null,
    memReqPct: null,
    memLimPct: null,
    conditions: [],
  }
}

/**
 * Một dòng của mục `Conditions:`: `MemoryPressure  False  Thu, 17 Sep 2026 …`.
 *
 * Neo vào ô trạng thái (tập giá trị đóng `True`/`False`/`Unknown`) thay vì đếm cột
 * — nhờ vậy dòng tiêu đề `Type  Status  LastHeartbeatTime …` tự rơi ra (ô thứ hai
 * của nó là chữ `Status`) mà không cần một luật riêng để nhận ra tiêu đề.
 */
const CONDITION_ROW = /^\s+(\S+)\s+(True|False|Unknown)\b/

/**
 * Bóc `kubectl describe nodes` (KHÔNG kèm tên ⇒ mọi node trong một lần gọi).
 *
 * Vì sao đọc text chứ không `-o json`: `-o json` rơi vào nhóm "in nội dung
 * object" của `sensitiveReadOf()` ⇒ mỗi lần nạp báo cáo là một hộp thoại duyệt.
 * Cùng đánh đổi với phần còn lại của file này.
 *
 * Luật đọc: khối của một node mở bằng `Name:` ở cột 0; mọi mục con (`Capacity:`,
 * `Allocatable:`, `Allocated resources:`) cũng ở cột 0 và nội dung của chúng thụt
 * lề. Vì thế một dòng KHÔNG thụt lề luôn đóng mục đang mở — nhờ vậy parser không
 * cần biết trước danh sách mục, và một bản kubectl thêm mục mới cũng không làm nó
 * đọc nhầm số của mục khác.
 */
export function nodeCapacity(text: string): NodeCapacity[] {
  const out: NodeCapacity[] = []
  let cur: NodeCapacity | null = null
  let section: 'alloc' | 'allocated' | 'conditions' | null = null

  for (const line of text.split('\n')) {
    const nameHit = /^Name:\s+(\S+)/.exec(line)
    if (nameHit) {
      cur = emptyCapacity(nameHit[1] ?? '')
      out.push(cur)
      section = null
      continue
    }
    if (!cur) continue

    if (/^\S/.test(line)) {
      // Dòng ở cột 0 ⇒ đóng mục đang mở, rồi xem nó có mở mục mới không.
      section = null
      if (/^Allocatable:/.test(line)) section = 'alloc'
      else if (/^Allocated resources:/.test(line)) section = 'allocated'
      else if (/^Conditions:/.test(line)) section = 'conditions'
      else {
        const pods = /^Non-terminated Pods:\s+\((\d+) in total\)/.exec(line)
        if (pods) cur.podCount = Number(pods[1])
      }
      continue
    }

    if (section === 'alloc') {
      const hit = /^\s+(cpu|memory|pods):\s+(\S+)/.exec(line)
      if (!hit) continue
      const value = hit[2] ?? ''
      if (hit[1] === 'cpu') cur.cpuAllocMilli = parseCpu(value)
      else if (hit[1] === 'memory') cur.memAllocBytes = parseMemory(value)
      else cur.podCapacity = Number.isFinite(Number(value)) ? Number(value) : null
      continue
    }

    if (section === 'conditions') {
      const hit = CONDITION_ROW.exec(line)
      if (!hit) continue
      const type = hit[1] ?? ''
      // `Ready` bị bỏ có chủ đích — xem docblock của `NodeCapacity.conditions`.
      if (hit[2] !== 'True' || type === '' || type === 'Ready') continue
      if (!cur.conditions.includes(type)) cur.conditions.push(type)
      continue
    }

    if (section === 'allocated') {
      const hit = ALLOCATED_ROW.exec(line)
      // Bảng này còn có `ephemeral-storage` và `hugepages-*` — không phải thứ báo
      // cáo hỏi, và chúng rơi ra ở đây vì regex chỉ nhận cpu/memory.
      if (!hit) continue
      const req = hit[2] ?? ''
      const reqPct = Number(hit[3])
      const limPct = Number(hit[5])
      if (hit[1] === 'cpu') {
        cur.cpuReqMilli = parseCpu(req)
        cur.cpuReqPct = reqPct
        cur.cpuLimPct = limPct
      } else {
        cur.memReqBytes = parseMemory(req)
        cur.memReqPct = reqPct
        cur.memLimPct = limPct
      }
    }
  }
  return out
}

// ─── `kubectl get hpa` ──────────────────────────────────────────────────────
export type HpaStat = {
  name: string
  /** `Deployment/api` — thứ HPA đang lái. */
  reference: string
  /** Nguyên văn cột TARGETS: `45%/70%`, hoặc `cpu: <unknown>/70%`. */
  targets: string
  min: number | null
  max: number | null
  replicas: number | null
  /** Đã chạm trần: HPA hết đường giãn, dịch vụ chậm mà mọi pod vẫn `Running`. */
  atMax: boolean
  /** Metrics-server chưa trả số ⇒ HPA đang KHÔNG lái gì cả. */
  unknown: boolean
}

function intOf(cell: string | undefined): number | null {
  const n = Number((cell ?? '').trim())
  return Number.isFinite(n) ? n : null
}

/** `NAME REFERENCE TARGETS MINPODS MAXPODS REPLICAS AGE` ⇒ `cells` sáu ô. */
export function hpaStats(rows: readonly Row[]): HpaStat[] {
  return rows.map((row) => {
    const targets = (row.cells[1] ?? '').trim()
    const max = intOf(row.cells[3])
    const replicas = intOf(row.cells[4])
    return {
      name: row.name,
      reference: (row.cells[0] ?? '').trim(),
      targets,
      min: intOf(row.cells[2]),
      max,
      replicas,
      atMax: max !== null && replicas !== null && replicas >= max,
      unknown: targets.includes('<unknown>'),
    }
  })
}

// ─── Workload KHÔNG phải Deployment ─────────────────────────────────────────
export type WorkloadStat = {
  name: string
  /** `2/3` — nguyên văn, để UI hiện đúng thứ kubectl nói. */
  ready: string
  /** `false` khi thiếu bản sao (hoặc Job chưa xong / đã fail). */
  ok: boolean
  /** Chỉ Job: `Complete` / `Failed` / `Running` khi kubectl có cột STATUS. */
  status: string
}

const READY_CELL = /^(\d+)\/(\d+)$/

/** `NAME READY AGE` (StatefulSet) ⇒ `cells[0]` là `2/2`. */
export function statefulSetStats(rows: readonly Row[]): WorkloadStat[] {
  return rows.map((row) => {
    const cell = (row.cells[0] ?? '').trim()
    const hit = READY_CELL.exec(cell)
    return {
      name: row.name,
      ready: cell || '—',
      ok: hit ? Number(hit[1]) >= Number(hit[2]) : false,
      status: '',
    }
  })
}

/**
 * `NAME DESIRED CURRENT READY UP-TO-DATE AVAILABLE NODE-SELECTOR AGE`.
 *
 * DaemonSet là loại workload duy nhất mà "thiếu một bản" nghĩa là **một node cụ
 * thể** không chạy được nó (thường vì hết chỗ hoặc taint) — nên nó đáng một dòng
 * riêng trong báo cáo chứ không gộp vào đếm pod.
 */
export function daemonSetStats(rows: readonly Row[]): WorkloadStat[] {
  return rows.map((row) => {
    const desired = intOf(row.cells[0])
    const ready = intOf(row.cells[2])
    return {
      name: row.name,
      ready: `${ready ?? '—'}/${desired ?? '—'}`,
      ok: desired !== null && ready !== null && ready >= desired,
      status: '',
    }
  })
}

/**
 * Job. Hình dạng bảng ĐỔI theo phiên bản kubectl: bản cũ in
 * `NAME COMPLETIONS DURATION AGE`, bản 1.31+ chèn thêm cột `STATUS` lên trước.
 * Vì thế đọc theo HÌNH DẠNG Ô (`x/y` là completions, một từ trong danh sách là
 * status) chứ không theo chỉ số cột — đọc theo chỉ số thì một lần nâng cấp cụm là
 * báo cáo im lặng đọc sai cột.
 */
const JOB_STATUS = new Set(['complete', 'failed', 'running', 'suspended'])

export function jobStats(rows: readonly Row[]): WorkloadStat[] {
  return rows.map((row) => {
    let ready = ''
    let status = ''
    for (const cell of row.cells) {
      const v = cell.trim()
      if (ready === '' && READY_CELL.test(v)) ready = v
      else if (status === '' && JOB_STATUS.has(v.toLowerCase())) status = v
    }
    const hit = READY_CELL.exec(ready)
    const done = hit ? Number(hit[1]) >= Number(hit[2]) : false
    return {
      name: row.name,
      ready: ready || '—',
      // Job đang chạy dở KHÔNG phải lỗi; chỉ `Failed` mới là. Nên `ok` ở đây nghĩa
      // là "không có gì phải xem", và một Job `Running` thì đúng là như vậy.
      ok: status.toLowerCase() === 'failed' ? false : done || status.toLowerCase() === 'running',
      status,
    }
  })
}

// ─── Lưu trữ + mạng ─────────────────────────────────────────────────────────
export type PvcStat = {
  name: string
  /** `Bound` / `Pending` / `Lost`. */
  status: string
  bound: boolean
  capacity: string
  bytes: number | null
}

const SIZE_CELL = /^\d+(\.\d+)?[KMGTP]i?$/

/**
 * `NAME STATUS VOLUME CAPACITY ACCESS-MODES STORAGECLASS AGE`.
 *
 * PVC `Pending` thì kubectl BỎ TRỐNG volume/capacity/access-modes, và bảng chữ
 * không có cách nào phân biệt "ô trống" với "cột bị gộp" sau khi cắt theo ≥2 dấu
 * cách. Nên dung lượng tìm theo HÌNH DẠNG (`8Gi`) thay vì theo vị trí cột.
 */
export function pvcStats(rows: readonly Row[]): PvcStat[] {
  return rows.map((row) => {
    const status = (row.cells[0] ?? '').trim()
    const size = row.cells.map((c) => c.trim()).find((c) => SIZE_CELL.test(c)) ?? ''
    return {
      name: row.name,
      status: status || '—',
      bound: status.toLowerCase() === 'bound',
      capacity: size || '—',
      bytes: size ? parseMemory(size) : null,
    }
  })
}

export type ServiceStat = {
  name: string
  type: string
  externalIp: string
  /** LoadBalancer chưa được cấp địa chỉ — dịch vụ "đã tạo" nhưng chưa ai vào được. */
  pending: boolean
}

/** `NAME TYPE CLUSTER-IP EXTERNAL-IP PORT(S) AGE` ⇒ `cells` năm ô. */
export function serviceStats(rows: readonly Row[]): ServiceStat[] {
  return rows.map((row) => {
    const type = (row.cells[0] ?? '').trim()
    const ext = (row.cells[2] ?? '').trim()
    return {
      name: row.name,
      type: type || '—',
      externalIp: ext || '—',
      pending: type === 'LoadBalancer' && (ext === '' || ext.startsWith('<')),
    }
  })
}

export type IngressStat = {
  name: string
  hosts: string
  address: string
  /** Chưa có ADDRESS ⇒ ingress controller chưa nhận, tên miền chưa trỏ tới đâu. */
  pending: boolean
}

/** `NAME CLASS HOSTS ADDRESS PORTS AGE` ⇒ `cells` năm ô. */
export function ingressStats(rows: readonly Row[]): IngressStat[] {
  return rows.map((row) => {
    const address = (row.cells[2] ?? '').trim()
    return {
      name: row.name,
      hosts: (row.cells[1] ?? '').trim() || '—',
      address: address || '—',
      pending: address === '' || address.startsWith('<'),
    }
  })
}

// ─── Bảng `get deployments -o wide` ─────────────────────────────────────────
export type DeployStat = {
  name: string
  ready: number
  desired: number
  upToDate: number | null
  available: number | null
  ageSec: number | null
  /** Ảnh container, tách từ cột IMAGES (kubectl nối bằng dấu phẩy). */
  images: string[]
  /** Bản mới CHƯA thay xong bản cũ: `upToDate < desired`. */
  rollingOut: boolean
}

/** `"9/9"` ⇒ `{ ready: 9, desired: 9 }`; ô lạ ⇒ `null` (thà bỏ qua còn hơn đoán). */
function readyPair(cell: string): { ready: number; desired: number } | null {
  const hit = READY_CELL.exec(cell.trim())
  if (!hit) return null
  const ready = Number(hit[1])
  const desired = Number(hit[2])
  if (!Number.isFinite(ready) || !Number.isFinite(desired)) return null
  return { ready, desired }
}

/**
 * `NAME READY UP-TO-DATE AVAILABLE AGE CONTAINERS IMAGES SELECTOR` ⇒
 * `cells = [READY, UP-TO-DATE, AVAILABLE, AGE, CONTAINERS, IMAGES, SELECTOR]`.
 *
 * VÌ SAO `rollingOut` ĐÁNG MỘT TRƯỜNG RIÊNG. Cột READY đếm pod sẵn sàng, KHÔNG
 * phân biệt pod đó thuộc bản cũ hay bản mới. Một rollout kẹt (ảnh sai, probe
 * không bao giờ pass, quota hết chỗ) vẫn in `9/9` suốt nhiều giờ vì 9 pod bản CŨ
 * vẫn đang phục vụ — nhìn mỗi READY thì một bản deploy hỏng trông y hệt một cụm
 * khoẻ, và người trực đóng báo cáo lại đi tìm chỗ khác. Thứ tố cáo nó là
 * `UP-TO-DATE < desired`: scheduler chưa thay xong bản cũ.
 *
 * READY không đọc được ⇒ `0/0` và `rollingOut` để `false`: ở đây thà im lặng còn
 * hơn nhuộm đỏ cả bảng vì một ô kubectl in khác dự đoán.
 */
export function deploymentStats(rows: readonly Row[]): DeployStat[] {
  return rows.map((row) => {
    const pair = readyPair(row.cells[0] ?? '')
    const desired = pair?.desired ?? 0
    const upToDate = intOf(row.cells[1])
    return {
      name: row.name,
      ready: pair?.ready ?? 0,
      desired,
      upToDate,
      available: intOf(row.cells[2]),
      ageSec: parseAge(row.cells[3] ?? ''),
      images: (row.cells[5] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '' && s !== '<none>'),
      rollingOut: upToDate !== null && desired > 0 && upToDate < desired,
    }
  })
}

// ─── Pod đang hỏng ──────────────────────────────────────────────────────────
export type PodFailureKind =
  | 'crashloop'
  | 'oomkilled'
  | 'imagepull'
  | 'pending'
  | 'evicted'
  | 'error'

export type PodFailure = {
  name: string
  kind: PodFailureKind
  /** Nguyên văn cột STATUS. */
  status: string
  restarts: number
  /** Lần restart gần nhất cách đây bao lâu, nguyên văn của kubectl (`2m`), rỗng nếu không có. */
  ago: string
  node: string
}

/**
 * Trạng thái BÌNH THƯỜNG — không phải hỏng, dù vài cái trong đây nghe như hỏng.
 * `ContainerCreating` và `Init:0/2` chỉ là pod đang lên; `Terminating` là pod đang
 * đi xuống đúng quy trình; `Completed`/`Succeeded` là Job đã xong. Chặn chúng
 * trước mọi luật khác để một luật mới thêm sau này không vô tình kéo pod khoẻ vào
 * danh sách hỏng.
 */
const HEALTHY_POD_STATUS = /^(running|completed|succeeded|containercreating|init:|terminating)/

/**
 * Xếp loại một ô STATUS. `null` = không phải pod hỏng.
 *
 * Thứ tự luật là thứ tự ĐẶC HIỆU giảm dần, không phải thứ tự bảng chữ cái:
 * `CrashLoopBackOff` và `OOMKilled` đều là "pod chết đi chết lại" nhưng nguyên
 * nhân khác nhau hoàn toàn (một cái do code, một cái do thiếu RAM) nên phải tách.
 *
 * STATUS không khớp luật nào ⇒ `null`, tức KHÔNG vào danh sách hỏng. Đây là danh
 * sách đóng có chủ đích: kubelet in được vài chục chuỗi trạng thái quá độ, và đoán
 * bừa "lạ nghĩa là hỏng" sẽ nhuộm đỏ báo cáo mỗi lần cụm đang tự xoay xở. Cái giá
 * là trạng thái hỏng nào chưa có trong luật (ví dụ `CreateContainerConfigError`)
 * thì không hiện — thêm luật khi gặp thật, đừng thêm một nhánh bắt-tất-cả.
 */
function podFailureKind(status: string): PodFailureKind | null {
  const s = status.toLowerCase()
  if (s === '' || HEALTHY_POD_STATUS.test(s)) return null
  if (s.startsWith('crashloop')) return 'crashloop'
  if (s.includes('oomkilled')) return 'oomkilled'
  if (s.startsWith('imagepull') || s.startsWith('errimagepull') || s.startsWith('invalidimagename'))
    return 'imagepull'
  if (s === 'pending') return 'pending'
  if (s.startsWith('evicted')) return 'evicted'
  if (s.startsWith('error') || s.startsWith('failed') || s.startsWith('unknown')) return 'error'
  return null
}

/**
 * Mức nặng để xếp danh sách. Không phải thứ tự kubectl in, mà là thứ tự người trực
 * cần đọc: `OOMKilled` có cách sửa ngay (nâng limit), `Pending` thì thường chỉ là
 * hệ quả của một trong các dòng phía trên.
 */
const FAILURE_ORDER: readonly PodFailureKind[] = [
  'oomkilled',
  'crashloop',
  'imagepull',
  'evicted',
  'error',
  'pending',
]

/**
 * Lọc các pod đang hỏng từ `kubectl get pods -o wide --no-headers`
 * (`cells = [READY, STATUS, RESTARTS, AGE, IP, NODE, …]`).
 *
 * Vì sao lọc ở đây chứ không để UI đọc cả bảng: một cụm thật có hàng trăm pod
 * `Running`, và một danh sách dài như thế thì mắt người không thấy ba dòng
 * `CrashLoopBackOff` nằm giữa. Báo cáo chỉ đáng đọc khi nó cắt sẵn phần đáng đọc.
 */
export function podFailures(rows: readonly Row[]): PodFailure[] {
  const out: PodFailure[] = []
  for (const row of rows) {
    const status = (row.cells[1] ?? '').trim()
    const kind = podFailureKind(status)
    if (kind === null) continue
    const restarts = parseRestarts(row.cells[2] ?? '')
    out.push({
      name: row.name,
      kind,
      status,
      restarts: restarts.n,
      ago: restarts.ago,
      node: (row.cells[POD_NODE_CELL] ?? '').trim(),
    })
  }
  return out.sort((a, b) => FAILURE_ORDER.indexOf(a.kind) - FAILURE_ORDER.indexOf(b.kind))
}

/** Số pod CÓ lần khởi động lại trong `windowSec` vừa qua. Đọc phần `(2m ago)` của
 *  cột RESTARTS — xem `parseRestarts`.
 *
 *  VÌ SAO KHÔNG DÙNG TỔNG TÍCH LUỸ. Cột RESTARTS đếm từ lúc pod sinh ra, nên con
 *  số trần gần như vô dụng cho người trực: 400 lần trong 30 ngày của một sidecar
 *  hay bị OOM lúc nửa đêm là chuyện cũ, còn 12 lần trong 10 phút là sự cố ĐANG
 *  diễn ra — và tổng tích luỹ xếp cái thứ hai xuống dưới cái thứ nhất. Thứ đáng
 *  hiện là số pod vừa restart trong một cửa sổ thời gian.
 *
 *  Pod không có phần `(… ago)` (restart từ lâu, hoặc chưa restart lần nào) KHÔNG
 *  được tính: `''` qua `parseAge` ra `null`, và `null` ở đây nghĩa là "không biết"
 *  chứ không phải "vừa xong". */
export function restartsWithin(rows: readonly Row[], windowSec: number): number {
  let n = 0
  for (const row of rows) {
    const { n: count, ago } = parseRestarts(row.cells[2] ?? '')
    if (count <= 0 || ago === '') continue
    const sec = parseAge(ago)
    if (sec !== null && sec <= windowSec) n += 1
  }
  return n
}

// ─── Cảnh báo tươi vs cũ ────────────────────────────────────────────────────
export type EventFreshness = { fresh: EventGroup[]; freshLines: number; staleLines: number }

/**
 * Chia nhóm event thành TƯƠI (vừa xảy ra) và CŨ.
 *
 * `kubectl get events` giữ lại event tới một giờ (mặc định), nên một cụm đã được
 * sửa xong vẫn còn đầy `Warning` của lúc hỏng. Hiện tất cả như nhau thì báo cáo
 * kêu về chuyện hôm kia và người đọc học cách bỏ qua khối đó — đúng lúc nó kêu
 * thật thì không ai nhìn.
 *
 * Nhóm không đọc được `lastSeen` xếp vào CŨ có chủ đích: đoán nhầm theo hướng
 * "tươi" là một báo động sai, đoán nhầm theo hướng "cũ" chỉ làm một dòng tụt
 * xuống phần phụ — nó vẫn còn trong `staleLines`, không mất đi.
 */
export function eventFreshness(groups: readonly EventGroup[], windowSec: number): EventFreshness {
  const out: EventFreshness = { fresh: [], freshLines: 0, staleLines: 0 }
  for (const g of groups) {
    const sec = parseAge(g.lastSeen)
    if (sec !== null && sec <= windowSec) {
      out.fresh.push(g)
      out.freshLines += g.count
    } else {
      out.staleLines += g.count
    }
  }
  return out
}

// ─── `kubectl get endpoints` ────────────────────────────────────────────────
/** `kubectl get endpoints` — NAME ENDPOINTS AGE ⇒ cells = [ENDPOINTS, AGE].
 *  ENDPOINTS là `10.0.1.2:8080,10.0.1.3:8080` hoặc `<none>`. */
export type EndpointStat = { name: string; count: number; empty: boolean }

/**
 * Service có endpoint rỗng là lỗi IM LẶNG kinh điển của kubernetes: `get svc` in
 * ra một dòng đẹp, `get deploy` cũng đẹp, nhưng selector không khớp label nào nên
 * mọi request vào service rơi vào hư vô. Bảng endpoints là chỗ duy nhất trong các
 * lệnh `get` nói ra điều đó.
 *
 * Bẫy hình dạng: khi có nhiều địa chỉ, kubectl CẮT danh sách và in đuôi
 * `… + 5 more...`. Đếm dấu phẩy suông thì một service 12 pod báo là 3 — nên phần
 * đuôi được cộng lại chứ không bỏ.
 */
export function endpointStats(rows: readonly Row[]): EndpointStat[] {
  return rows.map((row) => {
    const raw = (row.cells[0] ?? '').trim()
    const more = /\+\s*(\d+)\s*more/i.exec(raw)
    const listed = raw
      .replace(/\+\s*\d+\s*more\.*/i, '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '' && !s.startsWith('<')).length
    const count = listed + (more ? Number(more[1]) : 0)
    return { name: row.name, count, empty: count === 0 }
  })
}

// ─── `kubectl get resourcequota` ────────────────────────────────────────────
/** `kubectl get resourcequota` — NAME AGE REQUEST LIMIT ⇒ cells = [AGE, REQUEST, LIMIT].
 *  REQUEST/LIMIT là chuỗi nhiều cặp: `requests.cpu: 7200m/8, requests.memory: 12Gi/16Gi`. */
export type QuotaEntry = { resource: string; used: string; hard: string; pct: number | null }
export type QuotaStat = { name: string; entries: QuotaEntry[] }

/**
 * Tỉ lệ dùng/trần của một dòng quota.
 *
 * Hai vế phải được quy về CÙNG một đơn vị trước khi chia, mà quota trộn ba hệ
 * trong cùng một ô: CPU (`7200m/8` — milli chia cho core), bộ nhớ (`12Gi/16Gi`) và
 * số đếm trần (`pods: 5/20`). Chia thẳng chuỗi qua `Number()` thì `7200m/8` ra
 * `NaN`, còn tệ hơn: nếu ai đó "sửa" bằng `parseInt` thì nó ra 7200/8 = 90.000%.
 * Nên đơn vị được ĐOÁN theo hình dạng rồi mới chia.
 */
function quotaPct(used: string, hard: string): number | null {
  const isMem = (s: string) => /^[0-9.]+(Ki|Mi|Gi|Ti|Pi|K|M|G|T|P)$/.test(s)
  const isCpu = (s: string) => /^[0-9.]+m?$/.test(s)
  const pick = (s: string): number | null => {
    if (isMem(used) || isMem(hard)) return parseMemory(s)
    if (isCpu(used) && isCpu(hard)) return parseCpu(s)
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  const u = pick(used)
  const h = pick(hard)
  // `hard === 0` nghĩa là "cấm hẳn tài nguyên này": không có tỉ lệ nào đúng cả,
  // và 0/0 = `NaN` thì lọt xuống UI thành ô trống bí ẩn.
  if (u === null || h === null || h <= 0) return null
  return Math.round((u / h) * 1000) / 10
}

/**
 * Bóc hai ô REQUEST/LIMIT thành từng dòng tài nguyên.
 *
 * Vì sao quota đáng hiện: khi namespace chạm trần quota, pod mới KHÔNG `Pending`
 * theo cách quen thuộc — ReplicaSet bị từ chối ngay ở API server, nên `get pods`
 * không có gì để xem và `get deploy` chỉ nói `2/5` mà không nói vì sao. Con số
 * `requests.cpu: 7200m/8` là câu trả lời.
 */
export function quotaStats(rows: readonly Row[]): QuotaStat[] {
  return rows.map((row) => {
    const entries: QuotaEntry[] = []
    for (const cell of [row.cells[1] ?? '', row.cells[2] ?? '']) {
      for (const part of cell.split(',')) {
        // `requests.cpu: 7200m/8` — tên tài nguyên có dấu chấm, giá trị có dấu `/`,
        // nên cắt theo dấu hai chấm ĐẦU TIÊN và dấu gạch chéo CUỐI CÙNG là đủ.
        const hit = /^\s*([^:]+):\s*([^/]*)\/(.*)$/.exec(part)
        if (!hit) continue
        const used = (hit[2] ?? '').trim()
        const hard = (hit[3] ?? '').trim()
        entries.push({ resource: (hit[1] ?? '').trim(), used, hard, pct: quotaPct(used, hard) })
      }
    }
    return { name: row.name, entries }
  })
}

// ─── `kubectl get poddisruptionbudgets` ─────────────────────────────────────
/** `kubectl get poddisruptionbudgets` — NAME MIN-AVAILABLE MAX-UNAVAILABLE ALLOWED-DISRUPTIONS AGE. */
export type PdbStat = { name: string; allowed: number | null; blocked: boolean }

/**
 * `ALLOWED DISRUPTIONS = 0` là lý do thật khiến `kubectl drain` treo vô hạn và
 * việc nâng cấp node đứng im giữa chừng — không có event, không có pod đỏ, chỉ là
 * một lệnh không bao giờ trả về. PDB chặn là thứ người ta chỉ nhớ ra sau nửa
 * tiếng, nên nó đáng một dòng sẵn trong báo cáo.
 */
export function pdbStats(rows: readonly Row[]): PdbStat[] {
  return rows.map((row) => {
    const allowed = intOf(row.cells[2])
    return { name: row.name, allowed, blocked: allowed === 0 }
  })
}

// ─── `kubectl get rs` ───────────────────────────────────────────────────────
/** `kubectl get rs` — NAME DESIRED CURRENT READY AGE. */
export type RolloutStat = {
  name: string
  desired: number | null
  ready: number | null
  ageSec: number | null
}

/**
 * ReplicaSet TRẺ NHẤT có `desired > 0` — đó là bản vừa được tung ra. `null` khi
 * không đọc được.
 *
 * Vì sao lọc `desired > 0`: mỗi lần deploy để lại một ReplicaSet cũ đã thu về 0
 * (mặc định giữ 10 bản cho `rollout undo`), nên bảng `get rs` phần lớn là xác. Bản
 * đang phục vụ là bản còn muốn pod. Trong lúc rollout thì có HAI bản `desired > 0`
 * cùng lúc — bản trẻ hơn là bản mới, và tuổi của nó chính là "deploy gần nhất cách
 * đây bao lâu", con số đầu tiên người ta hỏi khi một dịch vụ vừa hỏng.
 */
export function latestRollout(rows: readonly Row[]): RolloutStat | null {
  let best: RolloutStat | null = null
  for (const row of rows) {
    const desired = intOf(row.cells[0])
    const ageSec = parseAge(row.cells[3] ?? '')
    if (desired === null || desired <= 0 || ageSec === null) continue
    const stat: RolloutStat = { name: row.name, desired, ready: intOf(row.cells[2]), ageSec }
    if (best === null || (best.ageSec ?? Infinity) > ageSec) best = stat
  }
  return best
}
