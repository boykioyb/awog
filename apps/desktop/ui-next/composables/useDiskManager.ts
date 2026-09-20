// Điều khiển tab "Đĩa" của trang Giám sát: dung lượng ổ, danh mục rác, quét sâu,
// và chuyển mục đã chọn vào Thùng rác.
//
// ⚠ Đo dung lượng là việc CHẬM: `du -sk ~/Library/Caches` mất 19.5 giây trên máy
// thật. Vì thế danh sách hiện ra ngay (chỉ `stat`) rồi kích thước nhỏ giọt về
// theo từng mục, chạy tối đa `MEASURE_CONCURRENCY` mục một lúc. Gọi một RPC
// "quét hết rồi trả tổng" là cầm chắc một trang treo vài phút.
//
// SoC: không đụng fs — sidecar đọc, Electron main xoá. Đây chỉ là điều phối.
import { computed, onUnmounted, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { useConfirm } from '~/composables/useConfirm'
import { useToast } from '~/composables/useToast'
import { useI18n } from '~/composables/useI18n'
import { useProjectsStore } from '~/stores/projects'
import { formatMem } from '~/composables/useMonitorManager'
import { useFileContextMenu } from '~/composables/useFileContextMenu'
import { copyText } from '~/utils/clipboard'

/** Chạy song song vừa phải: `du` là I/O nặng, mở quá nhiều chỉ làm đĩa nghẽn. */
const MEASURE_CONCURRENCY = 3

export type DiskVolume = {
  mount: string
  filesystem: string
  totalKb: number
  usedKb: number
  freeKb: number
}

export type JunkKind = 'cache' | 'build' | 'store' | 'trash' | 'logs'
export type JunkSafety = 'safe' | 'review'

export type JunkTarget = {
  id: string
  label: string
  path: string
  kind: JunkKind
  safety: JunkSafety
  hint: string
}

export type TreeEntry = { path: string; name: string; sizeKb: number; isDir: boolean }

/** Một hành động dọn chuyên biệt (chạy công cụ của chính thứ đó). */
export type CleanupAction = {
  id: string
  label: string
  /** Lệnh nguyên văn — UI PHẢI hiện ra trước khi chạy. */
  command: string
  hint: string
  available: boolean
}

/** `undefined` = chưa đo · `null` = đo hỏng. */
export type SizeState = number | null | undefined

export function useDiskManager() {
  const sidecar = useSidecar()
  const { confirm } = useConfirm()
  const toast = useToast()
  const { t } = useI18n()
  const projects = useProjectsStore()

  const volumes = ref<DiskVolume[]>([])
  const targets = ref<JunkTarget[]>([])
  const sizes = ref<Record<string, SizeState>>({})
  const measuring = ref(0)
  /** Tiến độ của lượt đo hiện tại. `measureTotal = 0` ⇒ không có lượt nào đang chạy. */
  const measureDone = ref(0)
  const measureTotal = ref(0)
  const error = ref('')
  const loaded = ref(false)
  /** Thư mục nhà — ranh giới của phần XOÁ (đọc thì cả đĩa). */
  const home = ref('')
  const cleanupActions = ref<CleanupAction[]>([])
  /** Id đang chạy — lệnh dọn có thể mất hàng phút. */
  const cleanupRunning = ref('')

  // Quét sâu
  const treePath = ref('')
  const treeEntries = ref<TreeEntry[]>([])
  const treeLoading = ref(false)
  /** Mục vừa đo xong — để drawer nói "đang ở đâu" thay vì chỉ "đang quét". */
  const treeLastPath = ref('')
  /** Tổng số mục con, biết NGAY sau `readdir` — cho phép hiện "12/161". */
  const treeTotal = ref(0)
  const scanId = ref('')
  /**
   * Kết quả quét đã có, theo đường dẫn.
   *
   * Lần xuống rồi quay lại là chuyện xảy ra liên tục khi tìm chỗ chiếm dung
   * lượng, mà mỗi lần quét lại là một loạt tiến trình `du` cày đĩa (`~/Library/
   * Caches` mất ~12 giây). Giữ kết quả trong RAM cho tới khi người dùng chủ động
   * bấm quét lại, hoặc cho tới khi có thứ bị xoá.
   */
  const treeCache = new Map<string, { entries: TreeEntry[]; at: number }>()
  /** Mốc của kết quả đang hiện; 0 = vừa quét xong ngay bây giờ. */
  const treeCachedAt = ref(0)

  let unlisten: (() => void) | null = null
  onUnmounted(() => {
    unlisten?.()
    unlisten = null
    void stopScan()
  })

  const totalSafeKb = computed(() =>
    targets.value
      .filter((x) => x.safety === 'safe')
      .reduce((sum, x) => sum + (sizes.value[x.path] ?? 0), 0),
  )

  const measured = computed(
    () => targets.value.filter((x) => sizes.value[x.path] !== undefined).length,
  )

  /** Đã đo hết chưa — để nút đổi nhãn thành "Đo lại" thay vì "Đo dung lượng". */
  const allMeasured = computed(
    () => targets.value.length > 0 && measured.value === targets.value.length,
  )

  async function load(): Promise<void> {
    try {
      const [vol, tg] = await Promise.all([
        sidecar.request<{ volumes: DiskVolume[] }>('disk.volumes'),
        sidecar.request<{ targets: JunkTarget[]; home: string }>('disk.targets', {
          projectRoots: projects.projects.map((p) => p.path).filter(Boolean),
        }),
      ])
      volumes.value = vol.volumes
      targets.value = tg.targets
      home.value = tg.home
      // Dò công cụ là việc riêng: máy không có `docker` thì không được làm hỏng
      // cả lượt nạp ổ đĩa + danh mục rác.
      void sidecar
        .request<{ actions: CleanupAction[] }>('cleanup.actions')
        .then((r) => {
          cleanupActions.value = r.actions
        })
        .catch(() => {
          cleanupActions.value = []
        })
      error.value = ''
      loaded.value = true
      // Đo NGAY, không chờ bấm nút. Một danh sách tên là "gợi ý dọn" mà cột dung
      // lượng toàn "—" thì không gợi ý được gì: người dùng không có cách nào biết
      // mục nào đáng xoá. Đo chảy về từng mục một (concurrency 3) nên trang dùng
      // được ngay trong lúc còn đang đo, và chỉ chạy khi CHƯA có số nào — quay lại
      // tab không đo lại, nút "Đo lại" mới làm việc đó.
      if (measured.value === 0 && measuring.value === 0) void measureAll()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  /**
   * Đo lại kích thước TẤT CẢ các mục, tối đa N mục cùng lúc.
   *
   * ⚠ Bản đầu lọc `sizes[path] === undefined` nên chỉ đo những mục chưa biết —
   * tức bấm lần thứ hai KHÔNG LÀM GÌ CẢ, và con số đứng yên suốt phiên dù người
   * dùng vừa xoá thứ gì hoặc cache vừa phình ra. Một nút bấm vào không có phản
   * hồi thì người dùng chỉ kết luận là nó hỏng.
   *
   * Giá trị cũ được GIỮ trên màn hình trong lúc đo lại (thay vì xoá về "—"):
   * bảng không nhấp nháy trống, và một con số cũ vẫn hữu ích hơn khoảng trống.
   */
  async function measureAll(): Promise<void> {
    if (measuring.value > 0) return
    const queue = targets.value.map((x) => x.path)
    measureTotal.value = queue.length
    measureDone.value = 0

    const worker = async (): Promise<void> => {
      for (;;) {
        const path = queue.shift()
        if (path === undefined) return
        measuring.value += 1
        try {
          const res = await sidecar.request<{ sizeKb: number }>('disk.size', { path })
          sizes.value = { ...sizes.value, [path]: res.sizeKb }
        } catch {
          // Thư mục không đọc được là chuyện thường (quyền, file đang khoá) —
          // đánh dấu hỏng ở đúng dòng đó thay vì bỏ cả lượt quét.
          sizes.value = { ...sizes.value, [path]: null }
        } finally {
          measuring.value -= 1
          measureDone.value += 1
        }
      }
    }
    await Promise.all(Array.from({ length: MEASURE_CONCURRENCY }, worker))
    measureTotal.value = 0
  }

  /**
   * Mở một thư mục trong drawer quét sâu.
   *
   * Kết quả về theo LUỒNG: sidecar phát `disk.tree-entry` cho mỗi thư mục con
   * ngay khi `du` duyệt xong nó, rồi chốt bằng `disk.tree-done`. Người dùng thấy
   * danh sách dài dần và biết đang quét tới đâu, thay vì nhìn "Đang quét…" hai
   * mươi giây rồi mới có tất cả cùng lúc.
   */
  async function openTree(path: string, force = false): Promise<void> {
    // Lượt quét cũ phải chết trước: lần sang thư mục khác mà để `du` cũ chạy tiếp
    // thì vừa tốn đĩa vừa có nguy cơ mục của thư mục cũ rơi vào danh sách mới.
    await stopScan()

    const cached = force ? undefined : treeCache.get(path)
    if (cached) {
      treePath.value = path
      treeEntries.value = cached.entries
      treeCachedAt.value = cached.at
      treeLoading.value = false
      treeLastPath.value = ''
      treeTotal.value = 0
      return
    }

    treePath.value = path
    treeEntries.value = []
    treeLoading.value = true
    treeLastPath.value = ''
    treeTotal.value = 0
    treeCachedAt.value = 0
    try {
      await ensureScanListener()
      const res = await sidecar.request<{ scanId: string; path: string }>('disk.tree', { path })
      scanId.value = res.scanId
      // Dùng đường dẫn sidecar TRẢ VỀ, không phải cái vừa gửi: firmlink APFS làm
      // hai dạng cùng trỏ một thư mục, và entry luôn ở dạng chuẩn hoá — giữ dạng
      // thô thì breadcrumb và `canTrash` nói về một đường dẫn khác với danh sách.
      treePath.value = res.path
      error.value = ''
    } catch (err) {
      treeLoading.value = false
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  /** Huỷ lượt quét đang chạy (đóng drawer, đổi thư mục, rời trang). */
  async function stopScan(): Promise<void> {
    const id = scanId.value
    scanId.value = ''
    treeLoading.value = false
    if (!id) return
    try {
      await sidecar.request('disk.tree-cancel', { scanId: id })
    } catch {
      // Lượt quét đã tự kết thúc — không có gì để huỷ.
    }
  }

  // Một listener duy nhất cho cả vòng đời composable; mở thư mục khác chỉ đổi
  // `scanId` chứ không đăng ký thêm.
  async function ensureScanListener(): Promise<void> {
    if (unlisten !== null) return
    unlisten = await sidecar.onEvent((evt) => {
      const payload = evt.payload as { scanId?: string } | null
      // Lọc theo scanId: event của lượt quét CŨ (đã huỷ nhưng còn dòng trên
      // đường) không được lọt vào danh sách của thư mục đang mở.
      if (!payload || payload.scanId !== scanId.value) return
      if (evt.type === 'disk.tree-list') {
        treeTotal.value = (payload as { total: number }).total
        return
      }
      if (evt.type === 'disk.tree-entry') {
        const entry = (payload as { entry: TreeEntry }).entry
        treeLastPath.value = entry.name
        // Chèn giữ thứ tự giảm dần để danh sách không nhảy loạn mỗi lần có mục mới.
        const next = [...treeEntries.value, entry].sort((a, b) => b.sizeKb - a.sizeKb)
        treeEntries.value = next
        return
      }
      if (evt.type === 'disk.tree-done') {
        treeLoading.value = false
        scanId.value = ''
        treeLastPath.value = ''
        // Chỉ ghi đệm khi quét CHẠY HẾT: một lượt bị huỷ giữa chừng mà đem cache
        // thì lần sau mở lại sẽ thấy danh sách cụt và tưởng đó là toàn bộ.
        treeCache.set(treePath.value, { entries: treeEntries.value, at: Date.now() })
        const err = (payload as { error?: string }).error
        if (err) error.value = err
      }
    })
  }

  /**
   * Xoá được không.
   *
   * ⚠ Đọc và xoá có phạm vi KHÁC NHAU, cố ý: duyệt được cả đĩa (để trả lời "chỗ
   * trống đi đâu"), nhưng chuyển vào Thùng rác thì chỉ trong thư mục nhà và sâu
   * ≥ 2 cấp — Electron main cưỡng chế lại luật này. UI ẩn nút để khỏi mời bấm một
   * thứ chắc chắn bị từ chối.
   */
  function canTrash(path: string): boolean {
    const h = home.value
    if (!h || !path.startsWith(`${h}/`)) return false
    return (
      path
        .slice(h.length + 1)
        .split('/')
        .filter(Boolean).length >= 2
    )
  }

  /**
   * Còn đi lên được không.
   *
   * Chặn ở thư mục NHÀ: sidecar sẽ từ chối mọi đường dẫn ngoài đó, nên một nút
   * "lên một cấp" dẫn tới lỗi là nút nói dối — thà tắt nó đi.
   */
  // Đi lên tới tận `/` được, vì phần đọc nay phủ cả đĩa.
  const canGoUp = computed(() => treePath.value.split('/').filter(Boolean).length > 0)

  function treeUp(): void {
    if (!canGoUp.value) return
    const parent = treePath.value.split('/').slice(0, -1).join('/')
    void openTree(parent || '/')
  }

  /**
   * Bỏ đệm của một đường dẫn và mọi TỔ TIÊN của nó.
   *
   * Xoá một thứ làm đổi dung lượng của chính nó lẫn mọi cấp chứa nó, nên giữ lại
   * số cũ ở cấp trên là để bảng nói dối ngay sau thao tác của người dùng.
   */
  function invalidateTree(path: string): void {
    for (const key of [...treeCache.keys()]) {
      if (path === key || path.startsWith(`${key}/`) || key.startsWith(`${path}/`)) {
        treeCache.delete(key)
      }
    }
  }

  /**
   * Chuyển CHÍNH thư mục đang mở vào Thùng rác.
   *
   * Không có đường này thì muốn xoá thư mục vừa xem xong, người dùng phải lùi lên
   * cấp trên rồi dò lại nó trong danh sách cha — đúng lúc họ đã biết chắc nó là
   * thứ cần xoá. Xoá xong thì lùi lên cấp cha, vì chỗ đang đứng không còn nữa.
   */
  async function trashCurrent(): Promise<void> {
    const path = treePath.value
    if (!path || !canTrash(path)) return
    const name = path.split('/').filter(Boolean).pop() ?? path
    const parent = path.split('/').slice(0, -1).join('/') || '/'
    // Cố ý KHÔNG truyền dung lượng: con số duy nhất có trong tay là tổng của các
    // mục ĐANG LIỆT KÊ, mà danh sách bị cắt ở 400 mục — đưa một số thiếu vào hộp
    // xác nhận xoá là đưa bằng chứng sai cho một quyết định không hoàn tác dễ.
    if (await trash(path, name)) {
      invalidateTree(parent)
      await openTree(parent, true)
    }
  }

  /**
   * Chạy một hành động dọn.
   *
   * Hộp xác nhận hiện LỆNH NGUYÊN VĂN: đây là nhóm thao tác xoá dữ liệu không
   * hoàn tác được (khác Thùng rác), nên người dùng phải thấy chính xác cái gì
   * sắp chạy chứ không chỉ một cái nhãn.
   */
  async function runCleanup(action: CleanupAction): Promise<void> {
    if (cleanupRunning.value) return
    const ok = await confirm({
      title: t('disk.cleanup.confirmTitle', { label: action.label }),
      description: t('disk.cleanup.confirmDesc', { command: action.command, hint: action.hint }),
      confirmLabel: t('disk.cleanup.confirmRun'),
      kind: 'danger',
    })
    if (!ok) return
    cleanupRunning.value = action.id
    try {
      const res = await sidecar.request<{ ok: boolean; output: string }>('cleanup.run', {
        id: action.id,
      })
      toast.add({
        title: t(res.ok ? 'disk.cleanup.done' : 'disk.cleanup.failed', { label: action.label }),
        // Output của công cụ là thứ duy nhất nói "giải phóng được bao nhiêu",
        // nên đưa lên toast thay vì nuốt.
        description: res.output.split('\n').slice(-3).join(' · ').slice(0, 200),
        color: res.ok ? 'success' : 'warning',
      })
      await load()
    } catch (err) {
      toast.add({
        title: t('disk.cleanup.failed', { label: action.label }),
        description: err instanceof Error ? err.message : String(err),
        color: 'error',
      })
    } finally {
      cleanupRunning.value = ''
    }
  }

  /**
   * Menu chuột phải — DÙNG CHUNG với tab Files của Sessions (`useFileContextMenu`).
   *
   * Chế độ `absolute`: đường dẫn ở đây tuyệt đối và nằm ngoài mọi workspace, nên
   * menu tự bỏ những hàng cần root (VS Code, mở bằng app mặc định, copy đường dẫn
   * tương đối) và xoá đi qua `trash()` của chính composable này — Thùng rác,
   * hoàn tác được — chứ không phải `fs.deletePath`.
   */
  const fileMenu = useFileContextMenu({
    root: () => null,
    absolute: true,
    canTrash,
    onTrash: async (tgt) => {
      await trash(
        tgt.path,
        tgt.path.split('/').pop() ?? tgt.path,
        sizes.value[tgt.path] ?? undefined,
      )
    },
    notify: (text) => toast.add({ title: text, color: 'error' }),
  })

  /** Hiện một mục trong Finder. Electron main tự kiểm lại đường dẫn. */
  async function reveal(path: string): Promise<void> {
    try {
      await window.awog?.revealDiskPath(path)
    } catch (err) {
      toast.add({
        title: t('disk.reveal.failed'),
        description: err instanceof Error ? err.message : String(err),
        color: 'error',
      })
    }
  }

  /** Sao chép đường dẫn tuyệt đối — thứ người dùng dán thẳng vào terminal. */
  async function copyPath(path: string): Promise<void> {
    await copyText(path)
    toast.add({ title: t('disk.copyPath.done'), color: 'success' })
  }

  function closeTree(): void {
    void stopScan()
    treePath.value = ''
    treeEntries.value = []
    treeLastPath.value = ''
    treeTotal.value = 0
  }

  /**
   * Chuyển vào Thùng rác — KHÔNG xoá hẳn.
   *
   * Đây là lựa chọn có chủ ý: `shell.trashItem` hoàn tác được, `rm -rf` thì không,
   * và đường dẫn ở đây đi qua UI trước. Electron main kiểm lại đường dẫn lần nữa
   * (trong nhà, không phải chính thư mục nhà, sâu ≥ 2 cấp) — UI không phải lớp
   * bảo vệ, nó chỉ hỏi cho rõ.
   */
  async function trash(path: string, label: string, sizeKb?: number): Promise<boolean> {
    const size = sizeKb === undefined ? '' : ` (${formatMem(sizeKb)})`
    const ok = await confirm({
      title: t('disk.trash.title', { label }),
      description: t('disk.trash.desc', { path, size }),
      confirmLabel: t('disk.trash.confirm'),
      kind: 'danger',
    })
    if (!ok) return false
    try {
      await window.awog?.trashItem(path)
      toast.add({ title: t('disk.trash.done', { label }), color: 'success' })
      targets.value = targets.value.filter((x) => x.path !== path)
      treeEntries.value = treeEntries.value.filter((x) => x.path !== path)
      invalidateTree(path)
      // Quên số đo của mục vừa xoá: đường dẫn có thể được tạo lại ngay (cache là
      // thứ hay quay lại), và khi đó con số cũ sẽ là lời nói dối về dung lượng mới.
      if (sizes.value[path] !== undefined) {
        const next = { ...sizes.value }
        delete next[path]
        sizes.value = next
      }
      await load()
      return true
    } catch (err) {
      toast.add({
        title: t('disk.trash.failed', { error: err instanceof Error ? err.message : String(err) }),
        color: 'error',
      })
      return false
    }
  }

  return {
    volumes,
    targets,
    sizes,
    measuring,
    measured,
    measureDone,
    measureTotal,
    allMeasured,
    totalSafeKb,
    error,
    loaded,
    home,
    canTrash,
    cleanupActions,
    cleanupRunning,
    runCleanup,
    fileMenu,
    reveal,
    copyPath,
    treePath,
    treeEntries,
    treeLoading,
    treeLastPath,
    treeTotal,
    treeCachedAt,
    load,
    measureAll,
    openTree,
    rescanTree: () => openTree(treePath.value, true),
    trashCurrent,
    treeUp,
    closeTree,
    canGoUp,
    trash,
  }
}
