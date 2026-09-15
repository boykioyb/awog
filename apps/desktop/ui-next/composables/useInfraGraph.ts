// Page-controller của màn Graph kiến trúc & luồng request (Mốc 5; hợp đồng §3 + §6,
// spec docs/features/infra-topology-graph.md).
//
// Toàn bộ state + lời gọi RPC nằm ở đây, SFC chỉ bind — khuôn `useXxxManager()` của
// .claude/rules/nuxt-vue.md §Composable.
//
// BỐN LUẬT CỦA FILE NÀY:
//   1. KHÔNG tự chạy. Không `onMounted`/`watch` nào gọi resolver sau lưng người
//      dùng: một lượt resolve là nhiều lệnh `describe-*` qua cổng quyền, nên graph
//      chỉ được dựng khi người dùng chọn một điểm vào.
//   2. DỰNG DẦN. `resolve` bắt đầu từ ĐÚNG MỘT điểm vào; `expand` đi thêm đúng một
//      bước cho ĐÚNG MỘT node. Không có đường "vẽ cả tài khoản".
//   3. Cổng quyền không được nhại lại ở đây. `blocked` + vé ⇒ hộp duyệt hạ tầng
//      (`useConfirm` kind `infra`) rồi gọi lại ĐÚNG payload kèm vé;
//      `requiresApproval: false` ⇒ hộp chỉ còn nút chép lệnh, KHÔNG mời gọi lại.
//   4. NÓI THẬT VỀ ĐỘ TIN. `trafficSource` và cờ `inferred` của cạnh không bao giờ
//      bị nuốt: spec bắt buộc người dùng biết sơ đồ này suy ra từ đâu, và im lặng ở
//      đây là nói dối về độ tin của sơ đồ.
import { computed, ref } from 'vue'
import { useConfirm } from '~/composables/useConfirm'
import { useInfraContext } from '~/composables/useInfraContext'
import {
  useInfraGraphApi,
  type GraphContext,
  type InfraGraph,
  type InfraGraphEdge,
  type InfraGraphNode,
  type InfraGraphRoot,
  type InfraTrafficSource,
} from '~/composables/useInfraGraphApi'
import type { InfraActionClass, InfraConfirmContext } from '~/composables/useConfirm'

/** Trần độ sâu của resolver (hợp đồng §3, spec §"Giới hạn nói trước"). */
export const GRAPH_MAX_DEPTH = 4
/** Độ sâu mặc định của spec: 4 hop, mở rộng thủ công phần còn lại. */
export const GRAPH_DEFAULT_DEPTH = GRAPH_MAX_DEPTH
export const GRAPH_DEPTHS: readonly number[] = [1, 2, 3, 4]

/**
 * Bố cục DAG phân tầng — CÙNG thuật toán với `layout()` của
 * `composables/useWorkflowGen.ts` (x theo rank đường-dài-nhất, y theo thứ tự trong
 * rank); bản gốc là hàm cục bộ không export nên không import được. Topology cũng là
 * DAG phân tầng nên dùng lại thay vì thêm dagre/elkjs (spec §"Vẽ bằng gì").
 */
function layoutGraph(
  nodeIds: string[],
  edgeList: InfraGraphEdge[],
): Record<string, { x: number; y: number }> {
  const inDeg = new Map<string, number>()
  const adj = new Map<string, string[]>()
  nodeIds.forEach((id) => {
    inDeg.set(id, 0)
    adj.set(id, [])
  })
  edgeList.forEach((e) => {
    if (!inDeg.has(e.from) || !inDeg.has(e.to)) return
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1)
    adj.get(e.from)?.push(e.to)
  })
  const rank = new Map<string, number>()
  const queue: string[] = []
  inDeg.forEach((deg, id) => {
    if (deg === 0) {
      rank.set(id, 0)
      queue.push(id)
    }
  })
  while (queue.length) {
    const id = queue.shift() as string
    const r = rank.get(id) ?? 0
    ;(adj.get(id) ?? []).forEach((next) => {
      rank.set(next, Math.max(rank.get(next) ?? 0, r + 1))
      const d = (inDeg.get(next) ?? 1) - 1
      inDeg.set(next, d)
      if (d === 0) queue.push(next)
    })
  }
  const rowByRank = new Map<number, number>()
  const pos: Record<string, { x: number; y: number }> = {}
  nodeIds.forEach((id) => {
    const r = rank.get(id) ?? 0
    const row = rowByRank.get(r) ?? 0
    rowByRank.set(r, row + 1)
    pos[id] = { x: 60 + r * 280, y: 60 + row * 140 }
  })
  return pos
}

/**
 * Biểu tượng của một dịch vụ. Chỉ là gợi ý thị giác — `service` vẫn là định danh
 * tiếng Anh hiện nguyên văn trên node, không dịch. Tên lạ rơi về `layers`.
 */
const SERVICE_ICONS: Record<string, string> = {
  route53: 'branch',
  cloudfront: 'globe',
  apigateway: 'link',
  'api-gateway': 'link',
  lambda: 'zap',
  ecs: 'layers',
  eks: 'k8s',
  ec2: 'act',
  rds: 'table',
  dynamodb: 'table',
  s3: 'folder',
  sqs: 'send',
  sns: 'bell',
  alb: 'conn',
  elb: 'conn',
  stepfunctions: 'workflows',
  cloudformation: 'layers',
  external: 'external',
}

export function graphServiceIcon(service: string): string {
  return SERVICE_ICONS[service] ?? 'layers'
}

/** Kết cục của một lượt gọi cổng: chạy được, hoặc lý do để màn hiện ra. */
type GatedResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Hình dạng một lượt RPC sau khi `useInfraGraphApi` đã chuẩn hoá `blocked`. */
type GateReply<T> =
  | { ok: true; value: T }
  | {
      ok: false
      blocked: true
      requiresApproval: boolean
      approvalTicket?: string
      command: string
      reason: string
      class: string
      accountKind: string
    }
  | { ok: false; blocked: false; error: string }

export type InfraGraphOptions = {
  /** Phiên phát sinh lượt gọi (chỉ để ghi nhật ký); bỏ trống ở bề mặt `/infra`. */
  sessionId?: string
  messageId?: string
}

export function useInfraGraph(options: InfraGraphOptions = {}) {
  const api = useInfraGraphApi()
  const { t } = useI18n()
  const { confirm } = useConfirm()
  // Graph là bề mặt NGOÀI phiên (trang `/infra`): ngữ cảnh AWS giải như mọi tab
  // khác của `/infra` (`sessionId: null`), không mượn ngữ cảnh của phiên đang mở.
  const infraContext = useInfraContext({ sessionId: null })
  const { effective } = infraContext

  // ── Điểm vào (root) ────────────────────────────────────────────────────────
  const roots = ref<InfraGraphRoot[]>([])
  const rootsNotes = ref<string[]>([])
  const rootsLoading = ref(false)
  const rootsError = ref('')
  const rootsLoaded = ref(false)

  // ── Lượt dựng đang xem ─────────────────────────────────────────────────────
  const activeRootId = ref('')
  const depth = ref(GRAPH_DEFAULT_DEPTH)

  const nodes = ref<InfraGraphNode[]>([])
  const edges = ref<InfraGraphEdge[]>([])
  /** Node id là điểm vào của lượt dựng hiện tại (để đánh dấu trên canvas). */
  const graphRootIds = ref<string[]>([])
  const truncated = ref(false)
  const trafficSource = ref<InfraTrafficSource>('none')
  const notesRaw = ref<string[]>([])

  const resolving = ref(false)
  /** Node đang mở rộng — giữ TÊN node (không phải boolean) để chỉ nút đó quay. */
  const expandingNodeId = ref('')
  const selectedNodeId = ref('')
  const graphError = ref('')
  /** Mốc lượt dựng gần nhất xong — dữ liệu hạ tầng cũ trông y hệt dữ liệu mới. */
  const loadedAt = ref(0)

  const hasGraph = computed(() => nodes.value.length > 0)
  const busy = computed(() => resolving.value || !!expandingNodeId.value)

  /**
   * Ghi chú của resolver, TRỪ bốn khoá mà màn này đã nói bằng chính trường dữ liệu
   * của hợp đồng: `trafficXray`/`trafficCloudwatch`/`trafficNone` trùng 1:1 với dải
   * `trafficSource`, `depthTruncated` trùng 1:1 với cờ `truncated`. In cả hai là nói
   * cùng một câu hai lần, đọc ra như lỗi.
   *
   * `trafficBlocked` CỐ Ý ở lại: nó là ca `trafficSource: 'none'` do bị cổng quyền
   * chặn, tức "chưa biết" chứ không phải "không có" — dải theo `trafficSource` không
   * nói được khác biệt đó.
   */
  const BANNERED_NOTES = new Set([
    'infra.graph.note.trafficXray',
    'infra.graph.note.trafficCloudwatch',
    'infra.graph.note.trafficNone',
    'infra.graph.note.depthTruncated',
  ])
  const notes = computed(() => notesRaw.value.filter((key) => !BANNERED_NOTES.has(key)))

  const selectedNode = computed(
    () => nodes.value.find((n) => n.id === selectedNodeId.value) ?? null,
  )

  /** Bố cục x/y của các node đang có — VueFlow chỉ vẽ theo toạ độ này. */
  const positions = computed(() =>
    layoutGraph(
      nodes.value.map((n) => n.id),
      edges.value,
    ),
  )

  const rootOptions = computed(() =>
    roots.value.map((r) => ({
      label: r.region ? `${r.label} · ${r.region}` : r.label,
      value: r.id,
    })),
  )

  // ── Ngữ cảnh + minh chứng ghi nhật ký ──────────────────────────────────────
  const awsContext = computed<GraphContext>(() => {
    const c = effective.value
    const out: GraphContext = {}
    if (c.profile) out.profile = c.profile
    if (c.region) out.region = c.region
    if (c.accountId) out.accountId = c.accountId
    return out
  })

  /** Chip ngữ cảnh của hộp duyệt — cùng bộ trường với mọi bề mặt hạ tầng khác. */
  function confirmContext(): InfraConfirmContext {
    const c = effective.value
    const out: InfraConfirmContext = {}
    if (c.profile) out.profile = c.profile
    if (c.region) out.region = c.region
    if (c.accountId) out.accountId = c.accountId
    return out
  }

  function provenance(): { sessionId?: string; messageId?: string } {
    const out: { sessionId?: string; messageId?: string } = {}
    if (options.sessionId) out.sessionId = options.sessionId
    if (options.messageId) out.messageId = options.messageId
    return out
  }

  function messageOf(err: unknown): string {
    return err instanceof Error && err.message.trim()
      ? err.message.trim()
      : t('infra.graph.error.engine')
  }

  /**
   * Ô lỗi của màn nhận HAI loại chuỗi: khoá i18n do sidecar phát
   * (`infra.graph.error.badRoot`) và câu lỗi thật của AWS CLI / transport. `t()`
   * trả lại chính khoá khi không tra được, nên nó là phép chuyển an toàn cho cả
   * hai — không có nhánh nào phải đoán trước.
   */
  function errorText(raw: string): string {
    return raw ? t(raw) : ''
  }

  /** Vé chỉ gắn vân tay của lớp lệnh; hộp duyệt chỉ có ba nhánh footer. */
  function classOf(raw: string): InfraActionClass {
    return raw === 'write' || raw === 'destructive' ? raw : 'read'
  }

  function rootLabel(id: string): string {
    return roots.value.find((r) => r.id === id)?.label || id
  }

  /**
   * Chạy một lượt gọi qua cổng quyền, xử lý ĐÚNG một vòng duyệt.
   *
   * `requiresApproval: false` (ma trận chặn hẳn) hoặc vé vắng ⇒ hộp duyệt chỉ có
   * nút chép lệnh và ta KHÔNG gọi lại — mời người dùng duyệt một việc không có vé
   * là dẫn họ vào ngõ cụt. Lỗi trả về dưới dạng `{ok:false}` để người gọi tự đặt
   * vào ô lỗi của màn nó, không đổ chung một biến.
   *
   * `T` PHẢI truyền tường minh (`callGated<InfraGraph>(...)`): các lượt gọi đều đi
   * qua `.then()` để chuyển hình dạng, mà suy luận của TS không xuyên được qua type
   * tham số của `then` ⇒ `T` rơi về `unknown` và `res.value` mất kiểu.
   */
  async function callGated<T>(
    invoke: (ticket?: string) => Promise<GateReply<T>>,
    meta: { action: string; target: string; consequence: string },
  ): Promise<GatedResult<T>> {
    let first: Awaited<ReturnType<typeof invoke>> | null = null
    try {
      first = await invoke()
    } catch (err) {
      return { ok: false, error: messageOf(err) }
    }
    if (!first) return { ok: false, error: t('infra.graph.error.engine') }
    if (first.ok) return { ok: true, value: first.value }
    if (!first.blocked) return { ok: false, error: first.error }

    const hardBlocked = first.requiresApproval !== true || !first.approvalTicket
    const approved = await confirm({
      kind: 'infra',
      action: meta.action,
      target: meta.target,
      consequence: first.reason || meta.consequence,
      command: first.command,
      context: confirmContext(),
      accountKind: first.accountKind === 'production' ? 'production' : 'normal',
      class: classOf(first.class),
      blocked: hardBlocked,
    })
    if (hardBlocked || !approved || !first.approvalTicket) return { ok: false, error: '' }

    // Vé gắn vân tay của đúng lời gọi này và chỉ dùng được một lần ⇒ gọi lại y
    // nguyên payload cũ, không sửa gì giữa hai lượt.
    try {
      const retry = await invoke(first.approvalTicket)
      if (retry.ok) return { ok: true, value: retry.value }
      return { ok: false, error: retry.blocked ? retry.reason : retry.error }
    } catch (err) {
      return { ok: false, error: messageOf(err) }
    }
  }

  // ── Điểm vào ───────────────────────────────────────────────────────────────
  async function loadRoots(refresh = false): Promise<void> {
    if (rootsLoading.value) return
    if (rootsLoaded.value && !refresh) return
    rootsLoading.value = true
    rootsError.value = ''
    const res = await callGated<{ roots: InfraGraphRoot[]; notes: string[] }>(
      (ticket) =>
        api
          .roots({
            context: awsContext.value,
            ...provenance(),
            ...(ticket ? { approvalTicket: ticket } : {}),
          })
          .then((r) =>
            r.ok ? { ok: true as const, value: { roots: r.roots, notes: r.notes } } : r,
          ),
      {
        action: t('infra.graph.act.roots'),
        target: t('infra.graph.root.target'),
        consequence: t('infra.graph.act.rootsWhy'),
      },
    )
    rootsLoading.value = false
    if (!res.ok) {
      // Người dùng huỷ hộp duyệt (`error` rỗng) không phải lỗi để hiện lên.
      if (res.error) rootsError.value = errorText(res.error)
      return
    }
    roots.value = res.value.roots
    rootsNotes.value = res.value.notes
    rootsLoaded.value = true
  }

  // ── Gộp graph ──────────────────────────────────────────────────────────────
  /**
   * Gộp một lượt dựng vào state. `replace` = lượt `resolve` (thay toàn bộ);
   * `false` = lượt `expand` (hợp nhất phần MỚI vào graph đang có).
   *
   * Gộp theo `id` chứ không nối mảng: một node đã có có thể quay lại ở lượt mở rộng
   * (kèm cờ `expandable` mới), nối thẳng sẽ tạo hai node trùng id trên canvas.
   *
   * BA TRƯỜNG KHÔNG ĐƯỢC GÁN ĐÈ ở lượt hợp nhất, vì `graph-expand` trả ĐÚNG phần
   * mới của một hop chứ không phải ảnh chụp cả đồ thị:
   *   · `roots` của lượt mở rộng là node VỪA MỞ, không phải điểm vào ⇒ gán đè thì
   *     nhãn "điểm vào" nhảy sang node người dùng vừa bấm;
   *   · `truncated` của lượt mở rộng luôn `false` (một hop, không áp trần) ⇒ gán đè
   *     sẽ xoá mất lời báo chạm trần mà lượt `resolve` vừa nói, trong khi các nhánh
   *     bị cắt vẫn còn nguyên trên màn;
   *   · `notes` của lượt mở rộng chỉ thuộc hop đó ⇒ gán đè sẽ nuốt ghi chú cũ
   *     ("có node khác vùng", "có secret tham chiếu") dù node đó vẫn đang hiện.
   */
  function applyGraph(graph: InfraGraph, replace: boolean): boolean {
    let addedNew = true
    if (replace) {
      nodes.value = graph.nodes
      edges.value = graph.edges
      if (graph.roots.length) graphRootIds.value = graph.roots
      truncated.value = graph.truncated
      notesRaw.value = [...graph.notes]
    } else {
      const byId = new Map(nodes.value.map((n) => [n.id, n]))
      addedNew = graph.nodes.some((n) => !byId.has(n.id))
      graph.nodes.forEach((n) => byId.set(n.id, n))
      nodes.value = [...byId.values()]
      const edgeIds = new Set(edges.value.map((e) => e.id))
      const freshEdges = graph.edges.filter((e) => !edgeIds.has(e.id))
      addedNew = addedNew || freshEdges.length > 0
      edges.value = [...edges.value, ...freshEdges]
      truncated.value = truncated.value || graph.truncated
      notesRaw.value = [...new Set([...notesRaw.value, ...graph.notes])]
    }
    trafficSource.value = graph.trafficSource
    if (selectedNodeId.value && !nodes.value.some((n) => n.id === selectedNodeId.value)) {
      selectedNodeId.value = ''
    }
    return addedNew
  }

  /**
   * Tắt cờ `expandable` của một node. Cần đến vì `graph-expand` KHÔNG trả lại chính
   * node vừa mở (chỉ trả phần mới), nên resolver không bao giờ có dịp cập nhật cờ
   * đó — để nguyên thì nút "mở rộng" ở lại vĩnh viễn và mời người dùng bấm vào một
   * việc không làm gì.
   */
  function markUnexpandable(nodeId: string): void {
    nodes.value = nodes.value.map((n) => (n.id === nodeId ? { ...n, expandable: false } : n))
  }

  // ── Dựng graph từ một điểm vào ─────────────────────────────────────────────
  async function resolve(rootId: string, withDepth = depth.value): Promise<void> {
    if (!rootId || busy.value) return
    activeRootId.value = rootId
    depth.value = withDepth
    resolving.value = true
    graphError.value = ''
    const res = await callGated<InfraGraph>(
      (ticket) =>
        api
          .resolve({
            context: awsContext.value,
            rootId,
            depth: withDepth,
            ...provenance(),
            ...(ticket ? { approvalTicket: ticket } : {}),
          })
          .then((r) => (r.ok ? { ok: true as const, value: r.graph } : r)),
      {
        action: t('infra.graph.act.resolve'),
        target: rootLabel(rootId),
        consequence: t('infra.graph.act.resolveWhy'),
      },
    )
    resolving.value = false
    if (!res.ok) {
      if (res.error) graphError.value = errorText(res.error)
      return
    }
    applyGraph(res.value, true)
    loadedAt.value = Date.now()
  }

  /** ↻ — dựng lại ĐÚNG điểm vào + độ sâu đang xem. */
  async function reload(): Promise<void> {
    if (!activeRootId.value) return
    await resolve(activeRootId.value)
  }

  /**
   * Đổi độ sâu: dựng lại ngay để con số trên màn khớp lượt dựng đang xem. Chọn lại
   * ĐÚNG độ sâu cũ là chuyện thường (bảng chọn vẫn nhận cú bấm vào dòng đang chọn)
   * và một lượt dựng là nhiều lệnh `describe-*` qua cổng quyền, nên thoát sớm.
   */
  async function setDepth(next: number): Promise<void> {
    const clamped = Math.max(1, Math.min(GRAPH_MAX_DEPTH, Math.round(next)))
    if (clamped === depth.value) return
    depth.value = clamped
    if (activeRootId.value) await resolve(activeRootId.value, clamped)
  }

  /**
   * Mở rộng ĐÚNG một node thêm một bước.
   *
   * Cờ `expandable` của node VỪA MỞ do ta suy ra từ chính lượt này: resolver không
   * trả lại node đó nên không có nguồn nào khác cập nhật cờ ấy. Lượt mở rộng không
   * mang thêm node/cạnh nào ⇒ nó không còn gì để đi tiếp.
   */
  async function expand(nodeId: string): Promise<void> {
    if (busy.value) return
    const node = nodes.value.find((n) => n.id === nodeId)
    if (!node || !node.expandable) return
    expandingNodeId.value = nodeId
    graphError.value = ''
    const res = await callGated<InfraGraph>(
      (ticket) =>
        api
          .expand({
            context: awsContext.value,
            nodeId,
            ...provenance(),
            ...(ticket ? { approvalTicket: ticket } : {}),
          })
          .then((r) => (r.ok ? { ok: true as const, value: r.graph } : r)),
      {
        action: t('infra.graph.act.expand'),
        target: node.label,
        consequence: t('infra.graph.act.expandWhy'),
      },
    )
    expandingNodeId.value = ''
    if (!res.ok) {
      if (res.error) graphError.value = errorText(res.error)
      return
    }
    if (!applyGraph(res.value, false)) markUnexpandable(nodeId)
    loadedAt.value = Date.now()
  }

  function selectNode(id: string): void {
    selectedNodeId.value = id
  }

  return {
    // điểm vào
    roots,
    rootsNotes,
    rootsLoading,
    rootsError,
    rootsLoaded,
    rootOptions,
    loadRoots,
    // lượt dựng
    activeRootId,
    depth,
    nodes,
    edges,
    graphRootIds,
    positions,
    truncated,
    trafficSource,
    notes,
    hasGraph,
    busy,
    resolving,
    expandingNodeId,
    selectedNode,
    selectedNodeId,
    graphError,
    loadedAt,
    resolve,
    reload,
    setDepth,
    expand,
    selectNode,
  }
}

export type InfraGraphController = ReturnType<typeof useInfraGraph>
