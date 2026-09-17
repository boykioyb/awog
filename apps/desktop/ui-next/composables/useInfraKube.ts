// Page-controller của tab `/infra → Kubernetes` (việc 19/20/25 của
// docs/features/session-infra-context.md; màn đầy đủ vẫn là E7 của
// docs/features/infra-explorer.md).
//
// Toàn bộ state + lời gọi RPC nằm ở đây, SFC chỉ bind — khuôn
// `useXxxManager()` của .claude/rules/nuxt-vue.md §Composable.
//
// BỐN LUẬT CỦA FILE NÀY:
//   1. KHÔNG tự chạy. Không `watch`, không `onMounted` nào gọi CLI sau lưng người
//      dùng. Mở tab chỉ đọc `~/.kube/config` (đọc file, không gọi cluster, không
//      tốn tiền); mọi bảng pod/deployment chỉ nạp khi người dùng bấm (↑ khớp luật
//      "không auto-refresh" của infra-explorer.md).
//   2. KHÔNG tự ghép argv. UI gửi *ý định* (`op` + tên đã chọn từ danh sách) qua
//      RPC `infra.kube`; sidecar validate tên rồi mới dựng lệnh. Nhờ vậy một cái
//      tên pod do cluster bịa ra không bao giờ trở thành cờ của `kubectl`.
//   3. Cổng quyền không được nhại lại ở đây. `ask` ⇒ sidecar trả vé, ta hỏi người
//      dùng bằng hộp duyệt hạ tầng (useConfirm `kind: 'infra'`) rồi gọi lại kèm vé;
//      `block`/`requiresApproval: false` ⇒ hiện ĐÚNG dòng lệnh để người dùng tự
//      chạy. Không có đường nào gửi "đã duyệt" do renderer tự khai.
//   4. Ngữ cảnh là ngữ cảnh CHUNG của app (`sessionId: null`), không phải biến
//      riêng của tab: chọn cluster ở đây là đổi ngữ cảnh hiệu lực cho cả
//      `/infra` lẫn các phiên kế thừa tầng app — đúng ADR 0088 §7.
import { useConfirm } from '~/composables/useConfirm'
import { useInfraContext } from '~/composables/useInfraContext'
import { useSidecar } from '~/composables/useSidecar'
import { useToast } from '~/composables/useToast'
import type { InfraActionClass, InfraConfirmContext } from '~/composables/useConfirm'
import { copyText } from '~/utils/clipboard'

export type KubeContextEntry = {
  name: string
  cluster: string
  namespace: string
  user: string
  server: string
  current: boolean
}

export type KubeRow = {
  name: string
  /** Cột đã bóc, theo đúng thứ tự kubectl in (bỏ cột tên). */
  cells: string[]
}

export type KubeOut = {
  open: boolean
  /** 'logs' ⇒ có ô chọn container + số dòng; 'describe' ⇒ chỉ là text;
   *  'terminal' ⇒ shell tương tác (`kubectl exec -it`) — KHÔNG dùng `text`, một
   *  component xterm sống chiếm chỗ. */
  mode: 'logs' | 'describe' | 'terminal'
  title: string
  pod: string
  containers: string[]
  container: string
  tail: number
  /** `--since` của kubectl (`15m`, `1h`). Rỗng = không giới hạn thời gian.
   *  Đây là bộ lọc phía CLUSTER (đổi nó là chạy lại lệnh); lọc theo mức và theo
   *  khoảng giờ thì làm trên chữ đã tải (xem `utils/kube-logs.ts`). */
  since: string
  text: string
  loading: boolean
  error: string
  /** Dòng lệnh ĐÃ chạy (hoặc lệnh phải tự chạy khi bị chặn). */
  command: string
}

/**
 * Vùng chọn region. EKS chạy ở region người dùng chọn, mà `AppSelect` không nhận
 * giá trị ngoài danh sách — nên danh sách được ghép từ ba nguồn: region đang ghim,
 * region khai trong các profile AWS, và danh sách region phổ biến. Không có ô gõ
 * tự do: gõ tay một region là cách nhanh nhất để hỏi sai region.
 */
export const KUBE_REGIONS: readonly string[] = [
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-south-1',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'ca-central-1',
  'sa-east-1',
]

const DEFAULT_TAIL = 200
export const KUBE_TAILS: readonly number[] = [100, 200, 500, 1000]
/** Các khoảng cho `--since`. Chuỗi rỗng = bỏ cờ. Phải khớp `SINCE_RE` của sidecar
 *  (`^[1-9][0-9]{0,3}[smh]$`) — bên đó là nơi CƯỠNG CHẾ, đây chỉ là danh sách bấm. */
export const KUBE_SINCES: readonly string[] = ['', '5m', '15m', '1h', '6h', '24h']

type Blocked = { command: string; reason: string }

export function useInfraKube() {
  const { t } = useI18n()
  const sc = useSidecar()
  const { confirm } = useConfirm()
  const toast = useToast()
  const infraContext = useInfraContext({ sessionId: null })
  const { effective, appValue, setForApp } = infraContext

  const pinnedCluster = computed(() => effective.value.cluster ?? '')
  const pinnedNamespace = computed(() => effective.value.namespace ?? '')

  // ── Kubeconfig trên máy ───────────────────────────────────────────────────
  const contexts = ref<KubeContextEntry[]>([])
  const paths = ref<string[]>([])
  const contextsLoading = ref(false)
  const contextsError = ref('')
  const contextsLoaded = ref(false)

  // ── Quản lý cluster (modal) + thêm cluster EKS ────────────────────────────
  /** Bảng context + đường thêm cluster nằm trong MODAL: việc thỉnh thoảng mới làm,
   *  để nó trên màn chính là chiếm chỗ của hai bảng cần xem hằng ngày. */
  const clustersOpen = ref(false)
  const addOpen = ref(false)
  const profiles = ref<string[]>([])
  const profileRegions = ref<string[]>([])
  const profile = ref('')
  const region = ref('')
  const clusters = ref<string[]>([])
  const clustersLoading = ref(false)
  const clustersError = ref('')
  const adding = ref(false)
  const addError = ref('')
  const addBlocked = ref<Blocked | null>(null)

  const regionOptions = computed(() => {
    const seen = new Set<string>()
    const out: { label: string; value: string }[] = []
    const push = (value: string): void => {
      if (value && !seen.has(value)) {
        seen.add(value)
        out.push({ label: value, value })
      }
    }
    push(effective.value.region ?? '')
    for (const r of profileRegions.value) push(r)
    for (const r of KUBE_REGIONS) push(r)
    return out
  })

  // ── Workload ──────────────────────────────────────────────────────────────
  const namespaces = ref<string[]>([])
  const namespacesLoading = ref(false)
  const namespacesError = ref('')
  const pods = ref<KubeRow[]>([])
  const podsLoading = ref(false)
  const podsError = ref('')
  const deployments = ref<KubeRow[]>([])
  const deploymentsLoading = ref(false)
  const deploymentsError = ref('')
  // ── Số liệu của màn Báo cáo (node / CPU-RAM / event) ──────────────────────
  // Bốn bảng này KHÔNG nạp cùng Pods/Deployments: hai bảng kia là thứ mọi tab cần,
  // còn bốn bảng này chỉ màn Báo cáo đọc. Gộp chúng vào `refreshWorkload()` là bắt
  // mỗi cú bấm ↻ ở tab Pods trả tiền cho bốn lệnh kubectl mà tab đó không hiện.
  const nodes = ref<KubeRow[]>([])
  const topNodes = ref<KubeRow[]>([])
  const topPods = ref<KubeRow[]>([])
  /** Event giữ nguyên hàng thô: bảng event là bảng duy nhất mà cột đầu KHÔNG phải
   *  tên (`LAST SEEN TYPE REASON …`), nên `rowOf()` sẽ gán sai `name`. */
  const events = ref<string[][]>([])
  /** `kubectl describe nodes` — VĂN BẢN thô, không phải bảng cột. Parser riêng
   *  (`nodeCapacity()`) đọc nó; xem ghi chú ở `TABLE_OPS` phía sidecar. */
  const describeNodes = ref('')
  const hpa = ref<KubeRow[]>([])
  // Mười bảng "cấu trúc": chúng đổi theo phút/giờ chứ không theo giây, nên vòng
  // Theo dõi 30s KHÔNG đọc lại chúng — 10 lệnh kubectl mỗi 30 giây cho những con số
  // đứng yên là tiền mua một dòng không đổi.
  const statefulSets = ref<KubeRow[]>([])
  const daemonSets = ref<KubeRow[]>([])
  const jobs = ref<KubeRow[]>([])
  const pvc = ref<KubeRow[]>([])
  const services = ref<KubeRow[]>([])
  const ingresses = ref<KubeRow[]>([])
  /** `get endpoints` — ai đang đứng sau mỗi Service. Đây là chỗ DUY NHẤT trong các
   *  lệnh `get` nói ra "Service này không có pod nào", lỗi im lặng kinh điển. */
  const endpoints = ref<KubeRow[]>([])
  /** `get resourcequota` — namespace chạm trần thì pod mới bị từ chối ngay ở API
   *  server, nên `get pods` KHÔNG có gì để xem và chỉ bảng này trả lời được. */
  const resourceQuota = ref<KubeRow[]>([])
  /** `get poddisruptionbudgets` — `ALLOWED DISRUPTIONS = 0` là lý do `kubectl drain`
   *  treo vô hạn mà không có event nào nói. */
  const pdb = ref<KubeRow[]>([])
  /** `get rs` — tuổi của ReplicaSet trẻ nhất là "bản mới ra cách đây bao lâu", con
   *  số đầu tiên người ta hỏi khi một dịch vụ vừa hỏng. */
  const replicaSets = ref<KubeRow[]>([])
  const nodesError = ref('')
  /** MỘT lỗi cho cả `top nodes` + `top pods`: hai lệnh, một nguyên nhân duy nhất
   *  (cụm chưa cài metrics-server). Hai dòng lỗi giống nhau chỉ làm người đọc
   *  tưởng có hai sự cố. */
  const topError = ref('')
  const eventsError = ref('')
  const capacityError = ref('')
  const hpaError = ref('')
  /** Lỗi của mười bảng cấu trúc, THEO TỪNG LOẠI. Gộp chung một ô thì "không có
   *  quyền đọc ingress" (chuyện rất thường) sẽ hiện ra như thể cả mười bảng hỏng. */
  const inventoryErrors = ref<Record<string, string>>({})
  const metricsLoading = ref(false)
  const metricsLoadedAt = ref(0)
  const inventoryLoading = ref(false)
  const inventoryLoadedAt = ref(0)

  /** Lệnh bị ma trận quyền chặn: hiện lệnh, không có nút chạy. */
  const blocked = ref<Blocked | null>(null)

  /**
   * Thời điểm lượt nạp GẦN NHẤT xong. Màn Báo cáo in ra "đọc lúc …" — một con số
   * không kèm mốc thời gian thì người dùng không biết nó cũ hay mới, mà dữ liệu
   * hạ tầng cũ trông y hệt dữ liệu mới trên màn hình.
   */
  const loadedAt = ref(0)

  /**
   * Hành động GHI đang chạy, giữ TÊN đối tượng (không phải boolean): nút của đúng
   * hàng đó mới quay/vô hiệu, và cú bấm thứ hai (chuột đúp, bấm vội vì tưởng chưa
   * ăn) bị chặn ở đây thay vì thành hai lệnh.
   */
  const restarting = ref('')
  const deleting = ref('')

  /** Bảng của ngữ cảnh đang ghim có đang nạp không (ba bảng dùng chung một nhịp). */
  const workloadBusy = computed(
    () => namespacesLoading.value || podsLoading.value || deploymentsLoading.value,
  )

  /**
   * "Thế hệ" của ngữ cảnh đang ghim. Mỗi lần đổi cluster/namespace tăng số này;
   * hàm nạp đọc nó lúc bắt đầu và BỎ kết quả về muộn. Không có nó, đổi cluster khi
   * bảng đang nạp sẽ đổ bảng của cluster CŨ vào màn của cluster MỚI — người dùng
   * thấy dữ liệu đúng nhưng của sai cluster, thứ nguy hiểm nhất trong màn hạ tầng.
   */
  let loadEpoch = 0

  /**
   * Đổi ngữ cảnh: tăng thế hệ rồi trả ba cờ nạp về false. Cờ phải trả NGAY, vì
   * lượt nạp mới cần được bắt đầu trong khi lượt cũ còn đang bay; lượt cũ khi về
   * sẽ thấy thế hệ đổi và tự bỏ kết quả (không đụng vào cờ nữa).
   */
  function restartWorkloadLoad(): void {
    loadEpoch += 1
    namespacesLoading.value = false
    podsLoading.value = false
    deploymentsLoading.value = false
    metricsLoading.value = false
    inventoryLoading.value = false
  }

  /** Số liệu của cluster/namespace CŨ không được nằm lại trên màn của cái mới —
   *  một dải CPU 90% của cluster khác là thông tin sai, không phải thông tin cũ. */
  function clearMetrics(): void {
    nodes.value = []
    topNodes.value = []
    topPods.value = []
    events.value = []
    describeNodes.value = ''
    hpa.value = []
    statefulSets.value = []
    daemonSets.value = []
    jobs.value = []
    pvc.value = []
    services.value = []
    ingresses.value = []
    endpoints.value = []
    resourceQuota.value = []
    pdb.value = []
    replicaSets.value = []
    nodesError.value = ''
    topError.value = ''
    eventsError.value = ''
    capacityError.value = ''
    hpaError.value = ''
    inventoryErrors.value = {}
    metricsLoadedAt.value = 0
    inventoryLoadedAt.value = 0
  }

  const out = ref<KubeOut>({
    open: false,
    mode: 'logs',
    title: '',
    pod: '',
    containers: [],
    container: '',
    tail: DEFAULT_TAIL,
    since: '',
    text: '',
    loading: false,
    error: '',
    command: '',
  })

  function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
  }
  function text(v: unknown): string {
    return typeof v === 'string' ? v.trim() : ''
  }
  function message(err: unknown, fallback: string): string {
    return err instanceof Error && err.message.trim() ? err.message.trim() : fallback
  }

  async function pin(patch: { cluster?: string; namespace?: string }): Promise<void> {
    // Ghi ở tầng APP (không phải `effective` đã giải): chỉ đặt đúng hai trường
    // thuộc về nhánh kubectl, phần còn lại của tầng app giữ nguyên.
    setForApp({ ...appValue.value, ...patch })
  }

  async function loadContexts(refresh = false): Promise<void> {
    if (!sc.available || contextsLoading.value) return
    if (contextsLoaded.value && !refresh) return
    contextsLoading.value = true
    contextsError.value = ''
    try {
      const raw = await sc.request<unknown>('infra.contexts', { tool: 'kubectl' })
      const list = isRecord(raw) && Array.isArray(raw.contexts) ? raw.contexts : []
      const rows: KubeContextEntry[] = []
      for (const item of list) {
        if (!isRecord(item)) continue
        const name = text(item.name)
        if (!name) continue
        rows.push({
          name,
          cluster: text(item.cluster),
          namespace: text(item.namespace),
          user: text(item.user),
          server: text(item.server),
          current: item.current === true,
        })
      }
      contexts.value = rows
      paths.value =
        isRecord(raw) && Array.isArray(raw.paths) ? raw.paths.map(text).filter(Boolean) : []
      contextsLoaded.value = true
    } catch (err) {
      contextsError.value = message(err, t('infra.kube.error.contexts'))
    } finally {
      contextsLoading.value = false
    }
  }

  // Chọn cluster/namespace là một cú bấm CÓ Ý ĐỊNH, nên nạp bảng luôn: luật "không
  // auto-refresh" cấm nạp sau lưng người dùng (poll, watch), không cấm làm theo
  // đúng thứ họ vừa chọn. Không có bước này thì màn một-cuộn vẫn còn một màn trống
  // mà người không quen terminal không biết phải bấm ↻ mới đầy.
  async function setCluster(name: string): Promise<void> {
    if (name === pinnedCluster.value) return
    // Namespace ghim của context CŨ vô nghĩa ở context mới.
    const known = contexts.value.find((c) => c.name === name)
    // CHỈ ghim. Dọn bảng cũ và nạp bảng mới là việc của watcher ngữ cảnh bên dưới —
    // xem ghi chú ở đó về việc vì sao hai việc đó không được nằm ở đây nữa.
    await pin({ cluster: name, namespace: known?.namespace ?? '' })
  }

  async function setNamespace(ns: string): Promise<void> {
    if (ns === pinnedNamespace.value) return
    // Đổi namespace khi bảng đang nạp là cảnh race thật: dữ liệu namespace cũ về
    // muộn sẽ nằm lại trên màn namespace mới. Cùng một cơ chế thế hệ với cluster.
    if (workloadBusy.value) return
    await pin({ namespace: ns })
  }

  // ── Gọi RPC có cổng ───────────────────────────────────────────────────────
  /**
   * Chạy một thao tác qua `infra.kube`, đi qua cổng quyền của sidecar.
   *
   * Trả về bản ghi kết quả khi lệnh chạy, `null` khi bị chặn/người dùng huỷ/lỗi —
   * `blocked` (nếu có) giữ dòng lệnh để UI hiện lên.
   */
  async function call(
    payload: Record<string, unknown>,
    ui: { action: string; target: string; consequence: string; typeToConfirm?: string },
    ticket?: string,
    // Mặc định `infra.kube` (một-shot). Shell tương tác đi qua `infra.kube.exec`
    // nhưng dùng CHUNG vòng vé/duyệt này để `ask`/chặn không lệch giữa hai đường.
    method = 'infra.kube',
  ): Promise<Record<string, unknown> | null> {
    blocked.value = null
    let raw: Record<string, unknown>
    try {
      const body = ticket ? { ...payload, approvalTicket: ticket } : payload
      const answer = await sc.request<unknown>(method, body)
      if (!isRecord(answer)) throw new Error(t('infra.kube.error.unreadable'))
      raw = answer
    } catch (err) {
      blocked.value = { command: '', reason: message(err, t('infra.kube.error.run')) }
      return null
    }

    if (raw.blocked !== true) return raw

    const command = text(raw.command)
    const reason = text(raw.reason)
    const nextTicket = text(raw.approvalTicket)
    const cls = (['read', 'write', 'destructive'] as const).find((c) => c === raw.class) ?? 'write'
    const ctx: InfraConfirmContext = {}
    if (pinnedCluster.value) ctx.cluster = pinnedCluster.value
    if (pinnedNamespace.value) ctx.namespace = pinnedNamespace.value
    if (profile.value) ctx.profile = profile.value
    if (region.value) ctx.region = region.value

    // Ma trận CHẶN: hộp thoại chỉ có "chép lệnh" — không có nút chạy, vì không có
    // vé nào để xin. Đây là chỗ duy nhất trong màn này mà hiện dòng lệnh là đúng.
    if (raw.requiresApproval !== true || !nextTicket) {
      blocked.value = { command, reason }
      await confirm({
        kind: 'infra',
        action: ui.action,
        target: ui.target,
        consequence: reason || t('infra.kube.blocked.consequence'),
        command,
        context: ctx,
        accountKind: raw.accountKind === 'production' ? 'production' : 'normal',
        class: cls as InfraActionClass,
        blocked: true,
      })
      return null
    }

    const ok = await confirm({
      kind: 'infra',
      action: ui.action,
      target: ui.target,
      consequence: ui.consequence,
      command,
      context: ctx,
      accountKind: raw.accountKind === 'production' ? 'production' : 'normal',
      class: cls as InfraActionClass,
      ...(ui.typeToConfirm !== undefined ? { typeToConfirm: ui.typeToConfirm } : {}),
    })
    if (!ok) return null
    // Vé gắn vân tay của đúng lời gọi này và chỉ dùng được một lần ⇒ gọi lại y
    // nguyên payload cũ, không sửa gì giữa hai lượt (cùng method).
    return call(payload, ui, nextTicket, method)
  }

  function rowOf(raw: Record<string, unknown>): KubeRow[] {
    const rows = Array.isArray(raw.rows) ? raw.rows : []
    const out: KubeRow[] = []
    for (const row of rows) {
      if (!Array.isArray(row)) continue
      const cells = row.map((c) => (typeof c === 'string' ? c.trim() : ''))
      if (!cells[0]) continue
      out.push({ name: cells[0], cells: cells.slice(1) })
    }
    return out
  }

  /** Báo lỗi của khung log/mô tả: khung đã hiện chữ, toast để không ai bỏ lỡ. */
  function announceOutFailure(why: string, title: string): void {
    if (!why) return
    toast.add({ title, description: why, color: 'error', icon: 'alert' })
  }

  /** Lỗi của một lệnh ĐÃ chạy (khác lỗi cổng quyền): stderr của kubectl. */
  function runError(raw: Record<string, unknown>, fallback: string): string {
    const result = isRecord(raw.result) ? raw.result : {}
    if (result.ok === true) return ''
    return text(result.stderr) || fallback
  }

  /** Văn bản thô của lệnh — dùng cho `describe nodes`, thứ KHÔNG bóc thành bảng. */
  function stdoutOf(raw: Record<string, unknown>): string {
    return isRecord(raw.result) ? text(raw.result.stdout) : ''
  }

  /** Ghi kết quả CHỈ khi ngữ cảnh chưa đổi (xem `loadEpoch`). */
  async function loadNamespaces(): Promise<void> {
    if (!pinnedCluster.value || namespacesLoading.value) return
    const epoch = loadEpoch
    namespacesLoading.value = true
    namespacesError.value = ''
    const raw = await call(
      { op: 'namespaces', context: { cluster: pinnedCluster.value } },
      {
        action: t('infra.kube.act.listNs'),
        target: pinnedCluster.value,
        consequence: t('infra.kube.act.listNsWhy'),
      },
    )
    // Về muộn sau khi đổi ngữ cảnh: kết quả vô nghĩa, và cờ nạp giờ thuộc về lượt
    // mới nên không được đụng vào.
    if (epoch !== loadEpoch) return
    namespacesLoading.value = false
    if (!raw) return
    namespacesError.value = runError(raw, t('infra.kube.error.namespaces'))
    namespaces.value = rowOf(raw).map((r) => r.name)
  }

  async function loadPods(): Promise<void> {
    if (!pinnedCluster.value || podsLoading.value) return
    const epoch = loadEpoch
    podsLoading.value = true
    podsError.value = ''
    const context: Record<string, string> = { cluster: pinnedCluster.value }
    if (pinnedNamespace.value) context.namespace = pinnedNamespace.value
    const raw = await call(
      { op: 'pods', context },
      {
        action: t('infra.kube.act.listPods'),
        target: pinnedNamespace.value || 'default',
        consequence: t('infra.kube.act.listPodsWhy'),
      },
    )
    if (epoch !== loadEpoch) return
    podsLoading.value = false
    if (!raw) return
    podsError.value = runError(raw, t('infra.kube.error.pods'))
    pods.value = rowOf(raw)
  }

  async function loadDeployments(): Promise<void> {
    if (!pinnedCluster.value || deploymentsLoading.value) return
    const epoch = loadEpoch
    deploymentsLoading.value = true
    deploymentsError.value = ''
    const context: Record<string, string> = { cluster: pinnedCluster.value }
    if (pinnedNamespace.value) context.namespace = pinnedNamespace.value
    const raw = await call(
      { op: 'deployments', context },
      {
        action: t('infra.kube.act.listDeploys'),
        target: pinnedNamespace.value || 'default',
        consequence: t('infra.kube.act.listDeploysWhy'),
      },
    )
    if (epoch !== loadEpoch) return
    deploymentsLoading.value = false
    if (!raw) return
    deploymentsError.value = runError(raw, t('infra.kube.error.deployments'))
    deployments.value = rowOf(raw)
  }

  /** Hàng THÔ của một bảng (không coi cột đầu là tên) — dùng cho bảng event. */
  function rawRowsOf(raw: Record<string, unknown>): string[][] {
    const rows = Array.isArray(raw.rows) ? raw.rows : []
    const out: string[][] = []
    for (const row of rows) {
      if (!Array.isArray(row)) continue
      const cells = row.map((c) => (typeof c === 'string' ? c.trim() : ''))
      if (cells.some((c) => c !== '')) out.push(cells)
    }
    return out
  }

  /**
   * Nạp số liệu cho màn Báo cáo: node, CPU/RAM (`kubectl top`), event `Warning`.
   *
   * Bốn lệnh, MỘT cờ nạp và MỘT mốc thời gian: chúng luôn được đọc cùng nhau nên
   * tách cờ ra chỉ cho người dùng bốn spinner nói cùng một chuyện. Lỗi thì NGƯỢC
   * lại — mỗi nguồn giữ lỗi riêng, vì cụm chưa cài metrics-server là chuyện rất
   * bình thường và nó KHÔNG được làm mất phần node/event vẫn đọc được.
   *
   * Không có toast ở đây (khác `loadWorkload`): màn Báo cáo hiện lý do ngay trong
   * ô trống của từng khối, mà vòng "Theo dõi mỗi 30s" thì gọi hàm này 30 lần một
   * phiên — mỗi lần một toast là một cơn mưa toast cho một sự thật không đổi.
   */
  async function loadMetrics(): Promise<void> {
    if (!pinnedCluster.value || metricsLoading.value) return
    const epoch = loadEpoch
    metricsLoading.value = true
    const context: Record<string, string> = { cluster: pinnedCluster.value }
    if (pinnedNamespace.value) context.namespace = pinnedNamespace.value
    const target = pinnedNamespace.value || pinnedCluster.value
    const [rawNodes, rawTopNodes, rawTopPods, rawEvents, rawCapacity, rawHpa] = await Promise.all([
      call(
        { op: 'nodes', context },
        {
          action: t('infra.kube.act.listNodes'),
          target: pinnedCluster.value,
          consequence: t('infra.kube.act.listNodesWhy'),
        },
      ),
      call(
        { op: 'top-nodes', context },
        {
          action: t('infra.kube.act.topNodes'),
          target: pinnedCluster.value,
          consequence: t('infra.kube.act.topWhy'),
        },
      ),
      call(
        { op: 'top-pods', context },
        {
          action: t('infra.kube.act.topPods'),
          target,
          consequence: t('infra.kube.act.topWhy'),
        },
      ),
      call(
        { op: 'events', context },
        {
          action: t('infra.kube.act.events'),
          target,
          consequence: t('infra.kube.act.eventsWhy'),
        },
      ),
      // Sức chứa đi cùng tầng "sống": nó đổi mỗi lần một pod lên/xuống, và nó là
      // thứ duy nhất trả lời "còn chỗ đặt pod mới không".
      call(
        { op: 'describe-nodes', context },
        {
          action: t('infra.kube.act.capacity'),
          target: pinnedCluster.value,
          consequence: t('infra.kube.act.capacityWhy'),
        },
      ),
      call(
        { op: 'hpa', context },
        {
          action: t('infra.kube.act.hpa'),
          target,
          consequence: t('infra.kube.act.hpaWhy'),
        },
      ),
    ])
    if (epoch !== loadEpoch) return
    metricsLoading.value = false
    if (rawNodes) {
      nodesError.value = runError(rawNodes, t('infra.kube.error.nodes'))
      nodes.value = rowOf(rawNodes)
    }
    // Hai lệnh `top` chia nhau một ô lỗi: lệnh nào hỏng trước thì câu của nó ở lại.
    topError.value = ''
    if (rawTopNodes) {
      topError.value = runError(rawTopNodes, t('infra.kube.error.top'))
      topNodes.value = rowOf(rawTopNodes)
    }
    if (rawTopPods) {
      topError.value = topError.value || runError(rawTopPods, t('infra.kube.error.top'))
      topPods.value = rowOf(rawTopPods)
    }
    if (rawEvents) {
      eventsError.value = runError(rawEvents, t('infra.kube.error.events'))
      events.value = rawRowsOf(rawEvents)
    }
    if (rawCapacity) {
      capacityError.value = runError(rawCapacity, t('infra.kube.error.capacity'))
      // `describe` KHÔNG qua `parseKubeTable` ⇒ lấy thẳng stdout (xem `TABLE_OPS`).
      describeNodes.value = capacityError.value ? '' : stdoutOf(rawCapacity)
    }
    if (rawHpa) {
      hpaError.value = runError(rawHpa, t('infra.kube.error.hpa'))
      hpa.value = rowOf(rawHpa)
    }
    metricsLoadedAt.value = Date.now()
  }

  /**
   * Mười bảng "cấu trúc": StatefulSet · DaemonSet · Job · PVC · Service · Ingress ·
   * Endpoints · ResourceQuota · PodDisruptionBudget · ReplicaSet.
   *
   * Tách khỏi `loadMetrics()` vì chúng KHÔNG đổi theo giây. Vòng Theo dõi 30s đọc
   * lại số CPU và event là đúng; đọc lại danh sách Service 30 lần một phiên thì chỉ
   * để nghe lại đúng một câu trả lời. Ở đây vì thế là đường "người dùng bấm": mở
   * mục Báo cáo và bấm ↻.
   *
   * Lỗi giữ THEO TỪNG LOẠI: không có quyền `list ingress` là chuyện rất thường
   * trong cụm có RBAC chặt, và nó không được làm mất chín bảng còn lại.
   */
  async function loadInventory(): Promise<void> {
    if (!pinnedCluster.value || inventoryLoading.value) return
    const epoch = loadEpoch
    inventoryLoading.value = true
    const context: Record<string, string> = { cluster: pinnedCluster.value }
    if (pinnedNamespace.value) context.namespace = pinnedNamespace.value
    const target = pinnedNamespace.value || pinnedCluster.value
    const kinds = [
      { op: 'statefulsets', box: statefulSets, key: 'statefulsets' },
      { op: 'daemonsets', box: daemonSets, key: 'daemonsets' },
      { op: 'jobs', box: jobs, key: 'jobs' },
      { op: 'pvc', box: pvc, key: 'pvc' },
      { op: 'services', box: services, key: 'services' },
      { op: 'ingresses', box: ingresses, key: 'ingresses' },
      { op: 'endpoints', box: endpoints, key: 'endpoints' },
      { op: 'resourcequota', box: resourceQuota, key: 'resourcequota' },
      { op: 'pdb', box: pdb, key: 'pdb' },
      { op: 'replicasets', box: replicaSets, key: 'replicasets' },
    ] as const
    const results = await Promise.all(
      kinds.map((kind) =>
        call(
          { op: kind.op, context },
          {
            action: t(`infra.kube.act.${kind.key}`),
            target,
            consequence: t('infra.kube.act.inventoryWhy'),
          },
        ),
      ),
    )
    if (epoch !== loadEpoch) return
    inventoryLoading.value = false
    const errors: Record<string, string> = {}
    kinds.forEach((kind, i) => {
      const raw = results[i]
      if (!raw) return
      const why = runError(raw, t(`infra.kube.error.${kind.key}`))
      if (why) errors[kind.key] = why
      kind.box.value = why ? [] : rowOf(raw)
    })
    inventoryErrors.value = errors
    inventoryLoadedAt.value = Date.now()
  }

  /**
   * Lý do lượt nạp vừa rồi không có dữ liệu (rỗng = không lỗi).
   *
   * `includeNamespaces` = lượt nạp này CÓ nạp namespace hay không: đổi namespace
   * thì không nạp lại danh sách namespace, mà lỗi cũ của nó vẫn còn nằm đó — kể nó
   * ra lần nữa là toast lặp lại một chuyện đã báo.
   */
  function loadFailure(includeNamespaces: boolean): string {
    return (
      blocked.value?.reason ||
      (includeNamespaces ? namespacesError.value : '') ||
      podsError.value ||
      deploymentsError.value
    )
  }

  /**
   * Nạp bảng của ngữ cảnh đang ghim — đường người dùng bấm (chọn cluster, ↻, mở
   * tab). Lỗi được báo bằng TOAST ở đây: lỗi nằm rải trong từng bảng thì dễ bị bỏ
   * qua, mà im lặng thì người dùng ngồi đợi một khung không bao giờ đầy.
   */
  async function loadWorkload(withNamespaces = true): Promise<void> {
    await Promise.all(
      withNamespaces
        ? [loadNamespaces(), loadPods(), loadDeployments()]
        : [loadPods(), loadDeployments()],
    )
    loadedAt.value = Date.now()
    const why = loadFailure(withNamespaces)
    if (!why) return
    toast.add({
      title: t('infra.kube.error.refresh'),
      description: why,
      color: 'error',
      icon: 'alert',
    })
  }

  /** ↻ trên thanh ngữ cảnh. */
  async function refreshWorkload(): Promise<void> {
    await loadWorkload(true)
  }

  async function loadContainers(pod: string): Promise<string[]> {
    const context: Record<string, string> = { cluster: pinnedCluster.value }
    if (pinnedNamespace.value) context.namespace = pinnedNamespace.value
    const raw = await call(
      { op: 'containers', context, pod },
      {
        action: t('infra.kube.act.containers'),
        target: pod,
        consequence: t('infra.kube.act.containersWhy'),
      },
    )
    if (!raw || raw.blocked === true) return []
    const names = Array.isArray(raw.names) ? raw.names : []
    return names.filter((n): n is string => typeof n === 'string')
  }

  /**
   * Mở một shell tương tác trong pod đang xem (`kubectl exec -it`). Đi qua CÙNG
   * cổng duyệt như mọi thao tác khác (method `infra.kube.exec`), nhưng khi được
   * duyệt thì sidecar spawn một PTY và trả `terminalId` — component xterm bám vào
   * id đó qua các RPC `terminal.*` sẵn có.
   *
   * Trả về `{ id }` cho `TerminalTransport.create`; NÉM khi bị chặn/người dùng huỷ
   * để `WorkspaceTerminal` hiện đúng lý do thay vì một khung trống.
   */
  async function startPodExec(cols: number, rows: number): Promise<{ id: string }> {
    const pod = out.value.pod
    if (!pod) throw new Error(t('infra.kube.exec.failed'))
    const context: Record<string, string> = { cluster: pinnedCluster.value }
    if (pinnedNamespace.value) context.namespace = pinnedNamespace.value
    const payload: Record<string, unknown> = { context, pod, cols, rows }
    // Dùng lại container đã chọn ở tab Logs nếu có; rỗng ⇒ để kubectl chọn container
    // mặc định của pod.
    if (out.value.container) payload.container = out.value.container
    const raw = await call(
      payload,
      {
        action: t('infra.kube.act.exec'),
        target: pod,
        consequence: t('infra.kube.act.execWhy'),
      },
      undefined,
      'infra.kube.exec',
    )
    const id = raw && typeof raw.terminalId === 'string' ? raw.terminalId : ''
    // `call` trả null khi bị chặn/huỷ (hộp duyệt đã nói lý do); `blocked.reason` giữ
    // câu giải thích khi ma trận chặn hẳn hoặc CLI không chạy được.
    if (!id) throw new Error(blocked.value?.reason || t('infra.kube.exec.failed'))
    return { id }
  }

  async function loadLogs(reloadContainers: boolean): Promise<void> {
    const pod = out.value.pod
    if (!pod || out.value.loading) return
    out.value = { ...out.value, loading: true, error: '' }
    if (reloadContainers) {
      out.value.containers = await loadContainers(pod)
      out.value.container = ''
    }
    const context: Record<string, string> = { cluster: pinnedCluster.value }
    if (pinnedNamespace.value) context.namespace = pinnedNamespace.value
    const payload: Record<string, unknown> & { op: string } = {
      op: 'logs',
      context,
      pod,
      tail: out.value.tail,
    }
    if (out.value.container) payload.container = out.value.container
    if (out.value.since) payload.since = out.value.since
    const raw = await call(payload, {
      action: t('infra.kube.act.logs'),
      target: pod,
      consequence: t('infra.kube.act.logsWhy'),
    })
    const next = { ...out.value, loading: false }
    if (raw) {
      next.command = text(raw.command)
      next.text = isRecord(raw.result) ? text(raw.result.stdout) : ''
      next.error = runError(raw, t('infra.kube.error.logs'))
    } else {
      // `call` trả null khi lệnh bị chặn hoặc CLI không chạy được — phải NÓI RA
      // trong khung này, không để thân modal trống rồi người dùng đoán.
      next.error = blocked.value?.reason ?? ''
    }
    out.value = next
    announceOutFailure(next.error, t('infra.kube.error.logs'))
  }

  async function openLogs(pod: string): Promise<void> {
    out.value = {
      open: true,
      mode: 'logs',
      title: t('infra.kube.out.logs'),
      pod,
      containers: [],
      container: '',
      tail: DEFAULT_TAIL,
      since: '',
      text: '',
      loading: false,
      error: '',
      command: '',
    }
    await loadLogs(true)
  }

  /** Chạy `describe` cho pod đang mở — dùng chung cho lần mở và lần đổi tab. */
  async function loadDescribe(): Promise<void> {
    const pod = out.value.pod
    if (!pod) return
    const context: Record<string, string> = { cluster: pinnedCluster.value }
    if (pinnedNamespace.value) context.namespace = pinnedNamespace.value
    const raw = await call(
      { op: 'describe', context, pod },
      {
        action: t('infra.kube.act.describe'),
        target: pod,
        consequence: t('infra.kube.act.describeWhy'),
      },
    )
    const next = { ...out.value, loading: false }
    if (raw) {
      next.command = text(raw.command)
      next.text = isRecord(raw.result) ? text(raw.result.stdout) : ''
      next.error = runError(raw, t('infra.kube.error.describe'))
    } else {
      next.error = blocked.value?.reason ?? ''
    }
    out.value = next
    announceOutFailure(next.error, t('infra.kube.error.describe'))
  }

  async function openDescribe(pod: string): Promise<void> {
    out.value = {
      open: true,
      mode: 'describe',
      title: t('infra.kube.out.describe'),
      pod,
      containers: [],
      container: '',
      tail: DEFAULT_TAIL,
      since: '',
      text: '',
      loading: true,
      error: '',
      command: '',
    }
    await loadDescribe()
  }

  /**
   * Đổi tab Log ⇄ Chi tiết của CÙNG một pod. Giữ nguyên số dòng đã chọn (người dùng
   * đã nói họ muốn bao nhiêu dòng, đổi tab không phải là ý định đổi nó).
   */
  async function setOutMode(mode: 'logs' | 'describe' | 'terminal'): Promise<void> {
    // Đang nạp thì bỏ qua: đổi tab giữa chừng là hai lệnh chồng nhau trên cùng một
    // khung, và kết quả về muộn của tab cũ sẽ nằm dưới tiêu đề của tab mới.
    if (!out.value.pod || out.value.mode === mode || out.value.loading) return
    // Terminal là một component SỐNG (xterm + PTY), không phải ảnh chụp text. Chỉ
    // đổi mode và để component tự lo — nó tự kích hoạt cổng duyệt + spawn khi mount.
    // KHÔNG xoá `text`/`command`: đổi từ terminal về Logs lại thấy lại ảnh chụp cũ.
    if (mode === 'terminal') {
      out.value = { ...out.value, mode }
      return
    }
    out.value = { ...out.value, mode, text: '', error: '', command: '' }
    if (mode === 'logs') {
      // `loadLogs` tự bật cờ loading; bật trước ở đây thì nó early-return.
      await loadLogs(true)
      return
    }
    out.value = { ...out.value, loading: true }
    await loadDescribe()
  }

  /**
   * ↻ của khung output: chạy lại ĐÚNG thứ đang xem — log thì đọc log, đang ở tab
   * mô tả thì chạy lại `describe`. Trước đây nút này luôn chạy `logs`, nên bấm ↻
   * khi đang xem mô tả là âm thầm đổi nội dung sang thứ khác.
   */
  async function refreshOut(): Promise<void> {
    if (out.value.loading) return
    if (out.value.mode === 'logs') {
      await loadLogs(false)
      return
    }
    out.value = { ...out.value, loading: true, error: '' }
    await loadDescribe()
  }

  function closeOut(): void {
    out.value = { ...out.value, open: false }
  }

  async function setContainer(name: string): Promise<void> {
    out.value = { ...out.value, container: name, text: '' }
    await loadLogs(false)
  }

  async function setTail(value: number): Promise<void> {
    out.value = { ...out.value, tail: value, text: '' }
    await loadLogs(false)
  }

  /** Đổi khoảng `--since` ⇒ chạy lại lệnh: đây là bộ lọc của CLUSTER, không phải
   *  của khung. Xoá chữ cũ trước khi gọi để không ai đọc log cũ tưởng là log mới. */
  async function setSince(value: string): Promise<void> {
    out.value = { ...out.value, since: value, text: '' }
    await loadLogs(false)
  }

  /** Mở modal quản lý cluster. KHÔNG tự mở luôn khối "thêm cluster": mặc định là
   *  xem máy đang có gì, thêm chỉ khi người dùng bấm thêm. */
  function openClusters(): void {
    clustersOpen.value = true
    addError.value = ''
    addBlocked.value = null
  }

  function closeClusters(): void {
    // Đóng modal thì gập luôn khối thêm: lần sau mở lại vẫn là "xem trước".
    clustersOpen.value = false
    addOpen.value = false
  }

  function openAdd(): void {
    addOpen.value = true
    addError.value = ''
    addBlocked.value = null
    clusters.value = []
    if (!profile.value) profile.value = effective.value.profile ?? profiles.value[0] ?? ''
    if (!region.value) region.value = effective.value.region ?? profileRegions.value[0] ?? ''
  }

  function closeAdd(): void {
    addOpen.value = false
  }

  async function loadAwsProfiles(): Promise<void> {
    if (!sc.available) return
    try {
      const raw = await sc.request<unknown>('infra.contexts', { tool: 'aws' })
      const list = isRecord(raw) && Array.isArray(raw.contexts) ? raw.contexts : []
      const names: string[] = []
      const regions: string[] = []
      for (const item of list) {
        if (!isRecord(item)) continue
        const name = text(item.name)
        if (name) names.push(name)
        const r = text(item.region)
        if (r) regions.push(r)
      }
      profiles.value = names
      profileRegions.value = regions
    } catch {
      // Không đọc được danh sách profile thì vẫn còn chọn region tay; đừng chặn
      // cả panel bằng một lỗi đọc file.
    }
  }

  async function findClusters(): Promise<void> {
    if (clustersLoading.value) return
    clustersLoading.value = true
    clustersError.value = ''
    clusters.value = []
    try {
      const context: Record<string, string> = {}
      if (profile.value) context.profile = profile.value
      if (region.value) context.region = region.value
      const raw = await call(
        { op: 'eks-clusters', context },
        {
          action: t('infra.kube.act.findClusters'),
          target: profile.value || region.value,
          consequence: t('infra.kube.act.findClustersWhy'),
        },
      )
      if (!raw) return
      clustersError.value = runError(raw, t('infra.kube.error.clusters'))
      const list = Array.isArray(raw.clusters) ? raw.clusters : []
      clusters.value = list.filter((n): n is string => typeof n === 'string')
    } finally {
      // Cờ phải trả ở `finally`: một đường thoát sớm quên nó là nút "Tìm cluster"
      // kẹt ở trạng thái đang chạy vĩnh viễn.
      clustersLoading.value = false
    }
  }

  async function addCluster(name: string): Promise<void> {
    if (adding.value) return
    adding.value = true
    addError.value = ''
    addBlocked.value = null
    try {
      await runAddCluster(name)
    } finally {
      adding.value = false
    }
  }

  /** Thân của `addCluster`: tách ra để cờ `adding` luôn được trả trong `finally`. */
  async function runAddCluster(name: string): Promise<void> {
    const context: Record<string, string> = {}
    if (profile.value) context.profile = profile.value
    if (region.value) context.region = region.value
    const raw = await call(
      { op: 'add-cluster', context, cluster: name },
      {
        action: t('infra.kube.act.addCluster'),
        target: name,
        consequence: t('infra.kube.act.addClusterWhy'),
      },
    )
    if (!raw) {
      if (blocked.value?.command) addBlocked.value = blocked.value
      return
    }
    if (!isRecord(raw.result) || raw.result.ok !== true) {
      addError.value = runError(raw, t('infra.kube.error.addCluster'))
      toast.add({
        title: t('infra.kube.add.failed', { name }),
        description: addError.value,
        color: 'error',
        icon: 'alert',
      })
      return
    }
    toast.add({ title: t('infra.kube.add.done', { name }), color: 'success', icon: 'k8s' })
    await loadContexts(true)
    addOpen.value = false
    // Cluster vừa thêm là thứ người dùng muốn dùng ngay — ghim luôn context của nó
    // nếu tên context trùng tên cluster (mặc định của `aws eks update-kubeconfig`).
    const added = contexts.value.find((c) => c.name === name)
    if (added) await setCluster(name)
  }

  async function restartDeployment(name: string): Promise<void> {
    // Một hành động ghi tại một thời điểm: bấm lần hai khi lệnh đầu còn chạy là
    // gửi hai `rollout restart` vào cùng một deployment.
    if (restarting.value || deleting.value) return
    restarting.value = name
    try {
      const context: Record<string, string> = { cluster: pinnedCluster.value }
      if (pinnedNamespace.value) context.namespace = pinnedNamespace.value
      const raw = await call(
        { op: 'restart', context, deployment: name },
        {
          action: t('infra.kube.act.restart'),
          target: name,
          consequence: t('infra.kube.act.restartWhy'),
        },
      )
      // `null` = bị chặn hoặc người dùng huỷ ở hộp duyệt; hộp duyệt đã nói lý do.
      if (!raw) return
      if (!(isRecord(raw.result) && raw.result.ok === true)) {
        toast.add({
          title: t('infra.kube.restart.failed', { name }),
          description: runError(raw, t('infra.kube.error.run')),
          color: 'error',
          icon: 'alert',
        })
        return
      }
      toast.add({
        title: t('infra.kube.restart.done', { name }),
        color: 'success',
        icon: 'refresh',
      })
      await loadDeployments()
    } finally {
      restarting.value = ''
    }
  }

  async function deletePod(name: string): Promise<void> {
    if (restarting.value || deleting.value) return
    deleting.value = name
    try {
      const context: Record<string, string> = { cluster: pinnedCluster.value }
      if (pinnedNamespace.value) context.namespace = pinnedNamespace.value
      const raw = await call(
        { op: 'delete-pod', context, pod: name },
        {
          action: t('infra.kube.act.deletePod'),
          target: name,
          consequence: t('infra.kube.act.deletePodWhy'),
          typeToConfirm: name,
        },
      )
      // `null` = bị chặn (ma trận mặc định CHẶN `delete`) hoặc người dùng huỷ.
      if (!raw) return
      if (!(isRecord(raw.result) && raw.result.ok === true)) {
        toast.add({
          title: t('infra.kube.delete.failed', { name }),
          description: runError(raw, t('infra.kube.error.run')),
          color: 'error',
          icon: 'alert',
        })
        return
      }
      toast.add({ title: t('infra.kube.delete.done', { name }), color: 'success', icon: 'trash' })
      // Khung log/chi tiết đang mở chính là pod vừa xoá ⇒ đóng lại: để nó mở trên
      // một pod không còn tồn tại là mời người dùng bấm ↻ rồi nhận lỗi.
      if (out.value.open && out.value.pod === name) closeOut()
      await loadPods()
    } finally {
      deleting.value = ''
    }
  }

  async function copyCommand(command: string): Promise<void> {
    // `copyText` nói thật là có ghi được vào clipboard hay không (API bị chặn khi
    // cửa sổ mất tiêu điểm). Báo "Đã chép" khi chưa chép là để người dùng dán ra
    // thứ khác rồi tưởng tool hỏng.
    if (!(await copyText(command))) {
      toast.add({
        title: t('infra.kube.blocked.copyFailed'),
        description: command,
        color: 'error',
        icon: 'alert',
      })
      return
    }
    toast.add({ title: t('infra.kube.blocked.copied'), description: command, color: 'success' })
  }

  /**
   * NGỮ CẢNH ĐỔI ⇒ DỌN BẢNG CŨ RỒI NẠP BẢNG MỚI. Một watcher, không phải ba chỗ
   * gọi tay.
   *
   * ⚠ LỖI ĐÃ SỬA Ở ĐÂY (2026-09-17, người dùng báo "cụm cứ chập chờn, đổi app
   * khác quay lại là mất"). Bản cũ nạp bằng một cú kiểm tra MỘT LẦN trong
   * `onMounted`: `if (pinnedCluster.value) refreshWorkload()`. Nhưng
   * `pinnedCluster` đến từ `settingsStore.infra` — một store nạp BẤT ĐỒNG BỘ qua
   * IPC. Mở tab trước khi store kịp về thì ô đó còn rỗng, cú kiểm tra rơi vào
   * nhánh `false`, và KHÔNG có gì chạy lại: bảng trống vĩnh viễn, không lỗi,
   * không nút nào tự sáng. Thắng hay thua cuộc đua đó phụ thuộc vào việc lần
   * trước store đã ấm chưa — đúng cái "lúc được lúc không".
   *
   * Cú thứ hai của cùng một lỗi: `setNamespace` xoá số liệu cụm (`clearMetrics`)
   * rồi chỉ nạp lại pod/deployment. Card "Cụm" vì thế trống trơn — không phải
   * "cụm không có node", mà là "chưa ai đi đọc lại" — cho tới khi người dùng bấm ↻.
   *
   * `immediate: true` phủ luôn lần mount, nên đây là đường DUY NHẤT nạp bảng theo
   * ngữ cảnh: không còn hai nguồn để lệch nhau, và không có cú nạp đôi.
   */
  watch(
    // Theo dõi một CHUỖI, không phải một mảng: `() => [a, b]` trả về một mảng MỚI
    // mỗi lần chạy, nên Vue so bằng `Object.is` sẽ thấy "khác" ở mọi lần store bị
    // thay đối tượng — kể cả khi cluster/namespace không đổi một chữ. Với màn này
    // cái giá của một lần bắn thừa là xoá sạch bảng rồi gọi lại bốn lệnh kubectl.
    () => `${pinnedCluster.value}\u0000${pinnedNamespace.value}`,
    (_key, previousKey) => {
      const cluster = pinnedCluster.value
      const clusterChanged = cluster !== ((previousKey ?? '').split('\u0000')[0] ?? '')
      // Số của ngữ cảnh CŨ không được nằm lại trên màn của cái mới — một bảng pod
      // đúng nhưng của sai cluster là thứ nguy hiểm nhất trong màn hạ tầng.
      pods.value = []
      deployments.value = []
      if (clusterChanged) namespaces.value = []
      clearMetrics()
      restartWorkloadLoad()
      if (!cluster) return
      // Đổi cluster ⇒ nạp lại cả danh sách namespace; đổi mỗi namespace thì không.
      void loadWorkload(clusterChanged)
    },
    { immediate: true },
  )

  onMounted(() => {
    void loadContexts()
    void loadAwsProfiles()
  })

  return {
    // kubeconfig
    contexts,
    paths,
    contextsLoading,
    contextsError,
    loadContexts,
    pinnedCluster,
    pinnedNamespace,
    setCluster,
    setNamespace,
    // quản lý cluster (modal) + thêm cluster
    clustersOpen,
    openClusters,
    closeClusters,
    addOpen,
    openAdd,
    closeAdd,
    profiles,
    profile,
    region,
    regionOptions,
    clusters,
    clustersLoading,
    clustersError,
    adding,
    addError,
    addBlocked,
    findClusters,
    addCluster,
    setProfile: (v: string) => {
      profile.value = v
      clusters.value = []
    },
    setRegion: (v: string) => {
      region.value = v
      clusters.value = []
    },
    // workload
    workloadBusy,
    loadedAt,
    namespaces,
    namespacesLoading,
    namespacesError,
    pods,
    podsLoading,
    podsError,
    deployments,
    deploymentsLoading,
    deploymentsError,
    loadPods,
    loadDeployments,
    refreshWorkload,
    // số liệu của màn Báo cáo
    nodes,
    topNodes,
    topPods,
    events,
    describeNodes,
    hpa,
    statefulSets,
    daemonSets,
    jobs,
    pvc,
    services,
    ingresses,
    endpoints,
    resourceQuota,
    pdb,
    replicaSets,
    nodesError,
    topError,
    eventsError,
    capacityError,
    hpaError,
    inventoryErrors,
    metricsLoading,
    metricsLoadedAt,
    inventoryLoading,
    inventoryLoadedAt,
    loadMetrics,
    loadInventory,
    restarting,
    restartDeployment,
    deleting,
    deletePod,
    blocked,
    copyCommand,
    // log / describe / terminal
    out,
    openLogs,
    openDescribe,
    setOutMode,
    closeOut,
    setContainer,
    setTail,
    setSince,
    refreshOut,
    startPodExec,
  }
}

export type InfraKubeController = ReturnType<typeof useInfraKube>
