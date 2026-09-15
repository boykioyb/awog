// Page-controller của `/playbooks` (Mốc 5, việc 5.5 — workstream A4).
//
// SFC chỉ bind; toàn bộ state + lời gọi RPC nằm ở đây (khuôn page-controller của
// .claude/rules/nuxt-vue.md §Composable).
//
// VÒNG ĐỜI THEO `runId`. Một lượt chạy sinh ra ở `submit` và trả về `run`; từ đó
// `approve`/`run`/`rollback` đều làm việc trên `run.id`. Playbook KHÔNG có trạng
// thái riêng — nên "đang chờ duyệt" / "đã chạy" là của bản ghi chạy đang xem, không
// phải của dòng trong danh sách.
//
// BỐN LUẬT CỦA TRANG (từ `docs/features/playbooks.md`):
//   1. SIMPLE/EXPERT nhớ theo người dùng, và Simple là mặc định.
//   2. Hộp xác nhận nói HẬU QUẢ trước rồi mới tới lệnh, kèm chip ngữ cảnh — đi qua
//      `useConfirm({ kind: 'infra' })` (ADR 0088 §5), KHÔNG tự vẽ hộp riêng.
//   3. Trạng thái rỗng / lỗi phải nói CÁCH SỬA.
//   4. Playbook thiếu bước quay lui ⇒ nút gửi duyệt TẮT kèm lý do. Hàng rào thật
//      nằm ở sidecar (`PlaybookSummary.canSubmit` / `.missingRollback`), UI chỉ phản
//      ánh — KHÔNG tự đoán lại luật ghép cặp `do`↔`rollback` ở client.
//
// KHÔNG TỰ CHẠY CLI SAU LƯNG NGƯỜI DÙNG. `list`/`read`/`runs` chỉ đọc file cục bộ
// nên nạp khi mở; còn `preflight`/`run`/`rollback`/graph đều đứng sau một cú bấm.
import { computed, onMounted, ref } from 'vue'
import { useConfirm } from '~/composables/useConfirm'
import { useInfraContext } from '~/composables/useInfraContext'
import { useInfraGraphApi } from '~/composables/useInfraGraphApi'
import { useI18n } from '~/composables/useI18n'
import {
  buildImpact,
  stepClass,
  stepServices,
  usePlaybooksApi,
} from '~/composables/usePlaybooksApi'
import { useToast } from '~/composables/useToast'
import { useProjectsStore } from '~/stores/projects'
import type { InfraActionClass, InfraConfirmContext } from '~/composables/useConfirm'
import type { InfraGraph, InfraGraphRoot } from '~/composables/useInfraGraphApi'
import type {
  Playbook,
  PlaybookCheckResult,
  PlaybookImpactNode,
  PlaybookIssue,
  PlaybookRun,
  PlaybookRunParams,
  PlaybookScope,
  PlaybookSource,
  PlaybookStep,
  PlaybookStepRunStatus,
  PlaybookSummary,
  PlaybookTier,
  PlaybookVariable,
} from '~/composables/usePlaybooksApi'
import type { InfraContext } from '~/types'

/** Trần số gốc graph dựng mỗi lượt suy ảnh hưởng — chặn một lượt bấm thành 20 lệnh CLI. */
const MAX_GRAPH_ROOTS = 6
/** Độ sâu xin từ resolver; trần thật của resolver là 4. */
const GRAPH_DEPTH = 3
/** Số hồ sơ chạy cũ nạp cho bản đang mở — trần hợp đồng của `-runs` là 100. */
const RUNS_LIMIT = 20
/** Trần `projectIds` của `-list`. Vượt trần là cả lời gọi bị schema từ chối. */
const MAX_PROJECT_IDS = 50
/** Chế độ đọc của trang, nhớ theo người dùng (luật 1). */
const MODE_KEY = 'awog.playbooks.mode'

export type PlaybookMode = 'simple' | 'expert'

/**
 * Trạng thái của lời gọi graph. `unavailable` KHÁC `error`: `unavailable` là "chưa
 * dựng được graph" (chưa có gốc nào / resolver trả rỗng) — UI chỉ đường sang dựng
 * graph; `error` là lời gọi hỏng và người dùng bấm lại được.
 */
export type PlaybookGraphState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'

/** Một cột của sơ đồ ba hàng: một bước + dịch vụ nó chạm + ảnh hưởng lan của nó. */
export type PlaybookDiagramColumn = {
  step: PlaybookStep
  index: number
  services: string[]
  klass: InfraActionClass
  impact: PlaybookImpactNode[]
  /** Trạng thái khi chạy thật (`null` = chưa chạy/kiểm lượt nào trong phiên này). */
  state: PlaybookStepRunStatus | null
  /** Khoá i18n của cảnh báo ngắn gắn trên thẻ bước. */
  warnKeys: string[]
}

/** Nhóm của cột trái. Nhóm theo LOẠI playbook — playbook không có "trạng thái" để gom. */
export type PlaybookGroupKey = 'deployment' | 'guide'
const GROUPS: readonly PlaybookGroupKey[] = ['deployment', 'guide']

/** Tóm tắt quay lui: đủ cho bao nhiêu bước ghi, thiếu id nào. */
export type PlaybookRollbackView = {
  covered: number
  total: number
  missing: number
  missingIds: readonly string[]
}

/** Mọi thứ màn chi tiết bind — gói làm một để chữ ký component không phình ra 15 prop. */
export type PlaybookDetailView = {
  columns: PlaybookDiagramColumn[]
  touchedServices: string[]
  /**
   * Nguồn của bản đang mở. CHỈ `PlaybookSummary` có trường này — `Playbook` (bản
   * đầy đủ) không mang nguồn, vì nguồn là chuyện của VỊ TRÍ trên đĩa. Vắng mặt khi
   * chưa mở bản nào.
   */
  source?: PlaybookSource
  /** Chỗ sai của file (rỗng = lành). Khác rỗng ⇒ `canSubmit` cũng sai. */
  issues?: readonly PlaybookIssue[]
  rollback: PlaybookRollbackView
  /** Còn gửi duyệt được không (luật rollback của sidecar + trạng thái hiện tại). */
  canSubmit: boolean
  canApprove: boolean
  canRun: boolean
  canRollback: boolean
  busy: boolean
  mode: PlaybookMode
  variables: readonly PlaybookVariable[]
  values: Record<string, string>
  requiredMissing: readonly PlaybookVariable[]
  graph: InfraGraph | null
  graphState: PlaybookGraphState
  graphMessage: string
  preflight: readonly PlaybookCheckResult[] | null
  run: PlaybookRun | null
  runs: readonly PlaybookRun[]
}

const mode = ref<PlaybookMode>('simple')
let modeLoaded = false

/** Đọc lựa chọn đã nhớ đúng một lần cho cả app (luật 1). */
function loadMode(): void {
  if (modeLoaded) return
  modeLoaded = true
  const saved = localStorage.getItem(MODE_KEY)
  if (saved === 'expert' || saved === 'simple') mode.value = saved
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Danh tính một playbook: `source` là một phần của khoá, không bao giờ suy từ kết quả dò. */
function summaryKey(s: PlaybookSummary): string {
  return `${s.source}:${s.projectId ?? ''}:${s.id}`
}

function scopeOf(s: PlaybookSummary): PlaybookScope {
  return { source: s.source, id: s.id, ...(s.projectId ? { projectId: s.projectId } : {}) }
}

/**
 * Phần chung của mọi lượt bị cổng quyền chặn (§2 hợp đồng Mốc 5). Playbook
 * (`runner.ts:PlaybookBlocked`) và graph (`useInfraGraphApi.ts:GraphBlocked`) trả
 * CÙNG shape này, nên hộp duyệt dùng chung một đường.
 *
 * Đây là hình dạng CẤU TRÚC để nhận cả hai nguồn (`class`/`mode` rộng hơn union
 * miền), không phải bản khai lại kiểu của sidecar — kiểu miền đầy đủ nằm ở
 * `usePlaybooksApi.PlaybookBlocked` và `useInfraGraphApi.GraphBlocked`.
 */
type BlockedReply = {
  ok: false
  blocked: true
  requiresApproval: boolean
  approvalTicket?: string
  command: string
  reason: string
  class: string
  accountKind: string
  mode: string
}

type GatedReply<T> =
  | { ok: true; value: T }
  | BlockedReply
  | { ok: false; blocked: false; error: string }

export function usePlaybooksManager() {
  const api = usePlaybooksApi()
  const graphApi = useInfraGraphApi()
  const toast = useToast()
  const { confirm } = useConfirm()
  const { t } = useI18n()
  const projects = useProjectsStore()
  // Trang đứng NGOÀI mọi phiên (như `/infra`), nên tầng phiên bị bỏ qua.
  const infraContext = useInfraContext({ sessionId: null })

  loadMode()

  // ── Danh sách ─────────────────────────────────────────────────────────────
  const summaries = ref<PlaybookSummary[]>([])
  const loading = ref(false)
  const error = ref('')

  // ── Bản đang mở ───────────────────────────────────────────────────────────
  const selected = ref<PlaybookSummary | null>(null)
  const current = ref<{ playbook: Playbook; summary: PlaybookSummary } | null>(null)
  const detailLoading = ref(false)
  const detailError = ref('')
  const variables = ref<Record<string, string>>({})
  const busy = ref(false)

  // ── Kết quả chạy ──────────────────────────────────────────────────────────
  const preflightResults = ref<PlaybookCheckResult[] | null>(null)
  /** Bản ghi chạy đang xem (mới nhất trong phiên) — mọi hành động sau `submit` dùng `run.id`. */
  const run = ref<PlaybookRun | null>(null)
  const runs = ref<PlaybookRun[]>([])

  // ── Graph ─────────────────────────────────────────────────────────────────
  const graph = ref<InfraGraph | null>(null)
  const graphState = ref<PlaybookGraphState>('idle')
  const graphMessage = ref('')

  /**
   * Ngữ cảnh hạ tầng dùng cho MỌI lời gọi của trang — cùng ngữ cảnh với `/infra`.
   * SÁU trường chứ không phải ba: bước `terraform` cần `workspace`, bước `kubectl`
   * cần `cluster`/`namespace`, và một ngữ cảnh bị cắt cụt ở đây là một lệnh chạy
   * nhầm chỗ.
   */
  const ctx = computed<InfraContext>(() => {
    const c = infraContext.effective.value
    const out: InfraContext = {}
    if (c.profile) out.profile = c.profile
    if (c.region) out.region = c.region
    if (c.accountId) out.accountId = c.accountId
    if (c.cluster) out.cluster = c.cluster
    if (c.namespace) out.namespace = c.namespace
    if (c.workspace) out.workspace = c.workspace
    return out
  })

  /** Chip ngữ cảnh của hộp duyệt — cùng bộ trường với mọi bề mặt hạ tầng khác. */
  function confirmContext(): InfraConfirmContext {
    const c = ctx.value
    const out: InfraConfirmContext = {}
    if (c.profile) out.profile = c.profile
    if (c.region) out.region = c.region
    if (c.accountId) out.accountId = c.accountId
    if (c.cluster) out.cluster = c.cluster
    if (c.namespace) out.namespace = c.namespace
    return out
  }

  const selectedKey = computed(() => (selected.value ? summaryKey(selected.value) : ''))
  const total = computed(() => summaries.value.length)

  function groupOf(s: PlaybookSummary): PlaybookGroupKey {
    return s.kind === 'instruction' ? 'guide' : 'deployment'
  }

  /** Nhóm RỖNG không hiện: một tiêu đề không có dòng nào là chỗ nhiễu, không phải thông tin. */
  const groups = computed(() =>
    GROUPS.map((key) => ({ key, items: summaries.value.filter((s) => groupOf(s) === key) })).filter(
      (g) => g.items.length > 0,
    ),
  )

  // ── Nạp ───────────────────────────────────────────────────────────────────
  /**
   * Danh sách project đã đăng ký. Phải có TRƯỚC `-list`: `projectIds` là cách duy
   * nhất để playbook tier project hiện ra, mà roster thì `hydrate()` mới có — store
   * KHÔNG tự nạp. `loaded` làm nó thành một lần cho mỗi phiên trang.
   */
  async function ensureProjects(): Promise<void> {
    if (projects.loaded) return
    await projects.hydrate()
  }

  /**
   * Nạp danh sách. Chỉ đọc file cục bộ (`~/.awog/playbooks` + `{project}/.awog/playbooks`)
   * nên được phép gọi khi mở trang — không tốn lời gọi AWS nào.
   *
   * `projectIds` của MỌI project đã đăng ký: trang này không có bộ chọn project, và
   * bỏ trống thì playbook tier project không bao giờ hiện ra.
   */
  async function load(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      await ensureProjects()
      const projectIds = projects.projects.map((p) => p.id).slice(0, MAX_PROJECT_IDS)
      const res = await api.list({ projectIds })
      summaries.value = res.playbooks
      // Bản đang mở có thể vừa bị xoá/đổi ở ngoài app — bỏ chọn nếu nó biến mất.
      if (selected.value && !summaries.value.some((s) => summaryKey(s) === selectedKey.value)) {
        selected.value = null
        current.value = null
      }
    } catch (err) {
      error.value = messageOf(err)
      summaries.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Nạp hồ sơ các lần chạy cũ của bản đang mở (đọc file, không gọi CLI).
   *
   * Đọc lại bản ĐANG XEM từ đĩa nếu nó có trong hồ sơ: khi một lượt bị cổng quyền
   * chặn GIỮA ĐƯỜNG, sidecar ghi bước `blocked` + trả trạng thái về `approved` rồi
   * mới trả kết quả — mà kết quả đó (`PlaybookBlocked`) KHÔNG kèm `run`. Không đọc
   * lại thì panel còn nói bước đó đang `running` trong khi trên đĩa nó đã `blocked`.
   */
  async function loadRuns(): Promise<void> {
    const pb = current.value?.playbook
    if (!pb) return
    try {
      const res = await api.runs({ playbookId: pb.id, limit: RUNS_LIMIT })
      runs.value = res.runs
      const live = res.runs.find((r) => r.id === run.value?.id)
      if (live) run.value = live
    } catch {
      // Mất hồ sơ cũ không được làm hỏng việc đang mở: đây là cột phụ, để rỗng.
      runs.value = []
    }
  }

  /**
   * Mở một playbook. `read` trả bản đầy đủ (danh sách chỉ là bản tóm tắt), rồi nạp
   * hồ sơ chạy. KHÔNG tự dựng graph: mỗi lượt dựng là nhiều lệnh `aws` — để người
   * dùng bấm (xem `resolveImpact`).
   */
  async function open(summary: PlaybookSummary): Promise<void> {
    selected.value = summary
    detailLoading.value = true
    detailError.value = ''
    preflightResults.value = null
    run.value = null
    runs.value = []
    resetGraph()
    try {
      const res = await api.read(scopeOf(summary))
      if (!res.ok) {
        current.value = null
        detailError.value = t(res.error)
        return
      }
      current.value = { playbook: res.playbook, summary: res.summary }
      variables.value = seedVariables(res.playbook)
      void loadRuns()
    } catch (err) {
      current.value = null
      detailError.value = messageOf(err)
    } finally {
      detailLoading.value = false
    }
  }

  /** Nạp lại đúng bản đang mở (nút "Thử lại" của màn chi tiết). */
  function reloadCurrent(): void {
    if (selected.value) void open(selected.value)
  }

  /** Biến của playbook: điền sẵn giá trị mặc định, người dùng sửa trên form. */
  function seedVariables(pb: Playbook): Record<string, string> {
    const out: Record<string, string> = {}
    for (const v of pb.variables) out[v.name] = v.default ?? ''
    return out
  }

  // ── Cổng quyền dùng chung (ADR 0088 §5) ───────────────────────────────────
  /**
   * Nhãn đích của hộp duyệt: playbook, cộng tên bước nếu lời gọi nói được bước nào
   * (`PlaybookBlocked` mang `stepId`/`stepNumber`) — người duyệt phải biết mình đang
   * duyệt việc gì.
   */
  function blockedTarget(res: BlockedReply, target: string): string {
    const stepId = 'stepId' in res && typeof res.stepId === 'string' ? res.stepId : ''
    const title = current.value?.playbook.steps.find((s) => s.id === stepId)?.title
    return title ? `${target} · ${title}` : target
  }

  /**
   * Hộp duyệt hạ tầng. `requiresApproval === false` = ma trận chặn HẲN ⇒ KHÔNG mời
   * gọi lại, hộp chỉ còn nút chép lệnh. Trả về vé khi người dùng đã duyệt.
   */
  async function confirmBlocked(res: BlockedReply, target: string): Promise<string | null> {
    const klass =
      (['read', 'write', 'destructive'] as const).find((c) => c === res.class) ?? 'write'
    // `blocked: true` ⇒ hộp chỉ có "chép lệnh + đóng", đúng luật §2 của hợp đồng.
    const hardBlocked = !res.requiresApproval || !res.approvalTicket
    const ok = await confirm({
      kind: 'infra',
      action: t('playbooks.confirm.action'),
      target: blockedTarget(res, target),
      consequence: res.reason || t('playbooks.confirm.consequence'),
      command: res.command,
      context: confirmContext(),
      accountKind: res.accountKind === 'production' ? 'production' : 'normal',
      class: klass,
      blocked: hardBlocked,
    })
    return !hardBlocked && ok && res.approvalTicket ? res.approvalTicket : null
  }

  /**
   * Gọi một RPC có cổng, tự xử lý vòng "chặn → mở hộp duyệt → gọi lại kèm vé".
   * Trả `null` khi người dùng không duyệt (hoặc bị chặn hẳn); ném lỗi khi lời gọi hỏng.
   */
  async function gated<T>(
    call: (ticket?: string) => Promise<GatedReply<T>>,
    target: string,
  ): Promise<T | null> {
    let ticket: string | undefined
    for (;;) {
      const res = await call(ticket)
      if (res.ok) return res.value
      if (!res.blocked) throw new Error(t(res.error))
      const next = await confirmBlocked(res, target)
      if (!next) return null
      ticket = next
    }
  }

  /** Tham số của một lượt gọi `-preflight`/`-submit` cho bản đang mở. */
  function runParams(ticket?: string): PlaybookRunParams {
    const s = current.value?.summary
    if (!s) throw new Error(t('playbooks.detail.none.title'))
    return {
      ...scopeOf(s),
      values: variables.value,
      context: ctx.value,
      ...(ticket ? { approvalTicket: ticket } : {}),
    }
  }

  // ── Vòng đời ──────────────────────────────────────────────────────────────
  /**
   * Kiểm tra trước: chạy MỌI bước `check` trước khi chạy bước nào khác.
   *
   * Vòng duyệt viết thẳng ở đây thay vì qua `gated`: `gated` mở gói lấy giá trị
   * THÀNH CÔNG, còn nhánh HỎNG của `-preflight` vẫn mang `checks` — mà bỏ chúng đi
   * là bỏ đúng thứ nút này sinh ra để làm ("biết trước bước nào sẽ hỏng"). Nhánh
   * hỏng vì thế được hiện nguyên, không bị ném thành một dòng toast trống.
   */
  async function preflight(): Promise<void> {
    const cur = current.value
    if (!cur || busy.value) return
    busy.value = true
    try {
      let ticket: string | undefined
      for (;;) {
        const res = await api.preflight(runParams(ticket))
        if (!res.ok && res.blocked) {
          const next = await confirmBlocked(res, cur.playbook.name)
          if (!next) return
          ticket = next
          continue
        }
        if (res.ok) {
          preflightResults.value = res.checks
          const failed = res.checks.filter((c) => !c.ok).length
          toast.add({
            title: failed
              ? t('playbooks.toast.preflightFailed', { n: failed })
              : t('playbooks.toast.preflightOk'),
            color: failed ? 'warning' : 'success',
          })
          return
        }
        // Hỏng thật: hiện đủ kết quả kiểm đã chạy (có thể rỗng), rồi mới báo lỗi.
        preflightResults.value = res.checks
        toast.add({ title: t(res.error), color: 'warning' })
        return
      }
    } catch (err) {
      toast.add({ title: messageOf(err), color: 'error' })
    } finally {
      busy.value = false
    }
  }

  /**
   * Gửi duyệt — TẠO bản ghi chạy và giữ nó làm bản đang xem (luật 4: nút bị tắt khi
   * `summary.canSubmit` sai, hàm này vẫn tự kiểm).
   */
  async function submit(): Promise<void> {
    const cur = current.value
    if (!cur || busy.value || !cur.summary.canSubmit) return
    busy.value = true
    try {
      const next = await gated<PlaybookRun>(
        (ticket) =>
          api
            .submit(runParams(ticket))
            .then((r) => (r.ok ? { ok: true as const, value: r.run } : r)),
        cur.playbook.name,
      )
      if (!next) return
      run.value = next
      toast.add({ title: t('playbooks.toast.submitted'), color: 'success' })
      await loadRuns()
    } catch (err) {
      toast.add({ title: messageOf(err), color: 'error' })
    } finally {
      busy.value = false
    }
  }

  /**
   * Duyệt bản ghi đang chờ. Hợp đồng KHÔNG có "từ chối": `-approve` chỉ duyệt, không
   * có RPC nào ghi hành vi ngược lại, nên UI không mời một việc không làm được.
   */
  async function approve(): Promise<void> {
    const cur = current.value
    const target = run.value
    if (!cur || !target || busy.value || target.status !== 'awaiting-approval') return
    const ok = await confirm({
      title: t('playbooks.confirm.approveTitle'),
      description: t('playbooks.confirm.approveAsk', { name: cur.playbook.name }),
      confirmLabel: t('playbooks.action.approve'),
      kind: 'primary',
    })
    if (!ok) return
    busy.value = true
    try {
      const res = await api.approve({ runId: target.id })
      if (!res.ok) throw new Error(t(res.error))
      run.value = res.run
      toast.add({ title: t('playbooks.toast.approved'), color: 'success' })
      await loadRuns()
    } catch (err) {
      toast.add({ title: messageOf(err), color: 'error' })
    } finally {
      busy.value = false
    }
  }

  /** Chạy kế hoạch. Từng bước qua cổng quyền; bước lỗi thì dừng, không tự nhảy tiếp. */
  async function runPlan(): Promise<void> {
    const cur = current.value
    const target = run.value
    if (!cur || !target || busy.value || !canRun.value) return
    busy.value = true
    try {
      const next = await gated<PlaybookRun>(
        (ticket) =>
          api
            .run({ runId: target.id, ...(ticket ? { approvalTicket: ticket } : {}) })
            .then((r) => (r.ok ? { ok: true as const, value: r.run } : r)),
        cur.playbook.name,
      )
      if (!next) {
        // Không duyệt (hoặc bị chặn hẳn): trên đĩa lượt chạy vừa nhận một bước
        // `blocked` và về lại `approved` — đọc lại để panel nói đúng thay vì kẹt
        // ở trạng thái `running`.
        await loadRuns()
        return
      }
      run.value = next
      toast.add({
        title: t(
          next.status === 'failed' ? 'playbooks.toast.runFailed' : 'playbooks.toast.runDone',
        ),
        color: next.status === 'failed' ? 'error' : 'success',
      })
      await loadRuns()
    } catch (err) {
      toast.add({ title: messageOf(err), color: 'error' })
    } finally {
      busy.value = false
    }
  }

  /**
   * Quay lui: dựng ngược từ bước đã chạy cuối cùng. Vẫn là lệnh ghi, vẫn qua cổng.
   *
   * `ok: true` KHÔNG đồng nghĩa "đã quay lui xong": bước quay lui hỏng đầu tiên cũng
   * trả `ok: true` với `status` còn nguyên — nên lời báo đọc từ `status`, không từ `ok`.
   */
  async function rollback(): Promise<void> {
    const cur = current.value
    const target = run.value
    if (!cur || !target || busy.value || !canRollback.value) return
    busy.value = true
    try {
      const next = await gated<PlaybookRun>(
        (ticket) =>
          api
            .rollback({ runId: target.id, ...(ticket ? { approvalTicket: ticket } : {}) })
            .then((r) => (r.ok ? { ok: true as const, value: r.run } : r)),
        cur.playbook.name,
      )
      if (!next) {
        // Không duyệt: lượt quay lui có thể đã ghi một bước `blocked` xuống đĩa.
        await loadRuns()
        return
      }
      run.value = next
      const done = next.status === 'rolled-back'
      toast.add({
        title: t(done ? 'playbooks.toast.rolledBack' : 'playbooks.toast.rollbackPartial'),
        color: done ? 'success' : 'warning',
      })
      await loadRuns()
    } catch (err) {
      toast.add({ title: messageOf(err), color: 'error' })
    } finally {
      busy.value = false
    }
  }

  // ── Ảnh hưởng lan từ graph ────────────────────────────────────────────────
  function resetGraph(): void {
    graph.value = null
    graphState.value = 'idle'
    graphMessage.value = ''
  }

  /**
   * Dựng graph rồi suy ảnh hưởng lan. Đặt sau một cú bấm vì mỗi gốc là một lời gọi
   * CLI chỉ-đọc (và ma trận quyền có thể siết lớp `read` trên tài khoản production —
   * câu trả lời đúng khi đó là hộp duyệt, không phải bỏ qua).
   */
  async function resolveImpact(): Promise<void> {
    if (graphState.value === 'loading') return
    graphState.value = 'loading'
    graphMessage.value = ''
    try {
      const roots = await gated<InfraGraphRoot[]>(
        (ticket) =>
          graphApi
            .roots({ context: ctx.value, ...(ticket ? { approvalTicket: ticket } : {}) })
            .then((r) => (r.ok ? { ok: true as const, value: r.roots } : r)),
        t('playbooks.diagram.impact.action'),
      )
      if (!roots) {
        graphState.value = 'idle'
        return
      }
      if (roots.length === 0) {
        graphState.value = 'unavailable'
        graphMessage.value = t('playbooks.diagram.impact.noRoots')
        return
      }
      const merged = await mergeRoots(roots.slice(0, MAX_GRAPH_ROOTS))
      if (merged.nodes.length === 0) {
        graphState.value = 'unavailable'
        graphMessage.value = t('playbooks.diagram.impact.noNodes')
        return
      }
      graph.value = merged
      graphState.value = 'ready'
    } catch (err) {
      graphState.value = 'error'
      graphMessage.value = messageOf(err)
    }
  }

  /** Gộp graph của nhiều gốc thành một — node/edge trùng id chỉ giữ một bản. */
  async function mergeRoots(roots: readonly InfraGraphRoot[]): Promise<InfraGraph> {
    const nodes = new Map<string, InfraGraph['nodes'][number]>()
    const edges = new Map<string, InfraGraph['edges'][number]>()
    const notes = new Set<string>()
    let truncated = false
    let trafficSource: InfraGraph['trafficSource'] = 'none'
    for (const root of roots) {
      const value = await gated<InfraGraph>(
        (ticket) =>
          graphApi
            .resolve({
              context: ctx.value,
              rootId: root.id,
              depth: GRAPH_DEPTH,
              ...(ticket ? { approvalTicket: ticket } : {}),
            })
            .then((r) => (r.ok ? { ok: true as const, value: r.graph } : r)),
        root.label,
      )
      if (!value) continue
      for (const n of value.nodes) nodes.set(n.id, n)
      for (const e of value.edges) edges.set(`${e.from}|${e.to}|${e.label}`, e)
      for (const note of value.notes) notes.add(note)
      truncated = truncated || value.truncated
      // Nguồn traffic MẠNH NHẤT trong các lượt gộp: xray nói nhiều hơn cloudwatch.
      if (value.trafficSource === 'xray') trafficSource = 'xray'
      else if (value.trafficSource === 'cloudwatch' && trafficSource === 'none') {
        trafficSource = 'cloudwatch'
      }
    }
    return {
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      roots: roots.map((r) => r.id),
      depth: GRAPH_DEPTH,
      trafficSource,
      truncated,
      notes: [...notes],
    }
  }

  // ── Suy dẫn cho template ──────────────────────────────────────────────────
  /**
   * Trạng thái từng bước của lượt chạy gần nhất, hoặc của lượt kiểm tra trước nếu
   * chưa chạy. Một bước `blocked` giữ nguyên là `blocked` — nó KHÔNG phải `failed`.
   */
  const stepStates = computed<Map<string, PlaybookStepRunStatus>>(() => {
    const map = new Map<string, PlaybookStepRunStatus>()
    const ran = run.value?.steps ?? []
    if (ran.length > 0) {
      for (const s of ran) map.set(s.stepId, s.status)
      return map
    }
    // `PlaybookCheckResult` chỉ có `ok`, không có vòng đời riêng: đạt/xong, hỏng/hỏng.
    for (const c of preflightResults.value ?? []) map.set(c.stepId, c.ok ? 'ok' : 'failed')
    return map
  })

  const diagramColumns = computed<PlaybookDiagramColumn[]>(() => {
    const pb = current.value?.playbook
    if (!pb) return []
    const noRollback = new Set(current.value?.summary.missingRollback ?? [])
    return pb.steps.map((step, index) => {
      const services = stepServices(step)
      const klass = stepClass(step)
      const warnKeys: string[] = []
      if (klass === 'destructive') warnKeys.push('playbooks.diagram.warn.destructive')
      if (noRollback.has(step.id)) warnKeys.push('playbooks.diagram.warn.noRollback')
      return {
        step,
        index,
        services,
        klass,
        impact: graph.value ? buildImpact(graph.value, services) : [],
        state: stepStates.value.get(step.id) ?? null,
        warnKeys,
      }
    })
  })

  /** Mọi dịch vụ playbook chạm tới — dòng tóm tắt ở đầu chi tiết. */
  const touchedServices = computed<string[]>(() => {
    const set = new Set<string>()
    for (const c of diagramColumns.value) for (const s of c.services) set.add(s)
    return [...set]
  })

  /**
   * Luật rollback đọc TỪ SIDECAR (`summary.canSubmit` / `.missingRollback`), không
   * kiểm lại ở client: sidecar đã ghép cặp `do`↔`rollback` THEO CHỈ SỐ, còn client
   * chỉ thấy sự tồn tại — một bản kiểm ở đây sẽ cho qua playbook có 2 `do` mà chỉ 1
   * `rollback`, rồi bị từ chối ở `submit`.
   */
  const rollbackSummary = computed<PlaybookRollbackView>(() => {
    const s = current.value?.summary
    if (!s) return { covered: 0, total: 0, missing: 0, missingIds: [] }
    return {
      covered: s.doCount - s.missingRollback.length,
      total: s.doCount,
      missing: s.missingRollback.length,
      missingIds: s.missingRollback,
    }
  })

  const canSubmit = computed(() => current.value?.summary.canSubmit ?? false)
  const canApprove = computed(() => run.value?.status === 'awaiting-approval')
  const canRun = computed(() => run.value?.status === 'approved' || run.value?.status === 'running')
  const canRollback = computed(
    () => run.value?.status === 'failed' || run.value?.status === 'running',
  )

  const requiredMissing = computed(() =>
    (current.value?.playbook.variables ?? []).filter(
      (v) => v.required && !variables.value[v.name]?.trim(),
    ),
  )

  function setVariable(name: string, value: string): void {
    variables.value = { ...variables.value, [name]: value }
  }

  function setMode(next: PlaybookMode): void {
    mode.value = next
    localStorage.setItem(MODE_KEY, next)
  }

  // ── Xoá ───────────────────────────────────────────────────────────────────

  /**
   * Xoá bản đang mở. KHÔNG đi qua `gated()`: cổng quyền của mốc 5 là cổng cho lệnh
   * chạm vào TÀI KHOẢN AWS, còn đây chỉ xoá một file trong `~/.awog/playbooks` — hỏi
   * ma trận quyền ở đây là dạy người dùng rằng cái hộp đó không có nghĩa cố định.
   * Vẫn phải xác nhận, vì file này có thể là bản người ta soạn cả buổi.
   *
   * Bản dựng sẵn không tới được đây (nút không hiện), và sidecar chặn lần thứ hai.
   */
  async function remove(): Promise<void> {
    const cur = current.value
    if (!cur || busy.value || cur.summary.source === 'builtin') return
    const ok = await confirm({
      title: t('playbooks.confirm.deleteTitle', { name: cur.playbook.name }),
      description: t('playbooks.confirm.deleteBody'),
      confirmLabel: t('playbooks.action.delete'),
      kind: 'danger',
    })
    if (!ok) return
    busy.value = true
    try {
      const res = await api.remove(scopeOf(cur.summary))
      if (!res.ok) {
        toast.add({ title: t(res.error), color: 'error' })
        return
      }
      toast.add({
        title: t('playbooks.toast.deleted', { name: cur.playbook.name }),
        color: 'success',
      })
      selected.value = null
      current.value = null
      await load()
    } catch (err) {
      toast.add({ title: messageOf(err), color: 'error' })
    } finally {
      busy.value = false
    }
  }

  /**
   * Sau khi hộp soạn ghi xong: nạp lại danh sách rồi MỞ đúng bản vừa lưu.
   *
   * Phải dò lại trong danh sách mới chứ không dựng `PlaybookSummary` tại chỗ: bản tóm
   * tắt mang `issues` + số bước do sidecar tính, và bịa ra một bản ở đây là hiện một
   * màn chi tiết nói về một file có thể đã khác.
   */
  async function afterEditorSaved(target: {
    source: PlaybookTier
    projectId: string
    id: string
  }): Promise<void> {
    await load()
    const found = summaries.value.find(
      (s) =>
        s.id === target.id &&
        s.source === target.source &&
        (s.projectId ?? '') === target.projectId,
    )
    if (found) await open(found)
  }

  /**
   * Gói mọi thứ màn chi tiết cần vào MỘT prop. Mười lăm prop rời rạc trên cùng một
   * component là mười lăm chỗ để quên khi thêm một cờ; gói lại thì chữ ký của
   * `<PlaybookDetail>` chỉ còn `playbook` + `view` + các emit hành động.
   */
  const detailView = computed<PlaybookDetailView>(() => ({
    columns: diagramColumns.value,
    touchedServices: touchedServices.value,
    ...(current.value
      ? { source: current.value.summary.source, issues: current.value.summary.issues }
      : {}),
    rollback: rollbackSummary.value,
    canSubmit: canSubmit.value,
    canApprove: canApprove.value,
    canRun: canRun.value,
    canRollback: canRollback.value,
    busy: busy.value,
    mode: mode.value,
    variables: current.value?.playbook.variables ?? [],
    values: variables.value,
    requiredMissing: requiredMissing.value,
    graph: graph.value,
    graphState: graphState.value,
    graphMessage: graphMessage.value,
    preflight: preflightResults.value,
    run: run.value,
    runs: runs.value,
  }))

  onMounted(() => {
    void load()
  })

  return {
    // chế độ đọc + danh sách
    mode,
    setMode,
    groups,
    total,
    loading,
    error,
    load,
    // bản đang mở
    selectedKey,
    current,
    detailLoading,
    detailError,
    open,
    reloadCurrent,
    detailView,
    setVariable,
    // hành động
    busy,
    preflight,
    submit,
    approve,
    runPlan,
    rollback,
    resolveImpact,
    remove,
    afterEditorSaved,
  }
}
