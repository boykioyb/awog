// Page-controller của tab `/infra → Explorer` (Mốc 3, việc 3.1–3.7).
//
// Toàn bộ state + lời gọi RPC nằm ở đây, SFC chỉ bind — khuôn `useInfraKube.ts`.
//
// NĂM LUẬT CỦA FILE NÀY:
//
//   1. KHÔNG TỰ CHẠY. Không `watch`, không `onMounted` nào gọi `list`. Mỗi lần nạp
//      là một lời gọi API thật (spec: "không auto-refresh"), nên nó chỉ xảy ra khi
//      người dùng bấm hoặc chọn view. Hai NGOẠI LỆ, cả hai đều là lệnh ĐỌC rẻ và
//      đều có lý do: `catalog()` (đọc hằng số, không chạm CLI) khiến màn dùng được
//      ngay, và `probe()` (hai lệnh đọc, task 3.3) chạy khi mở view có hành động
//      ghi — nếu không thì "dò quyền lúc mở màn" không có gì để ẩn.
//
//   2. KHÔNG TỰ GHÉP ARGV. UI gửi *ý định* (`viewId` + giá trị form) qua RPC;
//      sidecar validate rồi mới dựng lệnh từ mô tả view. Nhờ vậy một cái tên
//      bucket do AWS bịa ra không bao giờ trở thành cờ của `aws`.
//
//   3. CỔNG QUYỀN KHÔNG ĐƯỢC NHẠI LẠI Ở ĐÂY. `ask` ⇒ sidecar trả vé ⇒ hộp duyệt
//      hạ tầng (`useConfirm kind: 'infra'`) ⇒ gọi lại y nguyên payload kèm vé.
//      `block`/`requiresApproval: false` ⇒ hiện ĐÚNG dòng lệnh để người dùng tự
//      chạy, không có nút chạy. Không đường nào gửi "đã duyệt" do renderer tự khai.
//
//   4. NGỮ CẢNH LÀ CỦA CẢ APP (`sessionId: null`). Đổi account ở Explorer là đổi
//      ngữ cảnh hiệu lực cho cả `/infra` lẫn các phiên kế thừa tầng app — ADR 0088 §7.
//
//   5. TÌM KIẾM LỌC Ở CLIENT, VÀ NÓI THẬT ĐIỀU ĐÓ. `infra-explorer.md` mong muốn
//      đẩy tìm kiếm xuống CLI khi service hỗ trợ `--filters`; Mốc 3 cố ý chưa làm,
//      vì `--filters` của EC2 là AND giữa các filter nên "tìm theo tên HOẶC theo
//      instance id" không diễn đạt được, và một bộ lọc nửa đúng còn tệ hơn không
//      có: nó im lặng bỏ sót dòng. Bảng vì thế lọc trên TRANG ĐÃ NẠP và ghi rõ
//      điều đó cạnh ô tìm, kèm nút "Nạp thêm" để mở rộng phạm vi.
import { computed, ref, watch } from 'vue'
import { useConfirm } from '~/composables/useConfirm'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import { useInfraContext } from '~/composables/useInfraContext'
import { useInfraExplorerCatalog } from '~/composables/useInfraExplorerCatalog'
import { useInfraResourcesApi } from '~/composables/useInfraResourcesApi'
import { useLinkOpen } from '~/composables/useLinkOpen'
import { previewKindFromPath, usePreview } from '~/composables/usePreview'
import { useSidecar } from '~/composables/useSidecar'
import { useToast } from '~/composables/useToast'
import { copyText } from '~/utils/clipboard'
import type { InfraActionClass } from '~/composables/useConfirm'
import type {
  InfraAwsContext,
  InfraBlocked,
  InfraCatalogService,
  InfraFormDescriptor,
  InfraProbeResult,
  InfraResourceRow,
  InfraViewDescriptor,
} from '~/composables/useInfraResourcesApi'

/** Bộ cột đang chọn — nhớ theo NGƯỜI DÙNG (task 3.2). */
export type InfraColumnMode = 'simple' | 'full'

const COLUMN_KEY = 'awog-infra-columns'
/** Trần số dòng giữ trong DOM; quá ngưỡng này bảng chuyển sang cửa sổ ảo hoá. */
export const VIRTUAL_THRESHOLD = 200

function readColumnMode(): InfraColumnMode {
  if (typeof localStorage === 'undefined') return 'simple'
  return localStorage.getItem(COLUMN_KEY) === 'full' ? 'full' : 'simple'
}

// ── Cột trái "Dịch vụ đã ghim": thu gọn + bề rộng kéo được ───────────────────
// Cũng nhớ theo NGƯỜI DÙNG như bộ cột (task 3.2), và cùng lý do: đây là hai thứ
// người dùng chỉnh ĐÚNG MỘT LẦN rồi mong nó ở yên — bảng EC2 rộng 5 cột thì cột
// trái hẹp lại, còn tên view dài thì kéo ra. Quên đi sau mỗi lần mở tab là bắt họ
// chỉnh lại mỗi phiên.
//
// Bề rộng đọc từ localStorage phải được KẸP trong [min, max]: giá trị cũ (hoặc do
// người dùng sửa tay) nằm ngoài khoảng sẽ làm sidebar chiếm hết chỗ của bảng, và
// lúc đó không còn cách nào kéo lại vì tay kéo đã ra ngoài màn hình.
const SIDEBAR_KEY = 'awog-infra-sidebar'
/**
 * Nhóm dịch vụ nào của cột trái đang GẬP. Mặc định là mở HẾT: yêu cầu 2026-09-14
 * "đang chỉ hiển thị danh sách pin, tôi muốn hiển thị full danh sách, hiện thị
 * theo group collapse" — danh mục đầy đủ phải nhìn thấy được ngay, còn gập là để
 * người dùng tự dọn bớt. Nhớ theo người dùng như bề rộng cột: đây là thứ chỉnh
 * một lần rồi mong nó ở yên.
 */
const FOLD_KEY = 'awog-infra-side-groups'
export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 220

/** Kiểu dùng chung với `useResizable` trong SFC — một nguồn số cho cả hai. */
export interface InfraSidebarPrefs {
  collapsed: boolean
  width: number
}

function clampSidebar(width: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)))
}

function readSidebar(): InfraSidebarPrefs {
  const fallback = { collapsed: false, width: SIDEBAR_DEFAULT }
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<InfraSidebarPrefs>
    return {
      collapsed: parsed.collapsed === true,
      width: typeof parsed.width === 'number' ? clampSidebar(parsed.width) : fallback.width,
    }
  } catch {
    // Chuỗi hỏng trong localStorage không được làm sập màn: rơi về mặc định.
    return fallback
  }
}

function readFolded(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(FOLD_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    // Chuỗi hỏng trong localStorage không được làm cột trái trống trơn — mở hết.
    return []
  }
}

export function useInfraExplorer() {
  const api = useInfraResourcesApi()
  const sidecar = useSidecar()
  const toast = useToast()
  const { confirm } = useConfirm()
  const { t } = useI18n()
  const ask = useInfraAskAgent()
  const { openExternally } = useLinkOpen()
  const infraContext = useInfraContext({ sessionId: null })

  // ── Danh mục ──────────────────────────────────────────────────────────────
  // Danh mục + ghim nằm ở `useInfraExplorerCatalog` (state mọc module) vì tab
  // Dịch vụ cũng đọc chúng — hai bản sao của `pinnedServices` là hai sidebar.
  const {
    catalog,
    catalogLoading,
    views,
    services,
    groups,
    pinnedServices,
    sidebarViews,
    togglePin,
    ensureCatalog,
  } = useInfraExplorerCatalog()

  const activeViewId = ref('')
  const activeView = computed<InfraViewDescriptor | null>(
    () => views.value.find((v) => v.id === activeViewId.value) ?? null,
  )

  const columnMode = ref<InfraColumnMode>(readColumnMode())
  function setColumnMode(next: InfraColumnMode): void {
    columnMode.value = next
    if (typeof localStorage !== 'undefined') localStorage.setItem(COLUMN_KEY, next)
  }
  const columns = computed(() => {
    const view = activeView.value
    if (!view) return []
    return columnMode.value === 'full' ? view.columns.full : view.columns.simple
  })

  // Cột trái (xem khối `SIDEBAR_*` ở đầu file). Ghi ngay khi đổi, không đợi rời màn:
  // người dùng kéo tay kéo rồi đóng tab bằng ⌘W là chuyện thường.
  const initialSidebar = readSidebar()
  const sidebarCollapsed = ref(initialSidebar.collapsed)
  const sidebarWidth = ref(initialSidebar.width)
  function writeSidebar(): void {
    if (typeof localStorage === 'undefined') return
    const prefs: InfraSidebarPrefs = {
      collapsed: sidebarCollapsed.value,
      width: sidebarWidth.value,
    }
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify(prefs))
  }
  function setSidebarCollapsed(next: boolean): void {
    sidebarCollapsed.value = next
    writeSidebar()
  }
  function setSidebarWidth(next: number): void {
    sidebarWidth.value = clampSidebar(next)
    writeSidebar()
  }

  // ── Cột trái: danh mục ĐẦY ĐỦ, nhóm gập được (2026-09-14) ─────────────────
  //
  // Bản trước chỉ liệt kê dịch vụ ĐÃ GHIM, nên người chưa ghim gì chỉ thấy một
  // câu trống và phải mở danh mục mới biết mình có những gì — trong khi câu hỏi
  // đầu tiên của người mới là "tài khoản này có những dịch vụ nào". Nay cột trái
  // là CHÍNH danh mục đó, xếp theo nhóm việc và gập được; nhóm ghim vẫn đứng đầu
  // vì nó là lối tắt người dùng tự dựng.
  //
  // Nguồn dữ liệu là `services`/`groups` của danh mục (state mọc module, dùng
  // chung với mặt danh mục của tab) — cột trái KHÔNG tự khai danh sách thứ hai.
  const foldedGroups = ref<string[]>(readFolded())
  function toggleGroup(id: string): void {
    foldedGroups.value = foldedGroups.value.includes(id)
      ? foldedGroups.value.filter((g) => g !== id)
      : [...foldedGroups.value, id]
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FOLD_KEY, JSON.stringify(foldedGroups.value))
    }
  }
  function isFolded(id: string): boolean {
    return foldedGroups.value.includes(id)
  }

  /** Nhóm "đã ghim" — đứng đầu cột, giữ ĐÚNG thứ tự người dùng ghim. */
  const pinnedEntries = computed<InfraCatalogService[]>(() =>
    pinnedServices.value
      .map((id) => services.value.find((s) => s.id === id))
      .filter((s): s is InfraCatalogService => s !== undefined),
  )

  /** Cả danh mục, chia theo nhóm việc — thứ tự nhóm theo sidecar, không theo A-Z. */
  const serviceGroups = computed<{ id: string; services: InfraCatalogService[] }[]>(() =>
    groups.value
      .map((id) => ({ id, services: services.value.filter((s) => s.group === id) }))
      .filter((g) => g.services.length > 0),
  )

  /**
   * Nhãn của một mục trong cột trái. Dịch vụ CÓ màn riêng thì mượn nhãn của VIEW
   * ("EC2 — Instances") chứ không phải tên dịch vụ ("EC2"): mục này mở đúng view
   * đó, và tên view là thứ người dùng đã đọc ở tiêu đề bảng. Dịch vụ chỉ có
   * Console thì không có view để mượn — dùng tên dịch vụ.
   */
  function entryLabel(service: InfraCatalogService): string {
    const target = service.target
    if (target.kind === 'view') {
      const view = views.value.find((v) => v.id === target.viewId)
      if (view) return t(view.label)
    }
    return t(service.label)
  }

  /** Mục này có phải view đang mở không (để tô đậm đúng một mục). */
  function entryActive(service: InfraCatalogService): boolean {
    const target = service.target
    return target.kind === 'view' && target.viewId === activeViewId.value
  }

  /** Mục chỉ có Console: cột trái vẽ dấu ↗ thay vì biểu tượng ghim. */
  function isConsoleEntry(service: InfraCatalogService): boolean {
    return service.target.kind === 'console'
  }

  /**
   * Bấm một mục ở cột trái. Mở ĐÚNG thứ mục đó trỏ tới — view thì mở trong app,
   * Console thì mở bằng trình duyệt. Đích `tab` (Logs/Tổng quan/Kubernetes) không
   * xử lý ở đây: composable không phát được `emit` của trang, nên SFC bắt nhánh đó
   * trước khi gọi hàm này.
   */
  async function openServiceEntry(service: InfraCatalogService): Promise<void> {
    const target = service.target
    if (target.kind === 'view') {
      openView(target.viewId)
      return
    }
    if (target.kind !== 'console') return
    // Deep link nằm ở `consoleUrl` chứ KHÔNG phải `target.url`: `catalogFor()` dựng
    // URL theo region hiện hành rồi gắn vào trường riêng, còn `target.url` của một
    // dịch vụ mức `console` là chuỗi rỗng trong `SERVICE_CATALOG`. Đọc nhầm trường
    // thì mọi mục "mở Console" đều báo "chưa có liên kết".
    if (!service.consoleUrl) {
      toast.add({ title: t('infra.explorer.toast.noConsole'), color: 'warning' })
      return
    }
    await openExternally(service.consoleUrl)
  }

  // ── Trang dữ liệu ─────────────────────────────────────────────────────────
  /**
   * Số hiệu ngữ cảnh (cùng khuôn `loadEpoch` của `useInfraKube`). Lời gọi nào cất
   * cánh ở ngữ cảnh cũ thì phản hồi của nó bị BỎ khi về tới nơi
   * (`gen !== loadEpoch`) — nếu không, một `list` đang bay lúc người dùng đổi tài
   * khoản sẽ đổ dòng của tài khoản CŨ vào bảng vừa được dọn, đúng cái sai mà khối
   * watch ở cuối file sinh ra để chặn.
   */
  let loadEpoch = 0
  const rows = ref<InfraResourceRow[]>([])
  const nextToken = ref<string | null>(null)
  const command = ref('')
  const loading = ref(false)
  const error = ref('')
  /** Giờ nạp trang hiện tại — "nạp lúc HH:MM" của spec (không ai được nhầm số cũ là live). */
  const loadedAt = ref<number | null>(null)
  const search = ref('')
  /** Giá trị form của view đang mở (vd `bucket` của `s3.objects`). */
  const viewValues = ref<Record<string, string>>({})

  const visibleRows = computed<InfraResourceRow[]>(() => {
    const q = search.value.trim().toLowerCase()
    if (!q) return rows.value
    return rows.value.filter((r) => Object.values(r).some((v) => v.toLowerCase().includes(q)))
  })

  /** Bảng ảo hoá chỉ khi thật sự cần (khuôn Git: >200 dòng). */
  const virtual = computed(() => visibleRows.value.length > VIRTUAL_THRESHOLD)

  const ctx = computed<InfraAwsContext>(() => {
    const e = infraContext.effective.value
    return {
      ...(e.profile ? { profile: e.profile } : {}),
      ...(e.region ? { region: e.region } : {}),
      ...(e.accountId ? { accountId: e.accountId } : {}),
    }
  })

  // ── Dò quyền (task 3.3) ───────────────────────────────────────────────────
  const probeByView = ref<Record<string, InfraProbeResult>>({})
  /** Cảnh báo dò quyền của view đang mở, để UI nói ĐÚNG vì sao nút vắng mặt. */
  const probeVerdict = computed<InfraProbeResult['verdict'] | null>(
    () => probeByView.value[activeViewId.value]?.verdict ?? null,
  )
  /**
   * Nút này có bị AWS từ chối không (task 3.3)?
   *
   * Ba luật, theo thứ tự:
   *   1. `unknown` (kể cả chưa dò) ⇒ KHÔNG ẩn. `iam:SimulatePrincipalPolicy` hiếm
   *      khi được cấp, nên `unknown` là kết cục thường gặp; giấu một nút người
   *      dùng thật sự có quyền là chặn việc của họ.
   *   2. Không khai `iam` ⇒ KHÔNG ẩn. Không có căn cứ thì không được đoán — đây
   *      là chỗ bản trước dùng `id.includes('terminate')` và đoán sai được.
   *   3. Chỉ ẩn khi action IAM của nút có mặt trong danh sách bị từ chối.
   */
  function actionDenied(actionId: string): boolean {
    const view = activeView.value
    if (!view) return false
    const probe = probeByView.value[activeViewId.value]
    if (!probe || probe.verdict !== 'denied') return false
    const decl =
      view.actions.find((a) => a.id === actionId) ?? view.forms.find((f) => f.id === actionId)
    if (!decl?.iam) return false
    return probe.deniedActions.includes(decl.iam)
  }

  // ── Nạp ───────────────────────────────────────────────────────────────────

  /** Nạp danh mục rồi chọn view đầu tiên nếu chưa chọn gì (nạp xong mới biết). */
  async function bootstrap(): Promise<void> {
    await ensureCatalog()
    if (activeViewId.value) return
    const first = sidebarViews.value[0] ?? views.value[0]
    if (first) activeViewId.value = first.id
  }

  /** Mở một view. `values` chỉ truyền khi view cần tham số (vd bucket). */
  function openView(viewId: string, values?: Record<string, string>): void {
    activeViewId.value = viewId
    viewValues.value = values ?? {}
    rows.value = []
    nextToken.value = null
    command.value = ''
    error.value = ''
    search.value = ''
    loadedAt.value = null
    selected.value = null
    detailJson.value = ''
    void probeView(viewId)
    // View cần tham số thì nạp SAU khi có tham số; view dùng được ngay thì nạp luôn.
    const view = views.value.find((v) => v.id === viewId)
    if (view && view.required.length === 0) void reload()
  }

  async function probeView(viewId: string): Promise<void> {
    if (!sidecar.available) return
    const view = views.value.find((v) => v.id === viewId)
    if (!view) return
    // View chỉ-đọc không có gì để dò ⇒ không tốn hai lời gọi STS/IAM vô ích.
    const hasWrite = view.actions.some((a) => a.confirm !== 'none') || view.forms.length > 0
    if (!hasWrite) {
      probeByView.value = {
        ...probeByView.value,
        [viewId]: { verdict: 'unknown', deniedActions: [] },
      }
      return
    }
    const gen = loadEpoch
    try {
      const result = await api.probe({ viewId, context: ctx.value })
      if (gen !== loadEpoch) return
      probeByView.value = { ...probeByView.value, [viewId]: result }
    } catch {
      if (gen !== loadEpoch) return
      probeByView.value = {
        ...probeByView.value,
        [viewId]: { verdict: 'unknown', deniedActions: [] },
      }
    }
  }

  async function reload(): Promise<void> {
    const view = activeView.value
    if (!view || !sidecar.available || loading.value) return
    loading.value = true
    error.value = ''
    const gen = loadEpoch
    try {
      const res = await api.list({
        viewId: view.id,
        values: viewValues.value,
        context: ctx.value,
      })
      if (gen !== loadEpoch) return
      if (res.ok) {
        rows.value = res.rows
        nextToken.value = res.nextToken
        command.value = res.command
        loadedAt.value = Date.now()
        return
      }
      if (res.blocked) {
        const ticket = await confirmBlocked(res, {
          action: t('infra.explorer.action.list'),
          target: view.label,
          consequence: t('infra.explorer.confirm.list'),
        })
        if (ticket) await reloadWith(ticket)
        return
      }
      error.value = res.error
    } catch (err) {
      if (gen !== loadEpoch) return
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function reloadWith(ticket: string): Promise<void> {
    const view = activeView.value
    if (!view) return
    loading.value = true
    const gen = loadEpoch
    try {
      const res = await api.list({
        viewId: view.id,
        values: viewValues.value,
        context: ctx.value,
        approvalTicket: ticket,
      })
      if (gen !== loadEpoch) return
      if (res.ok) {
        rows.value = res.rows
        nextToken.value = res.nextToken
        command.value = res.command
        loadedAt.value = Date.now()
      } else if (!res.blocked) {
        error.value = res.error
      }
    } finally {
      loading.value = false
    }
  }

  /** Nạp tiếp theo token của CLI — KHÔNG kéo hết rồi lọc ở client (spec). */
  async function loadMore(): Promise<void> {
    const view = activeView.value
    const token = nextToken.value
    if (!view || !token || loading.value || !sidecar.available) return
    loading.value = true
    const gen = loadEpoch
    try {
      const res = await api.list({
        viewId: view.id,
        values: viewValues.value,
        token,
        context: ctx.value,
      })
      if (gen !== loadEpoch) return
      if (res.ok) {
        rows.value = [...rows.value, ...res.rows]
        nextToken.value = res.nextToken
        loadedAt.value = Date.now()
      } else if (!res.blocked) {
        error.value = res.error
      }
    } finally {
      loading.value = false
    }
  }

  // ── Chi tiết ──────────────────────────────────────────────────────────────
  const selected = ref<InfraResourceRow | null>(null)
  const detailJson = ref('')
  const detailLoading = ref(false)
  const detailError = ref('')

  /**
   * Bấm một dòng: THƯ MỤC thì đi vào, còn lại thì mở chi tiết (task 3.6 "duyệt cây").
   *
   * S3 không có thư mục thật — một "thư mục" chỉ là một prefix chung. Nên đi vào
   * một thư mục nghĩa là nạp LẠI cùng view với `prefix` sâu hơn, chứ không phải
   * một màn mới. Luật này chỉ đúng cho view đã khai `prefix`, nên nó được kiểm
   * bằng chính tham số bắt buộc của view thay vì bằng tên view.
   */
  function enterRow(row: InfraResourceRow): void {
    const view = activeView.value
    if (!view) return
    const isFolder = row['kind'] === 'folder'
    if (isFolder && view.required.some((f) => f.key === 'prefix')) {
      openView(view.id, { ...viewValues.value, prefix: row['key'] ?? row['id'] ?? '' })
      return
    }
    void selectRow(row)
  }

  /** Lên một cấp trong cây prefix — vế còn lại của "duyệt cây". */
  function goUpPrefix(): void {
    const view = activeView.value
    if (!view || !view.required.some((f) => f.key === 'prefix')) return
    const cur = viewValues.value['prefix'] ?? ''
    if (cur === '') return
    const trimmed = cur.replace(/\/$/, '')
    const cut = trimmed.lastIndexOf('/')
    const next = cut < 0 ? '' : `${trimmed.slice(0, cut + 1)}`
    openView(view.id, { ...viewValues.value, prefix: next })
  }

  /** Có đang ở trong một cây prefix không (để hiện nút "lên một cấp"). */
  const inPrefixTree = computed(
    () =>
      activeView.value?.required.some((f) => f.key === 'prefix') === true &&
      (viewValues.value['prefix'] ?? '') !== '',
  )

  async function selectRow(row: InfraResourceRow): Promise<void> {
    selected.value = row
    detailJson.value = ''
    detailError.value = ''
    const view = activeView.value
    if (!view?.hasDetail || !sidecar.available) return
    detailLoading.value = true
    const gen = loadEpoch
    try {
      const res = await api.detail({ viewId: view.id, row, context: ctx.value })
      if (gen !== loadEpoch) return
      if (res.ok) {
        detailJson.value = res.json
      } else if (res.blocked) {
        const ticket = await confirmBlocked(res, {
          action: t('infra.explorer.action.detail'),
          target: row['name'] ?? row['id'] ?? '',
          consequence: t('infra.explorer.confirm.detail'),
        })
        if (ticket) {
          const again = await api.detail({
            viewId: view.id,
            row,
            context: ctx.value,
            approvalTicket: ticket,
          })
          if (gen !== loadEpoch) return
          if (again.ok) detailJson.value = again.json
          else if (!again.blocked) detailError.value = again.error
        }
      } else {
        detailError.value = res.error
      }
    } catch (err) {
      if (gen !== loadEpoch) return
      detailError.value = err instanceof Error ? err.message : String(err)
    } finally {
      detailLoading.value = false
    }
  }

  // ── Hành động ─────────────────────────────────────────────────────────────
  /** Form đang mở (task 3.6: tạo bucket/folder, upload, presign). */
  const openForm = ref<InfraFormDescriptor | null>(null)
  /**
   * Dòng mà form đang mở thuộc về (Mốc 4). Có mặt nghĩa là form này được mở từ
   * một HÀNH ĐỘNG TRÊN DÒNG (invalidation của CloudFront): payload phải là
   * `row:<id>` kèm dòng đó, không phải `form:<id>` của form cấp view — gửi sai
   * loại là sidecar trả "không có hành động này" sau khi người dùng đã điền xong.
   */
  const formRow = ref<InfraResourceRow | null>(null)
  const actionBusy = ref(false)
  /** Đích ghi của lần tải về gần nhất — dùng để mở xem trước. */
  const lastDownload = ref<string | null>(null)

  /**
   * Mở tệp vừa tải về bằng khung xem trước dùng chung (task 3.6).
   *
   * Tệp nằm trong cache của app (`~/.awog/infra-cache/...`), tức NGOÀI mọi
   * workspace — nên `workspaceRoot` phải là chính thư mục chứa nó, nếu không
   * `assertInsideWorkspace` từ chối đúng như thiết kế. Không có bản sao thứ hai
   * của trình xem: PDF/ảnh/văn bản đều rơi vào cùng khung của app.
   */
  function previewDownload(): void {
    const full = lastDownload.value
    if (!full) return
    const cut = full.lastIndexOf('/')
    const dir = cut > 0 ? full.slice(0, cut) : '/'
    const name = cut >= 0 ? full.slice(cut + 1) : full
    const kind = previewKindFromPath(name)
    usePreview().open({ name, kind, workspaceRoot: dir, path: name })
  }

  function startForm(form: InfraFormDescriptor, row: InfraResourceRow | null = null): void {
    openForm.value = form
    formRow.value = row
  }
  function closeForm(): void {
    openForm.value = null
    formRow.value = null
  }

  /**
   * Chạy một hành động đã khai trong spec. `actionId` là `row:<id>` hoặc `form:<id>`
   * — nó phải khớp một hành động CÓ THẬT ở sidecar, nên renderer không tự nghĩ ra
   * được một lệnh mới.
   */
  async function runAction(input: {
    actionId: string
    row?: InfraResourceRow
    values?: Record<string, string>
    /** Nhãn + hậu quả để hộp duyệt nói đúng việc đang làm. */
    label: string
    consequence: string
    danger: boolean
    confirm: 'none' | 'simple' | 'type-name'
    typeToConfirm?: string
    /** Gọi lại sau khi xong (vd nạp lại bảng). */
    after?: () => void
  }): Promise<boolean> {
    const view = activeView.value
    if (!view || !sidecar.available || actionBusy.value) return false
    actionBusy.value = true
    try {
      const res = await api.action({
        viewId: view.id,
        actionId: input.actionId,
        ...(input.row ? { row: input.row } : {}),
        ...(input.values ? { values: input.values } : {}),
        context: ctx.value,
      })
      if (res.ok) {
        if (res.filePath) lastDownload.value = res.filePath
        toast.add({
          title: t('infra.explorer.toast.done', { action: input.label }),
          color: 'success',
        })
        input.after?.()
        return true
      }
      if (res.blocked) {
        const ticket = await confirmBlocked(res, {
          action: input.label,
          target: input.row?.['name'] || input.row?.['id'] || '',
          consequence: input.consequence,
          ...(input.typeToConfirm !== undefined ? { typeToConfirm: input.typeToConfirm } : {}),
        })
        if (!ticket) return false
        // Gọi lại Y NGUYÊN payload + vé. Vé gắn vân tay của đúng lời gọi này và
        // chỉ dùng được một lần, nên đổi gì giữa hai lượt là vé vô hiệu.
        const again = await api.action({
          viewId: view.id,
          actionId: input.actionId,
          ...(input.row ? { row: input.row } : {}),
          ...(input.values ? { values: input.values } : {}),
          context: ctx.value,
          approvalTicket: ticket,
        })
        if (again.ok) {
          if (again.filePath) lastDownload.value = again.filePath
          toast.add({
            title: t('infra.explorer.toast.done', { action: input.label }),
            color: 'success',
          })
          input.after?.()
          return true
        }
        if (!again.blocked) toast.add({ title: again.error, color: 'error' })
        return false
      }
      // Lỗi cổng ở tầng sidecar (thiếu tham số / gõ tên sai) — nói thẳng.
      toast.add({ title: res.error, color: 'error' })
      return false
    } catch (err) {
      toast.add({
        title: err instanceof Error ? err.message : String(err),
        color: 'error',
      })
      return false
    } finally {
      actionBusy.value = false
    }
  }

  /**
   * Hộp duyệt hạ tầng dùng chung (ADR 0088 §5). Trả về VÉ khi người dùng đồng ý,
   * `null` khi họ từ chối — hoặc khi ma trận CHẶN hẳn (không có vé để xin, hộp
   * thoại chỉ còn nút chép lệnh).
   */
  async function confirmBlocked(
    res: InfraBlocked,
    ui: { action: string; target: string; consequence: string; typeToConfirm?: string },
  ): Promise<string | null> {
    const cls = (['read', 'write', 'destructive'] as const).find((c) => c === res.class) ?? 'write'
    if (!res.requiresApproval || !res.approvalTicket) {
      await confirm({
        kind: 'infra',
        action: ui.action,
        target: ui.target,
        consequence: res.reason || ui.consequence,
        command: res.command,
        context: { ...ctx.value },
        accountKind: res.accountKind === 'production' ? 'production' : 'normal',
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
      command: res.command,
      context: { ...ctx.value },
      accountKind: res.accountKind === 'production' ? 'production' : 'normal',
      class: cls as InfraActionClass,
      ...(ui.typeToConfirm !== undefined ? { typeToConfirm: ui.typeToConfirm } : {}),
    })
    return ok ? res.approvalTicket : null
  }

  // ── Hỏi agent (task 3.4) ──────────────────────────────────────────────────
  /**
   * Đẩy ĐÚNG dòng đang chọn vào phiên, dạng JSON đã rút gọn. Không có đường nào
   * đẩy cả trang: một bảng 200 dòng là 200 dòng ngữ cảnh model không hỏi tới, và
   * người dùng mất chỗ trong cửa sổ context vì một cú bấm.
   */
  async function askAbout(row: InfraResourceRow | null): Promise<void> {
    const view = activeView.value
    const label = view ? t(view.label) : ''
    const payload = row ?? {}
    const text = [
      `[hạ tầng] ${label}${row ? ` — ${row['name'] || row['id'] || ''}` : ''}`,
      '```json',
      JSON.stringify(payload, null, 2),
      '```',
    ].join('\n')
    // Nhãn nguồn để hộp chọn nói rõ đang gửi gì ("EC2 Instances — web-1"), và để
    // người dùng không phải đoán giữa hai phiên.
    await ask.askAgent(text, `${label}${row ? ` — ${row['name'] || row['id'] || ''}` : ''}`)
  }

  async function copyCommand(): Promise<void> {
    if (!command.value) return
    const ok = await copyText(command.value)
    toast.add({
      title: ok ? t('infra.explorer.toast.copied') : t('infra.ask.copyFailed'),
      color: ok ? 'success' : 'error',
    })
  }

  /**
   * "Console ↗" (task 3.4). URL do SIDECAR dựng từ hàm deep link của spec — nơi
   * duy nhất biết đường dẫn tới đúng đối tượng, và biết dịch vụ toàn cầu không
   * được kèm region. Renderer chỉ mở cái nhận được.
   */
  async function openConsole(row: InfraResourceRow | null): Promise<void> {
    const view = activeView.value
    if (!view?.hasConsole || !sidecar.available) return
    try {
      const res = await api.consoleUrl({ viewId: view.id, row: row ?? {}, context: ctx.value })
      if (!res.ok) {
        toast.add({ title: t('infra.explorer.toast.noConsole'), color: 'warning' })
        return
      }
      await openExternally(res.url)
    } catch (err) {
      toast.add({ title: err instanceof Error ? err.message : String(err), color: 'error' })
    }
  }

  // ── Đổi ngữ cảnh ⇒ số liệu cũ KHÔNG được đứng lại (2026-09-14) ─────────────
  //
  // Yêu cầu: "các dịch vụ, service phải theo account đó". Bảng đã nạp thuộc về
  // một tài khoản; để nó nằm nguyên trên màn sau khi đổi profile là để người đọc
  // tin rằng `web-prod-1` của tài khoản cũ nằm trong tài khoản mới. Nên mọi thứ
  // suy ra từ ngữ cảnh bị dọn: dòng, trang kế, chi tiết, kết quả dò quyền.
  //
  // `list` chỉ chạy lại khi TRƯỚC ĐÓ đã có số liệu (`hadRows`). Nhịp hydrate của
  // `settings.infra` lúc mở app cũng đổi khoá ngữ cảnh, mà lúc đó chưa có gì để
  // vô hiệu — chạy `list` ở nhịp ấy sẽ phá luật 1 ("không tự chạy") đúng nghĩa.
  // View cần tham số (vd `s3.objects`) cũng không tự nạp lại: cùng cái tên bucket
  // ở tài khoản khác có thể không tồn tại, và bảng báo lỗi còn tệ hơn bảng trống
  // kèm nút Nạp — người dùng đọc được giá trị cũ vẫn còn trong ô nhập.
  const ctxKey = computed(() =>
    [ctx.value.profile ?? '', ctx.value.region ?? '', ctx.value.accountId ?? ''].join('\u0000'),
  )
  /**
   * Mọi ngữ cảnh suy ra từ đây bị vô hiệu — xem `loadEpoch` ở đầu khối "Trang dữ
   * liệu" và lý do của từng bước dọn bên dưới.
   */
  watch(ctxKey, () => {
    loadEpoch += 1
    const hadRows = rows.value.length > 0 || loadedAt.value !== null || selected.value !== null
    probeByView.value = {}
    rows.value = []
    nextToken.value = null
    command.value = ''
    error.value = ''
    loadedAt.value = null
    selected.value = null
    detailJson.value = ''
    detailError.value = ''
    openForm.value = null
    formRow.value = null
    const view = activeView.value
    if (view) void probeView(view.id)
    if (hadRows && view && view.required.length === 0) void reload()
  })

  // Deep link Console mang region trong URL (`console-url.ts`), nên danh mục phải
  // được dựng lại khi region đổi — nếu không, nút ↗ của mọi dịch vụ vẫn trỏ về
  // region cũ. Đọc lại danh mục chỉ là serialize hằng số ở sidecar, không chạm CLI.
  watch(
    () => ctx.value.region ?? '',
    () => void ensureCatalog(true),
  )

  return {
    // danh mục
    catalog,
    catalogLoading,
    ensureCatalog,
    bootstrap,
    views,
    services,
    groups,
    pinnedServices,
    togglePin,
    sidebarViews,
    // cột trái: danh mục đầy đủ theo nhóm (gập được) + nhóm ghim
    pinnedEntries,
    serviceGroups,
    entryLabel,
    entryActive,
    isConsoleEntry,
    openServiceEntry,
    toggleGroup,
    isFolded,
    activeViewId,
    activeView,
    openView,
    // cột
    columnMode,
    setColumnMode,
    columns,
    sidebarCollapsed,
    sidebarWidth,
    setSidebarCollapsed,
    setSidebarWidth,
    // dữ liệu
    rows,
    visibleRows,
    virtual,
    nextToken,
    command,
    loading,
    error,
    loadedAt,
    search,
    viewValues,
    reload,
    loadMore,
    // chi tiết
    selected,
    detailJson,
    detailLoading,
    detailError,
    selectRow,
    enterRow,
    goUpPrefix,
    inPrefixTree,
    // hành động
    openForm,
    formRow,
    startForm,
    closeForm,
    runAction,
    actionBusy,
    lastDownload,
    previewDownload,
    actionDenied,
    probeVerdict,
    // tiện ích
    askAbout,
    copyCommand,
    openConsole,
    ctx,
  }
}
