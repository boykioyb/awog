// Page-controller cho trang Giám sát (/monitor): poll `monitor.sample`, dẫn xuất
// các bảng mà template bind, và gói lệnh dừng tiến trình sau một hộp xác nhận.
//
// Vì sao PHẢI poll chứ không dùng event: CPU tức thời là HIỆU giữa hai lần đo
// (xem monitor/sampler.ts ở sidecar). Một lần đọc đơn lẻ không nói được tiến
// trình đang bận hay đang ngủ, nên nhịp đo chính là dữ liệu.
//
// Chỉ chạy khi trang đang hiện: `onActivated`/`onDeactivated` phủ được cả KeepAlive
// (app giữ trang trong bộ nhớ, `onUnmounted` KHÔNG bắn khi đổi trang), nếu không
// mỗi 2 giây vẫn có một lượt `ps` chạy nền vĩnh viễn.
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { useConfirm } from '~/composables/useConfirm'
import { useToast } from '~/composables/useToast'
import { useI18n } from '~/composables/useI18n'

const POLL_MS = 2000

export type ProcessKind =
  | 'electron-main'
  | 'electron-renderer'
  | 'electron-gpu'
  | 'electron-utility'
  | 'sidecar'
  | 'claude-cli'
  | 'codex-daemon'
  | 'git'
  | 'shell'
  | 'node'
  | 'other'

export type OwnedKind =
  | 'terminal'
  | 'background-shell'
  | 'tool-shell'
  | 'codex-daemon'
  | 'mcp-probe'

export type SystemStats = {
  cores: number[]
  cpuPercent: number | null
  loadAvg: [number, number, number]
  /** Bộ nhớ bị chiếm thật (App + Wired + nén) — KHÔNG tính file cache. */
  memUsedKb: number
  /** File cache thu hồi được. */
  memCachedKb: number
  memTotalKb: number
  /** ⚠ `swapTotalKb` KHÔNG phải trần: macOS tự nới swapfile khi cần. */
  swapUsedKb: number
  swapTotalKb: number
  pressure: 'normal' | 'warn' | 'critical' | null
}

export type MonitorProcess = {
  pid: number
  ppid: number
  kind: ProcessKind
  label: string
  command: string
  cpuPercent: number | null
  /** % GPU của riêng tiến trình này. `null` khi nền tảng không đo được. */
  gpuPercent: number | null
  rssKb: number
  elapsedSeconds: number
  sessionId?: string
  attribution?: 'registry' | 'sdk-session-id' | 'inherited'
  ownedKind?: OwnedKind
  model?: string
  orphan?: boolean
  /** Thuộc cây của instance AWOG đang chạy — chỉ khi đó luật bảo vệ mới áp. */
  own?: boolean
  /** Ứng dụng mà tiến trình thuộc về, để gom nhóm. */
  app: string
  treeCpuPercent: number | null
  treeRssKb: number
}

export type SessionRuntimeAttribution = 'own-process' | 'in-engine' | 'shared-daemon'

export type MonitorSession = {
  sessionId: string
  title: string
  running: boolean
  attribution: SessionRuntimeAttribution
  cpuPercent: number | null
  rssKb: number
  pids: number[]
}

export type MonitorScope = 'awog' | 'machine' | 'ssh'

/** Một máy từ xa xem được: kết nối SSH đang mở. */
export type SshTarget = { connId: string; hostId: string; label: string }

export type MonitorSnapshot = {
  scope: MonitorScope
  connId?: string
  /** Bảng đã bị cắt vì máy có quá nhiều tiến trình; `totals` vẫn tính trên tất cả. */
  truncated?: boolean
  at: number
  coreCount: number
  totalMemKb: number
  warmingUp: boolean
  gpu: {
    utilizationPercent: number | null
    memoryUsedMb: number | null
    source: 'ioreg' | 'nvidia-smi' | null
  }
  system: SystemStats | null
  totals: {
    cpuPercent: number | null
    gpuPercent: number | null
    rssKb: number
    processCount: number
  }
  processes: MonitorProcess[]
  sessions: MonitorSession[]
  orphans: MonitorProcess[]
}

export type MonitorSortKey = 'name' | 'pid' | 'cpu' | 'gpu' | 'mem' | 'uptime'

/** Một ứng dụng và toàn bộ tiến trình của nó. */
export type AppGroup = {
  app: string
  procs: MonitorProcess[]
  cpuPercent: number | null
  gpuPercent: number | null
  rssKb: number
  /** Có ít nhất một tiến trình dừng được ⇒ nút "dừng cả ứng dụng" có nghĩa. */
  killable: boolean
}
export type SortDir = 'asc' | 'desc'

/** Chiều mặc định khi bấm lần đầu vào một cột: số thì lớn-trước (câu hỏi luôn là
 *  "cái nào nặng nhất"), chữ thì A-Z. */
const DEFAULT_DIR: Record<MonitorSortKey, SortDir> = {
  name: 'asc',
  pid: 'asc',
  cpu: 'desc',
  gpu: 'desc',
  mem: 'desc',
  uptime: 'desc',
}

/**
 * Ba mức cho thang màu: khoẻ · nên để ý · đang cao.
 *
 * Mọi ngưỡng đều SUY TỪ DUNG LƯỢNG THẬT của máy đang đo (số lõi, RAM vật lý), chứ
 * không phải vài con số chọn bừa. Lý do: cùng "2 GB" là bình thường trên máy 64 GB
 * và là báo động trên máy 8 GB; cùng "300% CPU" là một cú build lành mạnh trên máy
 * 10 lõi và là máy đang quỳ trên máy 2 lõi. Một thang không biết máy to bằng nào
 * thì màu đỏ của nó không mang thông tin gì.
 */
export type UsageLevel = 'ok' | 'warn' | 'high'

function level(ratio: number, warnAt: number, highAt: number): UsageLevel {
  if (ratio >= highAt) return 'high'
  if (ratio >= warnAt) return 'warn'
  return 'ok'
}

/**
 * CPU của MỘT tiến trình, theo % một lõi.
 * Mốc đỏ 90% = đang ghim trọn một lõi — cùng ngưỡng với cảnh báo "CPU cao kéo dài",
 * để màu trên bảng và thông báo không nói hai chuyện khác nhau.
 */
export function cpuLevel(percent: number | null): UsageLevel | null {
  if (percent === null) return null
  return level(percent, 50, 90)
}

/** CPU TỔNG, theo % công suất cả máy (số lõi × 100). */
export function totalCpuLevel(percent: number | null, coreCount: number): UsageLevel | null {
  if (percent === null) return null
  return level(percent / Math.max(1, coreCount), 30, 70)
}

/** RAM của MỘT tiến trình, theo % RAM vật lý. */
export function memLevel(rssKb: number, totalMemKb: number): UsageLevel | null {
  if (totalMemKb <= 0) return null
  return level((rssKb / totalMemKb) * 100, 2, 8)
}

/** RAM TỔNG, theo % RAM vật lý. */
export function totalMemLevel(rssKb: number, totalMemKb: number): UsageLevel | null {
  if (totalMemKb <= 0) return null
  return level((rssKb / totalMemKb) * 100, 25, 50)
}

/** GPU toàn máy — số đã là % rồi. */
export function gpuLevel(percent: number | null): UsageLevel | null {
  if (percent === null) return null
  return level(percent, 50, 85)
}

/** Màu của một mức. `--green` chứ KHÔNG phải `--accent`: accent do người dùng đổi
 *  được, đặt "khoẻ" theo accent thì ai chọn accent đỏ là thang màu mất nghĩa. */
export function levelColor(l: UsageLevel | null): string {
  if (l === 'high') return 'var(--danger)'
  if (l === 'warn') return 'var(--amber)'
  if (l === 'ok') return 'var(--green)'
  return 'var(--textDim)'
}

/** Phần đã dùng trên tổng dung lượng, 0..1 — cho vạch mức trên thẻ. */
export function cpuFill(percent: number | null, coreCount: number): number {
  if (percent === null) return 0
  return Math.min(1, percent / (Math.max(1, coreCount) * 100))
}

export function memFill(rssKb: number, totalMemKb: number): number {
  if (totalMemKb <= 0) return 0
  return Math.min(1, rssKb / totalMemKb)
}

export function formatCpuLoad(value: number | null): string {
  if (value === null) return '—'
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`
}

export function formatMem(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`
  return `${Math.round(kb / 1024)} MB`
}

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export function useMonitorManager() {
  const sidecar = useSidecar()
  const { confirm } = useConfirm()
  const toast = useToast()
  const { t } = useI18n()

  const snapshot = ref<MonitorSnapshot | null>(null)
  const error = ref('')
  const scope = ref<MonitorScope>('awog')
  /** Kết nối SSH đang xem. Chỉ có nghĩa khi scope = 'ssh'. */
  const sshConnId = ref('')
  const sshTargets = ref<SshTarget[]>([])
  const paused = ref(false)
  const sortKey = ref<MonitorSortKey>('cpu')
  const sortDir = ref<SortDir>('desc')

  /** Bấm tiêu đề cột: cùng cột thì đảo chiều, khác cột thì nhảy sang chiều mặc định của cột đó. */
  function toggleSort(key: MonitorSortKey): void {
    if (sortKey.value === key) {
      sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
      return
    }
    sortKey.value = key
    sortDir.value = DEFAULT_DIR[key]
  }
  const search = ref('')
  /** Gom tiến trình theo ứng dụng thay vì liệt kê phẳng. */
  const groupByApp = ref(false)
  const expandedApps = ref(new Set<string>())
  const killing = ref<number | null>(null)
  // pid đã nhận SIGTERM nhưng vẫn còn sống ở nhịp đo sau.
  //
  // Có thật và là lý do state này tồn tại: một tiến trình quay tít trong vòng lặp
  // chặt KHÔNG BAO GIỜ tới lượt chạy trình xử lý tín hiệu, nên SIGTERM rơi vào hư
  // không — đo được trên một sidecar mồ côi 18 giờ ở 99% CPU, đúng loại tiến trình
  // mà màn hình này sinh ra để bắt. Không có đường lên SIGKILL thì tính năng bất
  // lực ngay trước ca dùng chính của nó.
  const termSent = ref(new Set<number>())

  let timer: ReturnType<typeof setInterval> | null = null

  async function poll(): Promise<void> {
    if (paused.value) return
    // Chọn SSH mà chưa có kết nối nào ⇒ không gọi: sidecar sẽ ném, và một lỗi
    // mỗi 2 giây không nói thêm điều gì so với dòng trạng thái ở UI.
    if (scope.value === 'ssh' && !sshConnId.value) {
      snapshot.value = null
      return
    }
    try {
      const next = await sidecar.request<MonitorSnapshot>('monitor.sample', {
        scope: scope.value,
        ...(scope.value === 'ssh' ? { connId: sshConnId.value } : {}),
      })
      snapshot.value = next
      error.value = ''
      // Chết rồi thì quên — pid được cấp lại cho tiến trình khác, và một tiến
      // trình mới không được thừa hưởng nút "Giết ngay" của tiến trình đã chết.
      if (termSent.value.size > 0) {
        const alive = new Set([...next.processes, ...next.orphans].map((p) => p.pid))
        const remaining = new Set([...termSent.value].filter((pid) => alive.has(pid)))
        if (remaining.size !== termSent.value.size) termSent.value = remaining
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  /**
   * Kết nối SSH đang mở, hỏi thẳng sidecar thay vì đọc store `ssh`.
   *
   * Store chỉ có dữ liệu sau khi người dùng đã ghé trang SSH trong phiên này;
   * sidecar thì luôn biết kết nối nào đang sống. Trang giám sát mở độc lập với
   * trang SSH nên phải hỏi nguồn thật.
   */
  async function refreshSshTargets(): Promise<void> {
    try {
      const [conns, list] = await Promise.all([
        sidecar.request<{ connections: { connId: string; hostId: string }[] }>('ssh.connections'),
        sidecar.request<{ hosts: { id: string; name: string }[] }>('ssh.list'),
      ])
      const names = new Map(list.hosts.map((h) => [h.id, h.name]))
      sshTargets.value = conns.connections.map((c) => ({
        ...c,
        label: names.get(c.hostId) ?? c.hostId,
      }))
      // Kết nối đang xem đã đóng ⇒ rơi về máy này thay vì treo ở một bảng chết.
      if (scope.value === 'ssh' && !sshTargets.value.some((x) => x.connId === sshConnId.value)) {
        sshConnId.value = sshTargets.value[0]?.connId ?? ''
      }
    } catch {
      sshTargets.value = []
    }
  }

  function start(): void {
    if (timer) return
    // Bỏ mốc đo cũ: hiệu CPU tính trên một khoảng nghỉ dài là trung bình của cả
    // khoảng đó, không phải "bây giờ".
    void sidecar.request('monitor.reset').catch(() => {})
    void refreshSshTargets()
    void poll()
    timer = setInterval(() => void poll(), POLL_MS)
  }

  function stop(): void {
    if (!timer) return
    clearInterval(timer)
    timer = null
  }

  // Đổi phạm vi = đổi tập tiến trình: mốc CPU cũ không còn nghĩa gì, và một bảng
  // của máy khác hiện trong lúc chờ nhịp mới là bảng nói dối.
  watch([scope, sshConnId], () => {
    snapshot.value = null
    void sidecar.request('monitor.reset').catch(() => {})
    void poll()
  })

  onMounted(start)
  onActivated(start)
  onDeactivated(stop)
  onUnmounted(stop)

  const processes = computed<MonitorProcess[]>(() => {
    const all = snapshot.value?.processes ?? []
    const needle = search.value.trim().toLowerCase()
    const filtered = needle
      ? all.filter(
          (p) =>
            p.label.toLowerCase().includes(needle) ||
            p.command.toLowerCase().includes(needle) ||
            String(p.pid).includes(needle),
        )
      : all
    // `cpuPercent` null (nhịp đầu) xếp như -1: "chưa đo được" không được trộn lẫn
    // với "0%", và luôn nằm cuối khi sắp xếp lớn-trước.
    const by: Record<MonitorSortKey, (p: MonitorProcess) => number | string> = {
      name: (p) => p.label.toLowerCase(),
      pid: (p) => p.pid,
      cpu: (p) => p.cpuPercent ?? -1,
      gpu: (p) => p.gpuPercent ?? -1,
      mem: (p) => p.rssKb,
      uptime: (p) => p.elapsedSeconds,
    }
    const pick = by[sortKey.value]
    const dir = sortDir.value === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const x = pick(a)
      const y = pick(b)
      if (typeof x === 'string' && typeof y === 'string') return x.localeCompare(y) * dir
      return ((x as number) - (y as number)) * dir
    })
  })

  /**
   * Gom theo ứng dụng. Cộng CPU/GPU/RAM của mọi tiến trình con — đó mới là câu
   * trả lời cho "Chrome đang ăn bao nhiêu máy", vốn không đọc được từ hai mươi
   * dòng helper rời rạc.
   */
  const appGroups = computed<AppGroup[]>(() => {
    const byApp = new Map<string, MonitorProcess[]>()
    for (const p of processes.value) {
      const list = byApp.get(p.app)
      if (list) list.push(p)
      else byApp.set(p.app, [p])
    }
    const groups: AppGroup[] = []
    for (const [app, procs] of byApp) {
      let cpu: number | null = null
      let gpu: number | null = null
      let rss = 0
      for (const p of procs) {
        rss += p.rssKb
        if (p.cpuPercent !== null) cpu = (cpu ?? 0) + p.cpuPercent
        if (p.gpuPercent !== null) gpu = (gpu ?? 0) + p.gpuPercent
      }
      groups.push({
        app,
        procs: [...procs].sort((a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)),
        cpuPercent: cpu,
        gpuPercent: gpu,
        rssKb: rss,
        killable: procs.some(canKill),
      })
    }
    const pick = (g: AppGroup): number =>
      sortKey.value === 'mem'
        ? g.rssKb
        : sortKey.value === 'gpu'
          ? (g.gpuPercent ?? -1)
          : (g.cpuPercent ?? -1)
    const dir = sortDir.value === 'asc' ? 1 : -1
    return groups.sort((a, b) =>
      sortKey.value === 'name' ? a.app.localeCompare(b.app) * dir : (pick(a) - pick(b)) * dir,
    )
  })

  function toggleApp(app: string): void {
    const next = new Set(expandedApps.value)
    if (next.has(app)) next.delete(app)
    else next.add(app)
    expandedApps.value = next
  }

  /**
   * Dừng CẢ ứng dụng: gửi tín hiệu cho từng tiến trình dừng được của nó.
   *
   * Không cố đoán "tiến trình chính" rồi trông chờ nó kéo con theo — nhiều app
   * để tiến trình con sống sót, và đoán sai thì người dùng bấm xong vẫn thấy app
   * chạy. Một hộp xác nhận cho cả nhóm, nêu rõ số tiến trình.
   */
  async function killApp(group: AppGroup): Promise<void> {
    const victims = group.procs.filter(canKill)
    if (victims.length === 0) return
    const ok = await confirm({
      title: t('monitor.app.killTitle', { app: group.app }),
      description: t('monitor.app.killDesc', { n: victims.length, total: group.procs.length }),
      confirmLabel: t('monitor.app.killConfirm'),
      kind: 'danger',
    })
    if (!ok) return
    let failed = 0
    for (const p of victims) {
      try {
        await sidecar.request('monitor.kill', {
          pid: p.pid,
          ...(scope.value === 'ssh' && sshConnId.value ? { connId: sshConnId.value } : {}),
        })
        termSent.value = new Set([...termSent.value, p.pid])
      } catch {
        failed += 1
      }
    }
    toast.add({
      title: t('monitor.app.killDone', { app: group.app, n: victims.length - failed }),
      color: failed > 0 ? 'warning' : 'success',
    })
    await poll()
  }

  const sessions = computed(() => snapshot.value?.sessions ?? [])
  const orphans = computed(() => snapshot.value?.orphans ?? [])
  const totals = computed(
    () =>
      snapshot.value?.totals ?? {
        cpuPercent: null,
        gpuPercent: null,
        rssKb: 0,
        processCount: 0,
      },
  )
  const system = computed(() => snapshot.value?.system ?? null)
  const gpu = computed(
    () => snapshot.value?.gpu ?? { utilizationPercent: null, memoryUsedMb: null, source: null },
  )
  const coreCount = computed(() => snapshot.value?.coreCount ?? 1)
  const totalMemKb = computed(() => snapshot.value?.totalMemKb ?? 0)
  const warmingUp = computed(() => snapshot.value === null || snapshot.value.warmingUp)

  // Tiến trình ngốn nhất — câu trả lời trực tiếp cho "process nào đang chiếm nhiều nhất".
  const topProcess = computed<MonitorProcess | null>(() => {
    const ranked = [...(snapshot.value?.processes ?? []), ...(snapshot.value?.orphans ?? [])].sort(
      (a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1),
    )
    const first = ranked[0]
    return first && first.cpuPercent !== null ? first : null
  })

  // Tiến trình nào KHÔNG được phép dừng: hạ tầng của chính instance đang chạy.
  // Sidecar cưỡng chế lại luật này (pid từ UI là dữ liệu L1) — đây chỉ là để nút
  // không hiện ra rồi báo lỗi.
  function canKill(p: MonitorProcess): boolean {
    if (p.pid <= 1) return false
    // Máy từ xa: không có hạ tầng AWOG nào ở đó để tự bắn vào chân.
    if (scope.value === 'ssh') return true
    // ⚠ Luật "cấm giết renderer/sidecar/GPU" chỉ áp cho hạ tầng CỦA INSTANCE ĐANG
    // CHẠY. Áp cho mọi tiến trình là cách bản đầu tước nút dừng của mọi tiến trình
    // Chromium thuộc Chrome/Claude — và của cả sidecar AWOG MỒ CÔI, đúng thứ trang
    // này sinh ra để giết. Sidecar cưỡng chế lại bằng cùng một luật.
    if (p.own !== true) return true
    return ![
      'electron-main',
      'electron-renderer',
      'electron-gpu',
      'electron-utility',
      'sidecar',
    ].includes(p.kind)
  }

  async function kill(p: MonitorProcess, force = false): Promise<void> {
    const ok = await confirm({
      title: t('monitor.kill.title', { label: p.label, pid: String(p.pid) }),
      description: force ? t('monitor.kill.descForce') : t('monitor.kill.desc'),
      confirmLabel: force ? t('monitor.kill.confirmForce') : t('monitor.kill.confirm'),
      kind: 'danger',
    })
    if (!ok) return
    killing.value = p.pid
    try {
      await sidecar.request('monitor.kill', {
        pid: p.pid,
        force,
        ...(scope.value === 'ssh' && sshConnId.value ? { connId: sshConnId.value } : {}),
      })
      if (!force) termSent.value = new Set([...termSent.value, p.pid])
      toast.add({ title: t('monitor.kill.done', { pid: String(p.pid) }), color: 'success' })
      await poll()
    } catch (err) {
      toast.add({
        title: t('monitor.kill.failed', {
          error: err instanceof Error ? err.message : String(err),
        }),
        color: 'error',
      })
    } finally {
      killing.value = null
    }
  }

  return {
    snapshot,
    processes,
    sessions,
    orphans,
    totals,
    gpu,
    system,
    coreCount,
    totalMemKb,
    warmingUp,
    topProcess,
    error,
    scope,
    sshConnId,
    sshTargets,
    refreshSshTargets,
    truncated: computed(() => snapshot.value?.truncated === true),
    paused,
    sortKey,
    sortDir,
    toggleSort,
    groupByApp,
    appGroups,
    expandedApps,
    toggleApp,
    killApp,
    search,
    killing,
    canKill,
    // Đã gửi SIGTERM mà tiến trình vẫn còn ⇒ nút đổi thành "Giết ngay" (SIGKILL).
    needsForce: (pid: number): boolean => termSent.value.has(pid),
    kill,
    refresh: poll,
  }
}
