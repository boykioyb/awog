import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { copyText } from '~/utils/clipboard'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import { formatBytes } from '~/utils/format-bytes'
import {
  daemonSetStats,
  deploymentStats,
  endpointStats,
  eventFreshness,
  formatCpu,
  hpaStats,
  ingressStats,
  jobStats,
  latestRollout,
  nodeCapacity,
  nodeSummary,
  nodeUsage,
  parseAge,
  parseRestarts,
  pdbStats,
  podFailures,
  podUsage,
  podsByNode,
  pvcStats,
  quotaStats,
  restartsWithin,
  serviceStats,
  statefulSetStats,
  sumOf,
  warningEvents,
} from '~/utils/kube-report'
import type {
  DeployStat,
  EndpointStat,
  EventFreshness,
  EventGroup,
  HpaStat,
  IngressStat,
  NodeCapacity,
  NodePods,
  NodeUsage,
  PdbStat,
  PodFailure,
  PodUsage,
  PvcStat,
  QuotaStat,
  RolloutStat,
  ServiceStat,
  WorkloadStat,
} from '~/utils/kube-report'
import type { InfraKubeController } from '~/composables/useInfraKube'

// Số liệu của mục **Báo cáo** trong tab Kubernetes: các bảng kubectl gộp thành vài
// chỉ số, một danh sách việc phải xem, một điểm sức khoẻ, và một dải xu hướng khi
// người dùng bật theo dõi.
//
// LUẬT CỦA FILE NÀY.
//   · Nguồn số chỉ là các bảng kubectl đã đọc: `pods`/`deployments` (người dùng đã
//     nạp cho hai mục kia), `nodes`/`top nodes`/`top pods`/`events Warning` +
//     `describe nodes`/`hpa` nạp qua `kube.loadMetrics()`, và các bảng cấu trúc nạp
//     qua `kube.loadInventory()`. Không có nguồn nào khác, không có số nào suy diễn
//     từ AWS.
//   · Điểm sức khoẻ là một CÔNG THỨC, không phải phán quyết của AWS. Nó tự khai ra
//     điều đó ở mọi chỗ nó xuất hiện ("tự tính", "không phải SLA") — một con số
//     trông như điểm giám sát mà lại không phải thì tệ hơn không có điểm.
//   · Mỗi thành phần của điểm chỉ được tính khi CÓ nguồn. Cụm chưa cài
//     metrics-server không bị trừ điểm vì "không đọc được CPU" — thiếu số là thiếu
//     số, không phải hỏng.
//   · Theo dõi là hành động CÓ NGƯỜI BẤM và có TRẦN: mặc định tắt, tự dừng sau
//     `KUBE_WATCH_MAX_MS`, và dừng ngay khi component bị tháo (rời mục Báo cáo).
//     Luật "không auto-refresh" cấm nạp sau lưng người dùng; một vòng lặp người dùng
//     tự bật và tự thấy thì không phải sau lưng ai.
//   · MỞ mục Báo cáo thì nạp bốn bảng của nó MỘT lần (xem `onMounted`). Đó là làm
//     theo cú bấm vừa rồi, cùng hạng với việc chọn cluster xong thì nạp bảng —
//     không phải poll.

export type KubeRate = 'ok' | 'warn' | 'bad' | 'unknown'
/** Một ô số của màn Báo cáo (`KubeRepTiles.vue`). `rate` bỏ trống = ô trung tính,
 *  không tô màu — dùng cho những số chỉ là bối cảnh (vd "3 pod đã chạy xong"). */
export type KubeRepTile = {
  key: string
  label: string
  value: string
  sub?: string
  rate?: KubeRate
}
/** Một chip của `KubeRepChips.vue`: tên đối tượng + một con số + mức.
 *  Khai ở ĐÂY chứ không trong SFC vì `<script setup>` không cho `export`. */
export type ChipItem = { name: string; value: string; rate: 'ok' | 'warn' | 'bad' }
export type KubeStatusCount = { status: string; n: number }
export type KubeRestartTop = { name: string; n: number; ago: string }
/** Một mẫu của dải xu hướng. Sống trong BỘ NHỚ phiên — không ghi ra đĩa. */
export type KubeSample = {
  t: number
  notReady: number
  restarts: number
  score: number | null
  cpuPct: number | null
  /** RAM của node bận nhất. Thiếu nó thì biểu đồ chỉ kể một nửa: cụm hết RAM
   *  trước khi hết CPU là trường hợp phổ biến hơn, không phải ngược lại. */
  memPct: number | null
}

/** Một việc người trực phải làm gì đó với. `impact` = đang chạm tới người dùng;
 *  `risk` = chưa chạm nhưng sắp.
 *
 *  VÌ SAO HAI NHÓM CHỨ KHÔNG PHẢI MỘT DANH SÁCH "vấn đề". Người trực hỏi đúng một
 *  câu khi mở màn này: *có ai đang không dùng được không*. Trộn "Service không có
 *  endpoint" (khách đang nhận 503) chung với "hạn mức còn 12%" (tuần sau mới đau)
 *  là bắt họ tự phân loại lại, đúng lúc họ ít bình tĩnh nhất. */
/** `note` = dòng của "Nên xem": đáng biết, nhưng chưa tới mức chặn ai. Nó dùng
 *  CHUNG hình dạng với `impact`/`risk` để một dòng "pod X restart 7 lần" ở đâu
 *  trong màn cũng mở được log của đúng pod đó — trước 2026-09-17 khối này là một
 *  danh sách chữ trần, tức là bắt người trực gõ lại tên pod vào terminal. */
export type ReportItemKind = 'impact' | 'risk' | 'note'
export type ReportItem = {
  key: string
  kind: ReportItemKind
  /** Nhãn ngắn hiện thành chip, vd `CrashLoopBackOff`, `Rollout dở dang`. */
  label: string
  /** Tên đối tượng (pod/deployment/service…), hiện dạng mono. */
  object: string
  /** Câu giải thích một dòng. */
  text: string
  /** Pod để mở log/describe/terminal — chỉ có khi việc này gắn với MỘT pod. */
  pod?: string
  /** Lệnh kubectl chép được, đã kèm `-n <namespace>` khi có namespace ghim. */
  command?: string
}

/** Nhịp đọc khi bật theo dõi. */
export const KUBE_WATCH_SECONDS = 30
export const KUBE_WATCH_MS = KUBE_WATCH_SECONDS * 1000
/** Trần một phiên theo dõi: 15 phút ⇒ tối đa 30 lượt đọc rồi tự dừng. */
export const KUBE_WATCH_MAX_MS = 15 * 60_000
/** Trần số mẫu giữ lại: đủ để thấy xu hướng, không phải một mảng phình mãi. */
const MAX_SAMPLES = 60
/** Pod mới hơn mốc này được tính là "vừa lên" — dấu hiệu cụm đang xáo trộn. */
const FRESH_POD_SEC = 15 * 60
export const FRESH_POD_MIN = FRESH_POD_SEC / 60
/**
 * Lần khởi động lại "gần đây" là trong bao lâu.
 *
 * ⚠ Cần mốc này vì `(2m ago)` của kubectl KHÔNG có nghĩa là "vừa xảy ra": kubectl in
 * phần trong ngoặc mỗi khi container có `lastTerminationState`, nên một pod restart
 * từ 5 ngày trước cũng in `(5d ago)`. Lấy sự CÓ MẶT của ngoặc làm dấu hiệu "vừa
 * restart" (bản đầu của khối này) sẽ tô đỏ mọi cụm từng restart một lần trong đời.
 */
const RECENT_RESTART_SEC = 30 * 60
export const RECENT_RESTART_MIN = RECENT_RESTART_SEC / 60
/** Từ mức này trở lên thì một node bị coi là chật (CPU hoặc RAM). */
export const SATURATED_PCT = 80
/** Dưới mức này thì thành phần "chật chội" của điểm được điểm tối đa. */
const HEADROOM_PCT = 70
/** Bao nhiêu dòng trong các danh sách "nhiều nhất". */
const TOP_N = 5
/** Pod hiện trong một ô node. Ba là đủ để trả lời "ai đang ăn RAM" mà không biến
 *  ô node thành một bảng pod thứ hai — bảng đầy đủ đã ở mục Pods bên cạnh. */
const NODE_POD_TOP = 3
/** Đặt chỗ (requests) từ mức này là node coi như hết chỗ nhận pod mới — kể cả khi
 *  CPU thật đang rảnh. Cao hơn ngưỡng "đang dùng" vì đặt chỗ 85% là bình thường
 *  trong cụm chạy đúng cách; 92% thì pod tiếp theo bắt đầu `Pending`. */
const RESERVED_TIGHT_PCT = 92
/** Tỉ lệ ô pod đã dùng trên một node (`pods: 17` là trần cứng của kubelet). */
const POD_SLOT_TIGHT = 0.9
/** Cửa sổ "vừa xảy ra": pod vừa khởi động lại, cảnh báo vừa bắn. Ngắn có chủ đích —
 *  `kubectl get events` giữ event tới một giờ, nên "trong một giờ qua" gần như luôn
 *  có gì đó và người đọc học cách bỏ qua khối đó. */
const CHANGE_WINDOW_SEC = 15 * 60
export const CHANGE_WINDOW_MIN = CHANGE_WINDOW_SEC / 60
/** Cửa sổ rộng hơn, chỉ để đặt cạnh cái trên: 3 pod restart trong 15 phút và 3 pod
 *  restart trong một giờ là hai câu chuyện khác nhau. */
const RESTART_HOUR_SEC = 3600
/** Hạn mức dùng tới mức này là sắp hết chỗ — pod tiếp theo bị API server từ chối
 *  thẳng, không có pod `Pending` nào để mà nhìn. */
const QUOTA_TIGHT_PCT = 85
/** Số dòng của lệnh log gợi ý. */
const PREV_LOG_TAIL = 200

/** `"2/3"` ⇒ `{ ready: 2, total: 3 }`. Không đúng dạng ⇒ `null` (thà bỏ qua còn
 *  hơn đoán bừa một con số rồi đem đi chấm điểm). */
export function splitReady(cell: string): { ready: number; total: number } | null {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(cell.trim())
  if (!m) return null
  const ready = Number(m[1])
  const total = Number(m[2])
  if (!Number.isFinite(ready) || !Number.isFinite(total)) return null
  return { ready, total }
}

/** Pod đã chạy xong (Job/CronJob) không phải pod hỏng — chấm nó là "chưa sẵn sàng"
 *  sẽ biến mọi cụm có CronJob thành cụm đỏ. */
function isFinished(status: string): boolean {
  const s = status.toLowerCase()
  return s.startsWith('completed') || s.startsWith('succeeded')
}

/** Mức nghiêm trọng của một trạng thái pod, dùng cho thanh phân bố và cho đèn. */
export function statusRate(status: string): KubeRate {
  const s = status.toLowerCase()
  if (isFinished(s)) return 'ok'
  if (s.startsWith('running')) return 'ok'
  if (s.startsWith('pending') || s.startsWith('containercreating') || s.startsWith('init')) {
    return 'warn'
  }
  if (
    s.startsWith('crashloop') ||
    s.startsWith('error') ||
    s.startsWith('imagepull') ||
    s.startsWith('errimagepull') ||
    s.startsWith('evicted') ||
    s.startsWith('failed') ||
    s.startsWith('unknown') ||
    s.startsWith('terminating')
  ) {
    return 'bad'
  }
  return 'warn'
}

/** Mức của một tỉ lệ phần trăm sử dụng — dùng cho dải CPU/RAM của node. */
export function usageRate(pct: number | null): KubeRate {
  if (pct === null) return 'unknown'
  if (pct >= 90) return 'bad'
  if (pct >= SATURATED_PCT) return 'warn'
  return 'ok'
}

export function useInfraKubeReport(kube: InfraKubeController) {
  const { t } = useI18n()
  const toast = useToast()
  const { askAgent } = useInfraAskAgent()

  const whereLabel = computed(() => {
    const cluster = kube.pinnedCluster.value
    if (!cluster) return '—'
    const ns = kube.pinnedNamespace.value
    return ns ? `${cluster}/${ns}` : cluster
  })

  const busy = computed(() => kube.workloadBusy.value || kube.metricsLoading.value)

  // ── Pod: đếm theo trạng thái + khởi động lại + tuổi ────────────────────────
  const pods = computed(() => {
    const byStatus = new Map<string, number>()
    const restartsBy: KubeRestartTop[] = []
    let ready = 0
    let notReady = 0
    let finished = 0
    let restarts = 0
    /** Pod có lần restart trong `RECENT_RESTART_SEC` vừa qua. */
    let recent = 0
    let fresh = 0
    /** Lần restart MỚI NHẤT của cả namespace (pod nào, cách đây bao lâu). */
    let last: { name: string; ago: string; sec: number } | null = null
    const notReadyNames: string[] = []

    for (const row of kube.pods.value) {
      const rate = splitReady(row.cells[0] ?? '')
      const status = (row.cells[1] ?? '').trim() || '—'
      if (rate && rate.total > 0 && rate.ready >= rate.total) ready += 1
      else if (isFinished(status)) finished += 1
      else {
        notReady += 1
        if (notReadyNames.length < 3) notReadyNames.push(`${row.name} (${status})`)
      }

      byStatus.set(status, (byStatus.get(status) ?? 0) + 1)

      // Ô RESTARTS không phải số trần: `3 (2m ago)`. Xem `parseRestarts`.
      const restart = parseRestarts(row.cells[2] ?? '')
      restarts += restart.n
      if (restart.n > 0) restartsBy.push({ name: row.name, n: restart.n, ago: restart.ago })
      const agoSec = parseAge(restart.ago)
      if (agoSec !== null) {
        if (agoSec <= RECENT_RESTART_SEC) recent += 1
        if (last === null || agoSec < last.sec) {
          last = { name: row.name, ago: restart.ago, sec: agoSec }
        }
      }

      const age = parseAge(row.cells[3] ?? '')
      if (age !== null && age <= FRESH_POD_SEC) fresh += 1
    }

    restartsBy.sort((a, b) => b.n - a.n)
    const statuses: KubeStatusCount[] = [...byStatus.entries()]
      .map(([status, n]) => ({ status, n }))
      .sort((a, b) => b.n - a.n)

    return {
      total: kube.pods.value.length,
      /** Số pod ĐƯỢC CHẤM (trừ pod đã chạy xong). */
      judged: ready + notReady,
      ready,
      notReady,
      finished,
      restarts,
      recent,
      fresh,
      last,
      statuses,
      top: restartsBy.slice(0, TOP_N),
      notReadyNames,
    }
  })

  // ── Deployment: bao nhiêu cái đủ bản sao ───────────────────────────────────
  /**
   * Số đếm bản sao ĐI QUA `deploymentStats` chứ không tự đọc `cells[0]` nữa: cột
   * READY một mình KHÔNG phân biệt pod bản cũ với pod bản mới, nên một rollout kẹt
   * vẫn in `9/9` trong khi bản mới không bao giờ lên. `rollingOut` (`UP-TO-DATE <
   * desired`) là chỗ duy nhất tố cáo chuyện đó — xem docblock của `deploymentStats`.
   */
  const deploys = computed(() => {
    const list: DeployStat[] = deploymentStats(kube.deployments.value)
    const behind: string[] = []
    let desired = 0
    let ready = 0
    let full = 0
    for (const d of list) {
      if (d.desired <= 0) continue
      desired += d.desired
      ready += Math.min(d.ready, d.desired)
      if (d.ready >= d.desired) full += 1
      else if (behind.length < 3) behind.push(`${d.name} (${d.ready}/${d.desired})`)
    }
    return {
      total: list.length,
      full,
      desired,
      ready,
      behind,
      list,
      /** Bản mới chưa thay xong bản cũ — `READY` vẫn đủ nên không dải bar nào thấy. */
      stuck: list.filter((d) => d.rollingOut),
    }
  })

  // ── Node ───────────────────────────────────────────────────────────────────
  const nodesStat = computed(() => nodeSummary(kube.nodes.value))
  const hasNodes = computed(() => nodesStat.value.total > 0)

  // ── CPU / RAM ──────────────────────────────────────────────────────────────
  /** Một hàng `kubectl top nodes`, đã bóc số. */
  const nodeUse = computed<NodeUsage[]>(() => nodeUsage(kube.topNodes.value))

  /**
   * Mức chật của cụm = MAX của các node, không phải trung bình.
   *
   * Trung bình che đúng cái cần thấy: ba node rảnh và một node 98% cho ra 30% —
   * một con số đẹp cho một cụm đang sắp evict pod trên node thứ tư.
   */
  const saturation = computed(() => {
    const cpu = nodeUse.value.map((n) => n.cpuPct)
    const mem = nodeUse.value.map((n) => n.memPct)
    const known = (list: (number | null)[]): number[] => list.filter((v): v is number => v !== null)
    const cpuKnown = known(cpu)
    const memKnown = known(mem)
    return {
      maxCpuPct: cpuKnown.length ? Math.max(...cpuKnown) : null,
      maxMemPct: memKnown.length ? Math.max(...memKnown) : null,
      /** Node đã vượt ngưỡng chật (CPU hoặc RAM) — chỗ nên xem trước. */
      tight: nodeUse.value.filter(
        (n) => (n.cpuPct ?? 0) >= SATURATED_PCT || (n.memPct ?? 0) >= SATURATED_PCT,
      ),
    }
  })

  const podUse = computed<PodUsage[]>(() => podUsage(kube.topPods.value))

  const usage = computed(() => {
    const list = podUse.value
    const cpuTotal = sumOf(list.map((p) => p.cpuMilli))
    const memTotal = sumOf(list.map((p) => p.memBytes))
    const topCpu = [...list]
      .filter((p) => p.cpuMilli !== null)
      .sort((a, b) => (b.cpuMilli ?? 0) - (a.cpuMilli ?? 0))
      .slice(0, TOP_N)
    const topMem = [...list]
      .filter((p) => p.memBytes !== null)
      .sort((a, b) => (b.memBytes ?? 0) - (a.memBytes ?? 0))
      .slice(0, TOP_N)
    return {
      n: list.length,
      cpuTotal,
      memTotal,
      cpuLabel: cpuTotal === null ? '—' : formatCpu(cpuTotal),
      memLabel: memTotal === null ? '—' : formatBytes(memTotal),
      topCpu,
      topMem,
    }
  })

  /**
   * Pod nào đang nằm trên node nào — nối cột NODE của `kubectl get pods -o wide`
   * với số RAM/CPU của `kubectl top pods`.
   *
   * Không có nó thì dải "node RAM 100%" là một ngõ cụt: người đọc biết máy nào
   * đầy nhưng phải mở terminal để biết vì ai.
   */
  const nodePods = computed<Map<string, NodePods>>(() =>
    podsByNode(kube.pods.value, podUse.value, NODE_POD_TOP),
  )

  const hasUsage = computed(() => nodeUse.value.length > 0 || podUse.value.length > 0)

  // ── Sức chứa: đã đặt chỗ bao nhiêu, còn nhận được pod nào không ───────────
  /**
   * `kubectl describe nodes` → sức chứa từng node, khoá theo tên để ghép với dải
   * "đang dùng" của `kubectl top`.
   *
   * Hai con số này trả lời hai câu KHÁC NHAU và báo cáo cần cả hai: "đang dùng"
   * nói cụm có đang tải nặng không, "đã đặt chỗ" nói cụm có nhận thêm pod được
   * không. Một node dùng 9% mà đặt chỗ 98% thì không nhận pod nào nữa — nhìn mỗi
   * dải `top` thì nó trông rảnh rang.
   */
  const capacityByNode = computed<Map<string, NodeCapacity>>(
    () => new Map(nodeCapacity(kube.describeNodes.value).map((c) => [c.name, c])),
  )
  const hasCapacity = computed(() => capacityByNode.value.size > 0)

  /** Node đã đặt chỗ quá `RESERVED_TIGHT_PCT` CPU hoặc RAM — hết chỗ cho pod mới. */
  const packedNodes = computed<NodeCapacity[]>(() =>
    [...capacityByNode.value.values()].filter(
      (c) => (c.cpuReqPct ?? 0) >= RESERVED_TIGHT_PCT || (c.memReqPct ?? 0) >= RESERVED_TIGHT_PCT,
    ),
  )

  /** Node sắp hết chỗ ĐẶT POD (số lượng, không phải CPU/RAM): `pods: 17` là trần thật. */
  const podSlotTight = computed<NodeCapacity[]>(() =>
    [...capacityByNode.value.values()].filter(
      (c) =>
        c.podCapacity !== null &&
        c.podCount !== null &&
        c.podCapacity > 0 &&
        c.podCount / c.podCapacity >= POD_SLOT_TIGHT,
    ),
  )

  // ── Tự co giãn (HPA) ──────────────────────────────────────────────────────
  const hpa = computed(() => {
    const list: HpaStat[] = hpaStats(kube.hpa.value)
    return {
      list,
      total: list.length,
      atMax: list.filter((h) => h.atMax),
      unknown: list.filter((h) => h.unknown),
    }
  })

  // ── Workload KHÔNG phải Deployment ────────────────────────────────────────
  /**
   * Ba loại gộp thành MỘT khối vì người đọc hỏi một câu duy nhất: "ngoài
   * Deployment ra còn gì đang không ổn". Tách ba khối cho ba loại thì hai trong ba
   * khối hầu như luôn trống và chiếm chỗ của thứ đáng xem.
   */
  const otherWorkloads = computed(() => {
    const sts: WorkloadStat[] = statefulSetStats(kube.statefulSets.value)
    const ds: WorkloadStat[] = daemonSetStats(kube.daemonSets.value)
    const jobs: WorkloadStat[] = jobStats(kube.jobs.value)
    const bad = [...sts, ...ds, ...jobs].filter((w) => !w.ok)
    return {
      sts,
      ds,
      jobs,
      total: sts.length + ds.length + jobs.length,
      bad,
      badJobs: jobs.filter((j) => !j.ok),
    }
  })

  // ── Lưu trữ + mạng ────────────────────────────────────────────────────────
  const storage = computed(() => {
    const list: PvcStat[] = pvcStats(kube.pvc.value)
    const bytes = sumOf(list.map((v) => v.bytes))
    return {
      list,
      total: list.length,
      unbound: list.filter((v) => !v.bound),
      bytes,
      label: bytes === null ? '—' : formatBytes(bytes),
    }
  })

  const network = computed(() => {
    const svc: ServiceStat[] = serviceStats(kube.services.value)
    const ing: IngressStat[] = ingressStats(kube.ingresses.value)
    return {
      svc,
      ing,
      total: svc.length + ing.length,
      pending: [
        ...svc.filter((x) => x.pending).map((x) => x.name),
        ...ing.filter((x) => x.pending).map((x) => x.name),
      ],
    }
  })

  // ── Event Warning ──────────────────────────────────────────────────────────
  const eventGroups = computed<EventGroup[]>(() => warningEvents(kube.events.value))
  const eventStat = computed(() => {
    const groups = eventGroups.value
    return {
      groups: groups.slice(0, TOP_N),
      more: Math.max(0, groups.length - TOP_N),
      lines: groups.reduce((acc, g) => acc + g.count, 0),
      bad: groups.filter((g) => g.rate === 'bad').length,
    }
  })

  // ── Việc phải xem: đang chạm người dùng vs sắp chạm ────────────────────────
  /** Pod đang KHÔNG phục vụ, nặng trước (OOMKilled/CrashLoop trước Pending). */
  const failures = computed<PodFailure[]>(() => podFailures(kube.pods.value))
  /** Số pod CÓ lần khởi động lại trong cửa sổ — không phải tổng tích luỹ, xem
   *  docblock của `restartsWithin`. */
  const restarts15 = computed<number>(() => restartsWithin(kube.pods.value, CHANGE_WINDOW_SEC))
  const restarts60 = computed<number>(() => restartsWithin(kube.pods.value, RESTART_HOUR_SEC))
  /** Cảnh báo VỪA bắn, tách khỏi cảnh báo còn sót của lần hỏng hôm kia. */
  const eventFresh = computed<EventFreshness>(() =>
    eventFreshness(eventGroups.value, CHANGE_WINDOW_SEC),
  )
  /** Ai đang đứng sau mỗi Service. Rỗng = mọi request vào đó rơi vào hư vô. */
  const endpoints = computed<EndpointStat[]>(() => endpointStats(kube.endpoints.value))
  const quota = computed<QuotaStat[]>(() => quotaStats(kube.resourceQuota.value))
  const pdbs = computed<PdbStat[]>(() => pdbStats(kube.pdb.value))
  /** Bản mới ra cách đây bao lâu — câu hỏi đầu tiên khi một dịch vụ vừa hỏng. */
  const rollout = computed<RolloutStat | null>(() => latestRollout(kube.replicaSets.value))
  /** Node đang báo `MemoryPressure`/`DiskPressure`/… — `kubectl get nodes` vẫn in
   *  `Ready` cho chúng, nên bảng node một mình không bao giờ thấy được. */
  const pressured = computed<NodeCapacity[]>(() =>
    [...capacityByNode.value.values()].filter((c) => c.conditions.length > 0),
  )

  const endpointsEmpty = computed<EndpointStat[]>(() => endpoints.value.filter((e) => e.empty))
  const pdbBlocked = computed<PdbStat[]>(() => pdbs.value.filter((p) => p.blocked))
  /** Dòng hạn mức đã dùng từ `QUOTA_TIGHT_PCT` trở lên, kèm tên quota chứa nó. */
  const quotaTight = computed(() =>
    quota.value.flatMap((q) =>
      q.entries
        .filter((e) => e.pct !== null && e.pct >= QUOTA_TIGHT_PCT)
        .map((entry) => ({ quota: q.name, entry })),
    ),
  )

  /**
   * Lệnh chép được. `-n <namespace>` đi kèm khi có namespace ghim; KHÔNG có
   * `--context` — ngữ cảnh cluster đi bằng đường khác (sidecar tự gắn khi nó CHẠY
   * lệnh), còn dòng này là để người dùng dán vào terminal của chính họ, nơi context
   * hiện hành đã là cái họ vừa chọn.
   */
  function cmd(command: string): string {
    const ns = kube.pinnedNamespace.value
    return ns ? `${command} -n ${ns}` : command
  }

  /**
   * Danh sách việc, thứ tự = thứ tự nên xử lý.
   *
   * Một deployment `rollingOut` KHÔNG bị kể lần thứ hai ở nhóm "thiếu bản sao": đó
   * là cùng một sự việc nhìn từ hai cột, và hai dòng cho một sự việc làm người đọc
   * đi tìm hai nguyên nhân.
   */
  const items = computed<ReportItem[]>(() => {
    const out: ReportItem[] = []

    for (const f of failures.value) {
      // Container đã chết ⇒ log của lần chạy TRƯỚC mới có nguyên nhân; log của lần
      // hiện tại là log của lần khởi động lại mới nhất và thường còn trống.
      const stopped = f.kind === 'crashloop' || f.kind === 'oomkilled'
      out.push({
        key: `fail:${f.name}`,
        kind: 'impact',
        label: t(`infra.kube.report.fail.${f.kind}`),
        object: f.name,
        text:
          f.kind === 'pending'
            ? t('infra.kube.report.failPending')
            : f.restarts > 0 && f.ago
              ? t('infra.kube.report.failRestarts', { n: f.restarts, ago: f.ago })
              : f.status,
        pod: f.name,
        command: cmd(
          stopped
            ? `kubectl logs ${f.name} --previous --tail ${PREV_LOG_TAIL}`
            : `kubectl describe pod ${f.name}`,
        ),
      })
    }

    for (const d of deploys.value.stuck) {
      out.push({
        key: `rollout:${d.name}`,
        kind: 'impact',
        label: t('infra.kube.report.m.rolloutStuck'),
        object: d.name,
        text: t('infra.kube.report.detail.rollout', {
          n: 1,
          list: t('infra.kube.report.rolloutStuck', { done: d.upToDate ?? 0, total: d.desired }),
        }),
        command: cmd(`kubectl rollout undo deployment/${d.name}`),
      })
    }

    for (const d of deploys.value.list) {
      if (d.rollingOut || d.desired <= 0 || d.ready >= d.desired) continue
      out.push({
        key: `replicas:${d.name}`,
        kind: 'impact',
        label: t('infra.kube.report.replicas', { ready: d.ready, n: d.desired }),
        object: d.name,
        text: t('infra.kube.report.detail.deploys', { n: 1, list: `${d.ready}/${d.desired}` }),
      })
    }

    for (const e of endpointsEmpty.value) {
      out.push({
        key: `endpoint:${e.name}`,
        kind: 'impact',
        label: t('infra.kube.report.endpointsN', { n: 0 }),
        object: e.name,
        text: t('infra.kube.report.detail.endpoints', { n: 1, list: e.name }),
      })
    }

    for (const n of nodesStat.value.notReady) {
      out.push({
        key: `node:${n.name}`,
        kind: 'impact',
        label: n.status,
        object: n.name,
        text: t('infra.kube.report.detail.nodes', { n: 1, list: n.status }),
      })
    }

    for (const { quota: name, entry } of quotaTight.value) {
      out.push({
        key: `quota:${name}:${entry.resource}`,
        kind: 'risk',
        label: t('infra.kube.report.quota'),
        object: `${name}/${entry.resource}`,
        text: t('infra.kube.report.detail.quota', {
          list: `${entry.resource} ${entry.used}/${entry.hard} (${pct(entry.pct)})`,
        }),
      })
    }

    for (const p of pdbBlocked.value) {
      out.push({
        key: `pdb:${p.name}`,
        kind: 'risk',
        label: t('infra.kube.report.pdbBlocked'),
        object: p.name,
        text: t('infra.kube.report.detail.pdb', { n: 1, list: p.name }),
      })
    }

    for (const h of hpa.value.atMax) {
      out.push({
        key: `hpa:${h.name}`,
        kind: 'risk',
        label: t('infra.kube.report.replicas', { ready: h.replicas ?? 0, n: h.max ?? 0 }),
        object: h.name,
        text: t('infra.kube.report.detail.hpaMax', { n: 1, list: h.targets || '—' }),
      })
    }

    for (const c of packedNodes.value) {
      out.push({
        key: `packed:${c.name}`,
        kind: 'risk',
        label: t('infra.kube.report.reservedPct', {
          n: Math.max(c.cpuReqPct ?? 0, c.memReqPct ?? 0),
        }),
        object: c.name,
        text: t('infra.kube.report.detail.packed', {
          n: 1,
          node: c.name,
          cpu: pct(c.cpuReqPct),
          mem: pct(c.memReqPct),
        }),
      })
    }

    for (const c of podSlotTight.value) {
      out.push({
        key: `slots:${c.name}`,
        kind: 'risk',
        label: t('infra.kube.report.podSlots', {
          used: c.podCount ?? 0,
          cap: c.podCapacity ?? 0,
        }),
        object: c.name,
        text: t('infra.kube.report.detail.podSlots', {
          n: 1,
          node: c.name,
          used: c.podCount ?? 0,
          cap: c.podCapacity ?? 0,
        }),
      })
    }

    for (const c of pressured.value) {
      const list = c.conditions.join(', ')
      out.push({
        key: `cond:${c.name}`,
        kind: 'risk',
        label: list,
        object: c.name,
        text: t('infra.kube.report.detail.conditions', { n: 1, list }),
      })
    }

    return out
  })

  const impacts = computed<ReportItem[]>(() => items.value.filter((i) => i.kind === 'impact'))
  const risks = computed<ReportItem[]>(() => items.value.filter((i) => i.kind === 'risk'))

  /** Câu của hero. Không có impact ⇒ nói đúng một câu: chưa ai bị ảnh hưởng. Rủi ro
   *  chỉ được nối thêm khi ĐÃ có impact — một dòng "0 đang ảnh hưởng · 3 sắp hỏng"
   *  đọc như báo động, mà nó không phải. */
  const statusLine = computed<{ text: string; bad: boolean }>(() => {
    const n = impacts.value.length
    if (n === 0) return { text: t('infra.kube.report.impactNone'), bad: false }
    const risk = risks.value.length
    const head = t('infra.kube.report.impactN', { n })
    return {
      text: risk > 0 ? `${head} · ${t('infra.kube.report.riskN', { n: risk })}` : head,
      bad: true,
    }
  })

  const hasData = computed(() => pods.value.total > 0 || deploys.value.total > 0)
  /** Đã đọc được ÍT NHẤT một bảng nào đó (kể cả chỉ có node). */
  const hasAny = computed(() => hasData.value || hasNodes.value || hasUsage.value)

  /**
   * Điểm sức khoẻ 0–100. Năm thành phần, mỗi phần CHỈ tính khi có nguồn:
   *   40% pod sẵn sàng · 20% bản sao deployment · 20% node Ready ·
   *   10% mức khởi động lại · 10% mức chật CPU/RAM.
   * Trọng số được chuẩn hoá theo tổng các phần CÓ MẶT, nên một cụm chỉ đọc được
   * pod vẫn ra điểm trên cùng thang 0–100.
   */
  const score = computed<number | null>(() => {
    const p = pods.value
    const d = deploys.value
    const n = nodesStat.value
    const sat = saturation.value
    const parts: { w: number; v: number }[] = []
    if (p.judged > 0) parts.push({ w: 0.4, v: p.ready / p.judged })
    if (d.desired > 0) parts.push({ w: 0.2, v: d.ready / d.desired })
    if (n.total > 0) parts.push({ w: 0.2, v: n.ready / n.total })
    if (p.total > 0) {
      // 5 lần khởi động lại / pod là mức "hết điểm" của thành phần này.
      parts.push({ w: 0.1, v: Math.max(0, 1 - p.restarts / (p.total * 5)) })
    }
    const worst = Math.max(sat.maxCpuPct ?? -1, sat.maxMemPct ?? -1)
    if (worst >= 0) {
      // <=70% ⇒ đủ chỗ, tính điểm tối đa; 100% ⇒ 0 điểm; giữa thì tuyến tính.
      parts.push({ w: 0.1, v: Math.max(0, Math.min(1, (100 - worst) / (100 - HEADROOM_PCT))) })
    }
    if (parts.length === 0) return null
    const wsum = parts.reduce((acc, part) => acc + part.w, 0)
    const value = parts.reduce((acc, part) => acc + part.w * part.v, 0) / wsum
    return Math.round(value * 100)
  })

  const lamp = computed<KubeRate>(() => {
    if (!hasAny.value) return 'unknown'
    const p = pods.value
    const d = deploys.value
    if (p.notReady > 0 || d.ready < d.desired || nodesStat.value.notReady.length > 0) return 'bad'
    if (eventStat.value.bad > 0) return 'bad'
    if (
      p.restarts > 0 ||
      eventStat.value.groups.length > 0 ||
      saturation.value.tight.length > 0 ||
      (score.value !== null && score.value < 100)
    ) {
      return 'warn'
    }
    return 'ok'
  })

  const lampText = computed(() => t(`infra.kube.report.lamp.${lamp.value}`))

  /** Những câu nói RÕ cái gì đang lệch — dùng cho cả màn hình và bản sao chép.
   *  Thứ tự = thứ tự nên xem, nên câu đầu cũng là câu hiện cạnh điểm. */
  /** Một dòng "Nên xem". `text` giữ NGUYÊN câu cũ vì `reportText` (bản chép ra và
   *  nút "Hỏi agent") đọc đúng chuỗi đó; phần thêm vào chỉ là chip phân loại và —
   *  khi dòng nói về MỘT pod — đường mở log của nó. */
  function note(
    key: string,
    tag: string,
    text: string,
    extra?: { pod?: string; command?: string },
  ): ReportItem {
    return {
      key,
      kind: 'note',
      label: t(`infra.kube.report.tag.${tag}`),
      object: '',
      text,
      ...extra,
    }
  }

  /** Pod đáng mở log nhất khi nói về khởi động lại: cái vừa restart gần nhất, không
   *  có thì cái restart nhiều nhất. `--previous` vì container đã chết — log lần
   *  chạy hiện tại thường còn trống. */
  function restartNote(): { pod: string; command: string } | undefined {
    const p = pods.value
    const name = p.last?.name ?? p.top[0]?.name ?? ''
    if (!name) return undefined
    return { pod: name, command: cmd(`kubectl logs ${name} --previous --tail ${PREV_LOG_TAIL}`) }
  }

  const findings = computed<ReportItem[]>(() => {
    const out: ReportItem[] = []
    const p = pods.value
    const d = deploys.value
    const n = nodesStat.value
    const sat = saturation.value
    if (n.notReady.length > 0) {
      out.push(
        note(
          'nodes',
          'nodes',
          t('infra.kube.report.detail.nodes', {
            n: n.notReady.length,
            list: n.notReady.map((x) => `${x.name} (${x.status})`).join(', '),
          }),
        ),
      )
    }
    // Pod đang KHÔNG phục vụ đứng trước con số "chưa sẵn sàng": cái sau là một
    // phép đếm, cái trước nói tên và lý do.
    if (failures.value.length > 0) {
      out.push(
        note(
          'fail',
          'pods',
          t('infra.kube.report.detail.fail', {
            n: failures.value.length,
            list: failures.value
              .slice(0, 3)
              .map((f) => `${f.name} (${f.status})`)
              .join(', '),
          }),
        ),
      )
    }
    if (p.notReady > 0) {
      out.push(
        note(
          'notReady',
          'pods',
          t('infra.kube.report.detail.notReady', {
            n: p.notReady,
            list: p.notReadyNames.join(', '),
          }),
        ),
      )
    }
    if (d.desired > 0 && d.ready < d.desired) {
      out.push(
        note(
          'deploys',
          'deploys',
          t('infra.kube.report.detail.deploys', {
            n: d.desired - d.ready,
            list: d.behind.join(', '),
          }),
        ),
      )
    }
    // Rollout dở dang KHÔNG hiện ra ở bất kỳ con số nào phía trên: `READY` vẫn đủ
    // vì pod bản cũ còn đang phục vụ.
    if (deploys.value.stuck.length > 0) {
      out.push(
        note(
          'rollout',
          'deploys',
          t('infra.kube.report.detail.rollout', {
            n: deploys.value.stuck.length,
            list: deploys.value.stuck
              .map((d) => `${d.name} (${d.upToDate ?? 0}/${d.desired})`)
              .join(', '),
          }),
        ),
      )
    }
    if (endpointsEmpty.value.length > 0) {
      out.push(
        note(
          'endpoints',
          'network',
          t('infra.kube.report.detail.endpoints', {
            n: endpointsEmpty.value.length,
            list: endpointsEmpty.value.map((e) => e.name).join(', '),
          }),
        ),
      )
    }
    if (eventStat.value.groups.length > 0) {
      const first = eventStat.value.groups[0]
      out.push(
        note(
          'events',
          'events',
          t('infra.kube.report.detail.events', {
            n: eventStat.value.lines,
            reason: first?.reason ?? '',
            object: first?.object ?? '',
          }),
        ),
      )
    }
    if (p.restarts > 0) {
      // Có lần restart trong nửa giờ vừa rồi ⇒ câu nói RÕ cái mới nhất; còn lại thì
      // chỉ là tổng số lần restart từ trước tới nay, đọc như bối cảnh.
      out.push(
        note(
          'restartsRecent',
          'restarts',
          p.recent > 0 && p.last
            ? t('infra.kube.report.detail.restartsRecent', {
                n: p.restarts,
                top: p.last.name,
                ago: p.last.ago,
                recent: p.recent,
                min: RECENT_RESTART_MIN,
              })
            : t('infra.kube.report.detail.restarts', {
                n: p.restarts,
                top: p.top[0]?.name ?? '',
              }),
          restartNote(),
        ),
      )
    }
    if (restarts15.value > 0) {
      out.push(
        note(
          'restartRate',
          'restarts',
          t('infra.kube.report.detail.restartRate', {
            n: restarts15.value,
            min: CHANGE_WINDOW_MIN,
          }),
        ),
      )
    }
    if (sat.tight.length > 0) {
      const first = sat.tight[0]
      out.push(
        note(
          'tight',
          'capacity',
          t('infra.kube.report.detail.tight', {
            n: sat.tight.length,
            node: first?.name ?? '',
            cpu:
              first?.cpuPct === null || first === undefined ? '—' : `${Math.round(first.cpuPct)}%`,
            mem:
              first?.memPct === null || first === undefined ? '—' : `${Math.round(first.memPct)}%`,
          }),
        ),
      )
    }
    // Đặt chỗ đầy đứng TRƯỚC cordon/lệch phiên bản: nó là lý do số một khiến pod
    // mới `Pending`, và nó không nhìn thấy được ở bất kỳ dải bar nào khác.
    if (packedNodes.value.length > 0) {
      const first = packedNodes.value[0]
      out.push(
        note(
          'packed',
          'capacity',
          t('infra.kube.report.detail.packed', {
            n: packedNodes.value.length,
            node: first?.name ?? '',
            cpu: first?.cpuReqPct === null || first === undefined ? '—' : `${first.cpuReqPct}%`,
            mem: first?.memReqPct === null || first === undefined ? '—' : `${first.memReqPct}%`,
          }),
        ),
      )
    }
    if (podSlotTight.value.length > 0) {
      const first = podSlotTight.value[0]
      out.push(
        note(
          'podSlots',
          'capacity',
          t('infra.kube.report.detail.podSlots', {
            n: podSlotTight.value.length,
            node: first?.name ?? '',
            used: first?.podCount ?? 0,
            cap: first?.podCapacity ?? 0,
          }),
        ),
      )
    }
    // Node bị ép đi cùng nhóm sức chứa: `kubectl get nodes` in `Ready` cho nó, nên
    // không có dòng này thì cụm sắp evict pod trông y hệt cụm khoẻ.
    if (pressured.value.length > 0) {
      out.push(
        note(
          'conditions',
          'pressure',
          t('infra.kube.report.detail.conditions', {
            n: pressured.value.length,
            list: pressured.value.map((c) => `${c.name} (${c.conditions.join(', ')})`).join(', '),
          }),
        ),
      )
    }
    if (hpa.value.atMax.length > 0) {
      out.push(
        note(
          'hpaMax',
          'hpa',
          t('infra.kube.report.detail.hpaMax', {
            n: hpa.value.atMax.length,
            list: hpa.value.atMax.map((h) => `${h.name} (${h.replicas}/${h.max})`).join(', '),
          }),
        ),
      )
    }
    if (hpa.value.unknown.length > 0) {
      out.push(
        note(
          'hpaUnknown',
          'hpa',
          t('infra.kube.report.detail.hpaUnknown', {
            list: hpa.value.unknown.map((h) => h.name).join(', '),
          }),
        ),
      )
    }
    if (quotaTight.value.length > 0) {
      out.push(
        note(
          'quota',
          'quota',
          t('infra.kube.report.detail.quota', {
            list: quotaTight.value
              .map(
                ({ quota: name, entry }) => `${name}/${entry.resource} ${entry.used}/${entry.hard}`,
              )
              .join(', '),
          }),
        ),
      )
    }
    if (pdbBlocked.value.length > 0) {
      out.push(
        note(
          'pdb',
          'pdb',
          t('infra.kube.report.detail.pdb', {
            n: pdbBlocked.value.length,
            list: pdbBlocked.value.map((x) => x.name).join(', '),
          }),
        ),
      )
    }
    if (otherWorkloads.value.bad.length > 0) {
      out.push(
        note(
          'workloads',
          'workloads',
          t('infra.kube.report.detail.workloads', {
            n: otherWorkloads.value.bad.length,
            list: otherWorkloads.value.bad
              .slice(0, 3)
              .map((w) => `${w.name} (${w.ready})`)
              .join(', '),
          }),
        ),
      )
    }
    if (storage.value.unbound.length > 0) {
      out.push(
        note(
          'pvc',
          'storage',
          t('infra.kube.report.detail.pvc', {
            n: storage.value.unbound.length,
            list: storage.value.unbound.map((v) => `${v.name} (${v.status})`).join(', '),
          }),
        ),
      )
    }
    if (network.value.pending.length > 0) {
      out.push(
        note(
          'network',
          'network',
          t('infra.kube.report.detail.network', {
            n: network.value.pending.length,
            list: network.value.pending.join(', '),
          }),
        ),
      )
    }
    if (n.cordoned.length > 0) {
      out.push(
        note(
          'cordoned',
          'nodes',
          t('infra.kube.report.detail.cordoned', {
            n: n.cordoned.length,
            list: n.cordoned.map((x) => x.name).join(', '),
          }),
        ),
      )
    }
    if (n.versions.length > 1) {
      out.push(
        note(
          'versions',
          'nodes',
          t('infra.kube.report.detail.versions', { list: n.versions.join(', ') }),
        ),
      )
    }
    if (p.fresh > 0 && p.fresh < p.total) {
      out.push(
        note(
          'fresh',
          'churn',
          t('infra.kube.report.detail.fresh', { n: p.fresh, min: FRESH_POD_MIN }),
        ),
      )
    }
    if (out.length === 0 && hasData.value)
      out.push(note('ok', 'ok', t('infra.kube.report.detail.ok')))
    return out
  })

  /** Nguồn số nào KHÔNG đọc được, kèm lý do — hiện thẳng trong khối của nó thay vì
   *  để một khối trống làm người dùng tưởng cụm không có node/không có event. */
  const gaps = computed<{ key: string; label: string; why: string }[]>(() => {
    const out: { key: string; label: string; why: string }[] = []
    if (kube.nodesError.value) {
      out.push({
        key: 'nodes',
        label: t('infra.kube.report.gap.nodes'),
        why: kube.nodesError.value,
      })
    }
    if (kube.topError.value) {
      out.push({ key: 'top', label: t('infra.kube.report.gap.top'), why: kube.topError.value })
    }
    if (kube.eventsError.value) {
      out.push({
        key: 'events',
        label: t('infra.kube.report.gap.events'),
        why: kube.eventsError.value,
      })
    }
    if (kube.capacityError.value) {
      out.push({
        key: 'capacity',
        label: t('infra.kube.report.gap.capacity'),
        why: kube.capacityError.value,
      })
    }
    if (kube.hpaError.value) {
      out.push({ key: 'hpa', label: t('infra.kube.report.gap.hpa'), why: kube.hpaError.value })
    }
    // Các bảng cấu trúc giữ lỗi RIÊNG từng loại (khoá = `key` của `kinds` bên
    // `loadInventory`, nên bảng mới thêm ở đó tự có dòng ở đây): không có quyền
    // `list ingress` là chuyện thường, và nó không được hiện ra như thể mọi bảng hỏng.
    for (const [key, why] of Object.entries(kube.inventoryErrors.value)) {
      out.push({ key, label: t(`infra.kube.report.gap.${key}`), why })
    }
    return out
  })

  // ── Nạp lại ────────────────────────────────────────────────────────────────
  /**
   * Một cú bấm ↻ nạp MỌI bảng: báo cáo trộn hai nửa đọc ở hai thời điểm khác nhau
   * là báo cáo nói về một cụm không tồn tại.
   *
   * `full = false` là nhịp của vòng Theo dõi: nó bỏ các bảng cấu trúc (StatefulSet
   * · DaemonSet · Job · PVC · Service · Ingress · Endpoints · ResourceQuota · PDB ·
   * ReplicaSet). Chúng không đổi theo giây, nên đọc lại 30 lần một phiên là 300
   * lệnh kubectl để nghe lại cùng một câu.
   */
  async function refresh(full = true): Promise<void> {
    await Promise.all([
      kube.refreshWorkload(),
      kube.loadMetrics(),
      ...(full ? [kube.loadInventory()] : []),
    ])
  }

  /**
   * Mở mục Báo cáo = cú bấm của người dùng ⇒ nạp bảng riêng của nó, đúng MỘT lần
   * cho mỗi ngữ cảnh (hai mốc về 0 khi đổi cluster/namespace).
   *
   * ⚠ WATCHER, KHÔNG PHẢI `onMounted` (sửa 2026-09-17 cùng lỗi với watcher ngữ
   * cảnh ở `useInfraKube`). `pinnedCluster` đến từ một store nạp bất đồng bộ, nên
   * lúc component này mount nó có thể còn rỗng — mà `loadMetrics()` mở đầu bằng
   * `if (!pinnedCluster.value) return`. Cú gọi một lần khi đó im lặng không làm
   * gì, và card "Cụm" trống mãi: không lỗi, không ô trống nói lý do, vì cả hai thứ
   * đó chỉ xuất hiện khi lệnh THẬT SỰ chạy và hỏng.
   *
   * `immediate: true` lo lần mount; lần ngữ cảnh về muộn (hoặc đổi
   * cluster/namespace) thì watcher bắt được vì giá trị đổi.
   */
  watch(
    // Chuỗi chứ không phải mảng — cùng lý do với watcher ngữ cảnh ở `useInfraKube`.
    () => `${kube.pinnedCluster.value}\u0000${kube.pinnedNamespace.value}`,
    () => {
      if (!kube.pinnedCluster.value) return
      if (!kube.metricsLoadedAt.value) void kube.loadMetrics()
      if (!kube.inventoryLoadedAt.value) void kube.loadInventory()
    },
    { immediate: true },
  )

  // ── Dải xu hướng + vòng theo dõi ───────────────────────────────────────────
  const samples = ref<KubeSample[]>([])
  const watching = ref(false)
  const lastAt = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null

  function pushSample(): void {
    if (!hasData.value) return
    lastAt.value = Date.now()
    samples.value = [
      ...samples.value.slice(-(MAX_SAMPLES - 1)),
      {
        t: lastAt.value,
        notReady: pods.value.notReady,
        restarts: pods.value.restarts,
        score: score.value,
        cpuPct: saturation.value.maxCpuPct,
        memPct: saturation.value.maxMemPct,
      },
    ]
  }

  // Mỗi lượt nạp XONG (busy: true → false) là một mẫu. Bắt ở đây thay vì trong
  // `useInfraKube` để controller không phải biết gì về màn Báo cáo.
  watch(
    () => busy.value,
    (now, was) => {
      if (was === true && now === false) pushSample()
    },
  )
  // Mở mục Báo cáo sau khi bảng đã nạp xong: vẫn có mẫu đầu tiên để mà vẽ.
  if (!busy.value) pushSample()

  function stopWatch(): void {
    if (timer !== null) clearInterval(timer)
    timer = null
    watching.value = false
  }

  function toggleWatch(): void {
    if (watching.value) {
      stopWatch()
      return
    }
    watching.value = true
    const startedAt = Date.now()
    void refresh()
    timer = setInterval(() => {
      // Trần cứng: một vòng "bật rồi để đó" không được chạy tới hết buổi làm việc.
      if (Date.now() - startedAt >= KUBE_WATCH_MAX_MS) stopWatch()
      else void refresh(false)
    }, KUBE_WATCH_MS)
  }

  onBeforeUnmount(stopWatch)

  const trend = computed(() => {
    const list = samples.value
    if (list.length === 0) return null
    const notReady = list.map((s) => s.notReady)
    const scores = list.map((s) => s.score).filter((s): s is number => s !== null)
    const cpu = list.map((s) => s.cpuPct).filter((s): s is number => s !== null)
    return {
      n: list.length,
      from: list[0]?.t ?? 0,
      minNotReady: Math.min(...notReady),
      maxNotReady: Math.max(...notReady),
      minScore: scores.length ? Math.min(...scores) : null,
      maxScore: scores.length ? Math.max(...scores) : null,
      maxCpu: cpu.length ? Math.max(...cpu) : null,
    }
  })

  // ── Bản báo cáo dạng chữ (để chép / gửi agent) ─────────────────────────────
  /**
   * "Đọc lúc …" lấy mốc CŨ hơn trong hai lượt đọc (bảng workload và bảng số liệu).
   * Nút ↻ của màn này đọc cả sáu bảng cùng nhau nên hai mốc trùng; chỉ khi mở mục
   * Báo cáo lần đầu (workload đã nạp từ trước) chúng mới lệch, và khi lệch thì con
   * số đáng tin là con số CŨ nhất — nói mốc mới hơn là khoe dữ liệu tươi hơn thực tế.
   */
  const readAt = computed(() => {
    const stamps = [kube.loadedAt.value, kube.metricsLoadedAt.value].filter((v) => v > 0)
    return stamps.length ? Math.min(...stamps) : 0
  })
  const whenLabel = computed(() => (readAt.value ? time(readAt.value) : ''))
  const lastLabel = computed(() => (lastAt.value ? time(lastAt.value) : ''))
  const fromLabel = computed(() => (trend.value ? time(trend.value.from) : ''))

  function time(ts: number): string {
    return new Date(ts).toLocaleTimeString()
  }

  function pct(v: number | null): string {
    return v === null ? '—' : `${Math.round(v)}%`
  }

  const reportText = computed<string>(() => {
    const p = pods.value
    const d = deploys.value
    const n = nodesStat.value
    const sat = saturation.value
    const lines: string[] = [t('infra.kube.report.md.head', { where: whereLabel.value })]
    if (whenLabel.value) lines.push(t('infra.kube.report.md.when', { when: whenLabel.value }))
    if (!hasAny.value) {
      lines.push(t('infra.kube.report.md.noData'))
      return lines.join('\n')
    }
    if (score.value !== null) lines.push(t('infra.kube.report.md.score', { score: score.value }))
    lines.push(
      t('infra.kube.report.md.pods', {
        ready: p.ready,
        total: p.judged,
        notReady: p.notReady,
      }),
    )
    if (p.statuses.length) {
      lines.push(
        t('infra.kube.report.md.statuses', {
          list: p.statuses.map((s) => `${s.status} ${s.n}`).join(', '),
        }),
      )
    }
    lines.push(
      t('infra.kube.report.md.restarts', {
        total: p.restarts,
        perPod: p.total ? (p.restarts / p.total).toFixed(1) : '0',
        recent: p.recent,
      }),
    )
    if (p.top.length) {
      lines.push(
        t('infra.kube.report.md.top', { list: p.top.map((x) => `${x.name} (${x.n})`).join(', ') }),
      )
    }
    lines.push(t('infra.kube.report.md.deploys', { ready: d.full, total: d.total }))
    if (n.total > 0) {
      lines.push(
        t('infra.kube.report.md.nodes', {
          ready: n.ready,
          total: n.total,
          versions: n.versions.join(', ') || '—',
        }),
      )
    }
    if (sat.maxCpuPct !== null || sat.maxMemPct !== null) {
      lines.push(
        t('infra.kube.report.md.usage', {
          cpu: pct(sat.maxCpuPct),
          mem: pct(sat.maxMemPct),
          cpuSum: usage.value.cpuLabel,
          memSum: usage.value.memLabel,
        }),
      )
    }
    // Sức chứa đi NGAY SAU mức dùng: hai con số chỉ có nghĩa khi đọc cạnh nhau, và
    // bản chép ra (hoặc gửi cho agent) phải giữ đúng cặp đó.
    if (hasCapacity.value) {
      lines.push(
        t('infra.kube.report.md.capacity', {
          list: [...capacityByNode.value.values()]
            .map(
              (c) =>
                `${c.name} CPU ${pct(c.cpuReqPct)} / RAM ${pct(c.memReqPct)}` +
                (c.podCapacity === null ? '' : ` · pods ${c.podCount ?? 0}/${c.podCapacity}`),
            )
            .join('; '),
        }),
      )
    }
    if (hpa.value.total > 0) {
      lines.push(
        t('infra.kube.report.md.hpa', {
          list: hpa.value.list
            .map((h) => `${h.name} ${h.replicas ?? '—'}/${h.max ?? '—'} (${h.targets || '—'})`)
            .join('; '),
        }),
      )
    }
    if (otherWorkloads.value.total > 0) {
      lines.push(
        t('infra.kube.report.md.workloads', {
          n: otherWorkloads.value.total,
          bad: otherWorkloads.value.bad.map((w) => `${w.name} (${w.ready})`).join(', ') || '—',
        }),
      )
    }
    if (storage.value.total > 0 || network.value.total > 0) {
      lines.push(
        t('infra.kube.report.md.storageNet', {
          pvc: storage.value.total,
          size: storage.value.label,
          svc: network.value.svc.length,
          ing: network.value.ing.length,
          pending: network.value.pending.join(', ') || '—',
        }),
      )
    }
    if (usage.value.topCpu.length) {
      lines.push(
        t('infra.kube.report.md.topCpu', {
          list: usage.value.topCpu.map((x) => `${x.name} ${formatCpu(x.cpuMilli ?? 0)}`).join(', '),
        }),
      )
    }
    if (usage.value.topMem.length) {
      lines.push(
        t('infra.kube.report.md.topMem', {
          list: usage.value.topMem
            .map((x) => `${x.name} ${formatBytes(x.memBytes ?? 0)}`)
            .join(', '),
        }),
      )
    }
    for (const g of eventStat.value.groups) {
      lines.push(
        t('infra.kube.report.md.event', {
          reason: g.reason,
          object: g.object,
          n: g.count,
          message: g.message,
        }),
      )
    }
    for (const gap of gaps.value) {
      lines.push(t('infra.kube.report.md.gap', { label: gap.label, why: gap.why }))
    }
    if (trend.value && trend.value.n > 1) {
      lines.push(
        t('infra.kube.report.md.trend', {
          n: trend.value.n,
          min: trend.value.minNotReady,
          max: trend.value.maxNotReady,
          smin: trend.value.minScore ?? '—',
          smax: trend.value.maxScore ?? '—',
        }),
      )
    }
    for (const finding of findings.value) lines.push(`- ${finding.text}`)
    lines.push(t('infra.kube.report.md.verdict', { verdict: lampText.value }))
    return lines.join('\n')
  })

  async function copyReport(): Promise<void> {
    if (!(await copyText(reportText.value))) {
      toast.add({
        title: t('infra.kube.report.copyFailed'),
        color: 'error',
        icon: 'alert',
      })
      return
    }
    toast.add({ title: t('infra.kube.report.copied'), color: 'success', icon: 'copy' })
  }

  function askAboutReport(): void {
    void askAgent(
      t('infra.kube.report.askText', { where: whereLabel.value, report: reportText.value }),
    )
  }

  return {
    whereLabel,
    busy,
    pods,
    deploys,
    nodesStat,
    hasNodes,
    nodeUse,
    nodePods,
    saturation,
    capacityByNode,
    hasCapacity,
    packedNodes,
    podSlotTight,
    hpa,
    otherWorkloads,
    storage,
    network,
    usage,
    hasUsage,
    eventStat,
    failures,
    restarts15,
    restarts60,
    eventFresh,
    endpoints,
    endpointsEmpty,
    quota,
    quotaTight,
    pdbs,
    pdbBlocked,
    rollout,
    pressured,
    items,
    impacts,
    risks,
    statusLine,
    gaps,
    hasData,
    hasAny,
    score,
    lamp,
    lampText,
    findings,
    samples,
    trend,
    watching,
    lastLabel,
    whenLabel,
    fromLabel,
    refresh,
    toggleWatch,
    copyReport,
    askAboutReport,
  }
}
