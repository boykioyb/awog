// Bộ xuất · chia sẻ · báo cáo (mốc 6.5–6.7) — tầng điều phối DUY NHẤT cho UI.
//
// SIDECAR DỰNG CHUỖI, UI GHI FILE. `infra.share-export` trả về `filename` + `text`
// và CỐ Ý không tự ghi: mọi đường ghi trong app phải đi qua `fs.writeFile`
// (`assertInsideWorkspace` + ghi nguyên tử), còn đường ra ngoài thư mục làm việc đi
// qua hộp thoại lưu của hệ điều hành. Cùng khuôn `useInfraAuditLog.exportAs`.
//
// XEM TRƯỚC LUÔN LÀ BẢN ĐÃ CHE — VÀ LÀ CHÍNH BẢN SẼ GHI. Modal không tự che lấy:
// nó hiện đúng chuỗi sidecar trả về với hai công tắc đang bật. Một bản xem trước tự
// dựng lại ở client là bản thứ hai, và bản thứ hai thì sớm muộn sẽ lệch bản thứ nhất.
//
// MỌI HÀNH ĐỘNG DỰNG LẠI TỪ RPC. `build()` chạy lại ngay trước mỗi hành động — một
// lượt đọc file cục bộ ở sidecar, không tốn lời gọi AWS nào — nên "thứ đang thấy" và
// "thứ đang ghi" không thể lệch nhau vì một lần đổi tuỳ chọn bị nuốt.
//
// TRẠNG THÁI Ở MỌC MODULE. `app.vue` bọc `<NuxtPage keepalive />` nên trang không
// remount khi quay lại; để state trong `ref` của composable là mất nó giữa hai lần
// ghé màn (khuôn `useInfraGraphOpen`, `useInfraAskAgent`).
import { computed, reactive, ref } from 'vue'
import { useFsApi } from '~/composables/useFsApi'
import { saveFilePath } from '~/composables/useFolderPicker'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import { usePreview } from '~/composables/usePreview'
import { useSidecar } from '~/composables/useSidecar'
import { useToast } from '~/composables/useToast'
import { useSchedulesStore } from '~/stores/schedules'
import { useSettingsStore } from '~/stores/settings'
import type { ScheduleTrigger } from '~/stores/schedules'
// `PlaybookSource` đã có ở `usePlaybooksApi` — import chứ không khai lại: Nuxt
// auto-import type từ `composables/`, hai bản cùng tên là một cảnh báo trùng
// import cho TOÀN app và bản nào thắng thì không ai đoán được.
import type { PlaybookSource } from '~/composables/usePlaybooksApi'

export const SHARE_FORMATS = ['markdown', 'html'] as const
export type ShareFormat = (typeof SHARE_FORMATS)[number]

export const SHARE_LANGS = ['en', 'vi'] as const
export type ShareLang = (typeof SHARE_LANGS)[number]

/** Ba mẫu chia sẻ playbook — `approval` bị BUỘC che (xem `templates.ts`). */
export type ShareAudience = 'approval' | 'runbook'

// Chỉ khai KIỂU ở đây; danh sách thật lấy từ `infra.report-kinds` để UI không bao
// giờ tự bịa ra loại báo cáo thứ năm.
export type ReportKind = 'cost-monthly' | 'health-weekly' | 'activity' | 'incident'

export type ShareSubject =
  | {
      kind: 'playbook'
      id: string
      source: PlaybookSource
      projectId?: string
      audience: ShareAudience
    }
  | { kind: 'run'; id: string }
  | {
      kind: 'report'
      reportKind: ReportKind
      title: string
      body: string
      /** Có project ⇒ trang Wiki lưu ở tier project thay vì tier global. */
      projectId?: string
      scope?: string
      mermaid?: string
    }

export type ReportKindInfo = {
  kind: ReportKind
  labelKey: string
  aboutKey: string
  /** Câu lệnh ghim vào phiên khi chạy theo lịch. */
  prompt: string
  /** Nhịp chạy — `null` khi nhịp trong spec chưa biểu diễn được bằng trigger hiện có. */
  schedule: ScheduleTrigger | null
  /** Khoá i18n nói VÌ SAO chưa đặt được lịch (`null` = cố ý chạy tay). */
  scheduleGapKey: string | null
}

type ShareExportOk = {
  ok: true
  filename: string
  text: string
  format: ShareFormat
  bytes: number
  masked: boolean
  bucketsDomains: boolean
}

type ShareExportFail = {
  ok: false
  error: 'not-found' | 'invalid'
  issues?: { code: string; message: string }[]
}

type ShareExportResponse = ShareExportOk | ShareExportFail

/** Trang Wiki vừa ghi — chỉ hai trường composable này cần để nói lại với người dùng. */
type SavedWikiPage = { path: string; title: string }

type ShareState = {
  open: boolean
  subject: ShareSubject | null
  /** Nhãn người đọc được (tên playbook…) do bên gọi đưa vào; trống ⇒ dùng id. */
  label: string
  format: ShareFormat
  lang: ShareLang
  maskEnabled: boolean
  bucketsDomains: boolean
  busy: boolean
  error: string
  issues: string[]
  doc: ShareExportOk | null
}

const share = reactive<ShareState>({
  open: false,
  subject: null,
  label: '',
  format: 'markdown',
  lang: 'vi',
  maskEnabled: true,
  bucketsDomains: false,
  busy: false,
  error: '',
  issues: [],
  doc: null,
})

const kinds = ref<ReportKindInfo[]>([])

/**
 * Thư mục Wiki cho báo cáo — hằng ASCII, KHÔNG đi qua i18n: đây là đường dẫn trên
 * đĩa, dịch nó là biến một báo cáo thành hai thư mục khác nhau theo ngôn ngữ UI.
 */
const WIKI_SPACE = 'bao-cao'

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useShareExport() {
  const sc = useSidecar()
  const fs = useFsApi()
  const toast = useToast()
  const { t, locale } = useI18n()
  const { askAgent } = useInfraAskAgent()
  const preview = usePreview()
  const schedules = useSchedulesStore()
  const settings = useSettingsStore()

  /**
   * Mẫu "Kế hoạch để duyệt" BỊ BUỘC che — đó là định nghĩa của mẫu, không phải một
   * giá trị mặc định người dùng đổi được. Cùng luật ở sidecar (`audienceForcesMask`);
   * ở đây chỉ để công tắc hiện ra đúng trạng thái thay vì cho bấm rồi lặng lẽ bỏ qua.
   */
  const forcedMask = computed(
    () => share.subject?.kind === 'playbook' && share.subject.audience === 'approval',
  )

  const subjectTitle = computed(() => {
    const s = share.subject
    if (!s) return ''
    if (share.label) return share.label
    return s.kind === 'report' ? s.title : s.id
  })

  /** Nhãn nguồn cho hộp chọn "gửi vào phiên nào" — nói rõ đang gửi cái gì. */
  const chatSource = computed(() => {
    const s = share.subject
    if (!s) return ''
    if (s.kind === 'playbook') {
      return t('infra.share.chatSource', {
        kind: t(`infra.share.audience.${s.audience}`),
        name: subjectTitle.value,
      })
    }
    if (s.kind === 'report') {
      return t('infra.share.chatSource', {
        kind: t(reportInfo(s.reportKind)?.labelKey ?? 'infra.report.title'),
        name: subjectTitle.value,
      })
    }
    return t('infra.share.chatSource', {
      kind: t('infra.share.kind.run'),
      name: subjectTitle.value,
    })
  })

  function reportInfo(kind: ReportKind): ReportKindInfo | undefined {
    return kinds.value.find((k) => k.kind === kind)
  }

  // ── Payload ────────────────────────────────────────────────────────────────
  // Chọn trường TƯỜNG MINH, không spread subject: RPC nhận payload L1 và không được
  // nhận thêm thứ bên gọi tình cờ nhét vào object.
  function subjectPayload(s: ShareSubject): Record<string, unknown> {
    switch (s.kind) {
      case 'playbook':
        return {
          kind: 'playbook',
          id: s.id,
          source: s.source,
          audience: s.audience,
          ...(s.projectId !== undefined ? { projectId: s.projectId } : {}),
        }
      case 'run':
        return { kind: 'run', id: s.id }
      case 'report':
        return {
          kind: 'report',
          reportKind: s.reportKind,
          title: s.title,
          body: s.body,
          ...(s.scope !== undefined ? { scope: s.scope } : {}),
          ...(s.mermaid !== undefined ? { mermaid: s.mermaid } : {}),
        }
    }
  }

  /**
   * Dựng một bản xuất ở định dạng bất kỳ. Trả `null` khi không dựng được — lỗi đã
   * nằm ở `share.error`/`share.issues`/toast, bên gọi chỉ cần dừng lại.
   */
  async function build(format: ShareFormat): Promise<ShareExportOk | null> {
    const s = share.subject
    if (!s) return null
    share.busy = true
    share.error = ''
    share.issues = []
    try {
      const res = await sc.request<ShareExportResponse>('infra.share-export', {
        subject: subjectPayload(s),
        format,
        lang: share.lang,
        mask: { enabled: share.maskEnabled, bucketsDomains: share.bucketsDomains },
      })
      if (!res.ok) {
        // `not-found` là chuyện thường (playbook bị xoá ở cửa sổ khác): nói ra, đừng ném.
        share.error = t(
          res.error === 'not-found' ? 'infra.share.error.notFound' : 'infra.share.error.invalid',
        )
        share.issues = (res.issues ?? []).map((i) => i.message)
        share.doc = null
        return null
      }
      return res
    } catch (err) {
      share.error = errText(err)
      share.doc = null
      return null
    } finally {
      share.busy = false
    }
  }

  /** Dựng lại bản xem trước theo định dạng + công tắc đang chọn. */
  async function refresh(): Promise<void> {
    const res = await build(share.format)
    if (res) share.doc = res
  }

  // ── Mở / đóng ─────────────────────────────────────────────────────────────
  /**
   * Mở hộp xuất cho một đối tượng. Mọi công tắc về mặc định của spec: che BẬT,
   * bucket/domain TẮT (công tắc riêng), định dạng Markdown, ngôn ngữ theo UI.
   */
  async function openShare(
    subject: ShareSubject,
    opts: { label?: string; format?: ShareFormat } = {},
  ): Promise<void> {
    share.subject = subject
    share.label = opts.label ?? ''
    share.format = opts.format ?? 'markdown'
    share.lang = locale.value
    share.maskEnabled = true
    share.bucketsDomains = false
    share.error = ''
    share.issues = []
    share.doc = null
    share.open = true
    if (subject.kind === 'report') await loadReportKinds()
    await refresh()
  }

  function closeShare(): void {
    share.open = false
  }

  function setFormat(next: ShareFormat): void {
    if (share.format === next) return
    share.format = next
    void refresh()
  }

  function setLang(next: ShareLang): void {
    if (share.lang === next) return
    share.lang = next
    void refresh()
  }

  /** `enabled` không tắt được khi mẫu bị buộc che (xem `forcedMask`). */
  function setMask(enabled: boolean): void {
    const next = forcedMask.value ? true : enabled
    if (share.maskEnabled === next) return
    share.maskEnabled = next
    void refresh()
  }

  function setBucketsDomains(next: boolean): void {
    if (share.bucketsDomains === next) return
    share.bucketsDomains = next
    void refresh()
  }

  /** Đổi mẫu chia sẻ — chỉ có nghĩa với playbook (run/report có mẫu cố định). */
  function setAudience(audience: ShareAudience): void {
    const s = share.subject
    if (s?.kind !== 'playbook' || s.audience === audience) return
    s.audience = audience
    // Đổi sang mẫu bị buộc che thì công tắc phải theo, nếu không bản xem trước đang
    // nói "chưa che" trong khi bản ghi ra đã che (sidecar cưỡng chế).
    if (audience === 'approval') share.maskEnabled = true
    void refresh()
  }

  // ── Bốn đường ra của một bản xuất ─────────────────────────────────────────

  /** 1 · Ghi ra đĩa. Chọn chỗ bằng hộp thoại của hệ điều hành, ghi bằng `fs.writeFile`. */
  async function saveToFile(): Promise<void> {
    const res = await build(share.format)
    if (!res) return
    // Tên mặc định do sidecar đặt (tới GIÂY) ⇒ hai lần xuất trong cùng một phút vẫn
    // ra hai tệp khác tên. Xuất lại KHÔNG bao giờ ghi đè bản cũ.
    const picked = await saveFilePath({
      title: t('infra.share.saveTitle'),
      defaultPath: res.filename,
      filters:
        res.format === 'markdown'
          ? [{ name: 'Markdown', extensions: ['md'] }]
          : [{ name: 'HTML', extensions: ['html'] }],
    })
    if (!picked) return
    // `fs.writeFile` cần một gốc để kiểm (invariant #2). Gốc chính là thư mục người
    // dùng vừa chọn — không nới thêm quyền ghi nào khác.
    //
    // Cắt theo CẢ hai dấu phân cách: hộp thoại trên Windows trả `\`, và cắt bằng
    // `/` thì cả đường dẫn bị đọc thành một tên tệp — lượt ghi khi đó hỏng ở bước
    // kiểm đường dẫn, đúng lúc người dùng vừa chọn xong chỗ lưu.
    const cut = Math.max(picked.lastIndexOf('/'), picked.lastIndexOf('\\'))
    const dir = cut <= 0 ? picked.slice(0, 1) : picked.slice(0, cut)
    const name = picked.slice(cut + 1)
    try {
      await fs.writeFile(dir, name, res.text)
      toast.add({ title: t('infra.share.done.saved', { name }), color: 'success' })
    } catch (err) {
      toast.add({ title: t('infra.share.done.saveFailed', { msg: errText(err) }), color: 'error' })
    }
  }

  /** 2 · "Sao chép dạng Markdown" — LUÔN là markdown, kể cả khi đang chọn HTML. */
  async function copyMarkdown(): Promise<void> {
    const res = await build('markdown')
    if (!res) return
    try {
      await navigator.clipboard.writeText(res.text)
      toast.add({ title: t('infra.share.done.copied'), color: 'success' })
    } catch {
      toast.add({ title: t('infra.share.done.copyFailed'), color: 'error' })
    }
  }

  /** 3 · Gửi vào chat: dùng lại hộp chọn "phiên hiện tại hay phiên mới". */
  async function sendToChat(): Promise<void> {
    const res = await build('markdown')
    if (!res) return
    await askAgent(res.text, chatSource.value)
  }

  /** 4 · Xem toàn màn hình — PreviewModal render markdown (kèm Mermaid) hoặc HTML. */
  async function openFullPreview(): Promise<void> {
    const res = await build(share.format)
    if (!res) return
    preview.open({
      name: res.filename,
      kind: res.format === 'markdown' ? 'markdown' : 'html',
      text: res.text,
    })
  }

  // ── Báo cáo (6.6) ─────────────────────────────────────────────────────────

  /** Danh mục 4 loại báo cáo — nạp một lần, giữ ở module. */
  async function loadReportKinds(): Promise<void> {
    if (kinds.value.length || !sc.available) return
    try {
      const res = await sc.request<{ kinds: ReportKindInfo[] }>('infra.report-kinds', {})
      kinds.value = Array.isArray(res.kinds) ? res.kinds : []
    } catch (err) {
      toast.add({ title: t('infra.report.error.kinds', { msg: errText(err) }), color: 'error' })
    }
  }

  /**
   * Lưu báo cáo thành trang Wiki.
   *
   * GHI BẰNG `infra.report-save`, KHÔNG gọi thẳng `wiki.savePage`: trang Wiki được
   * nạp vào context của LLM ở các phiên sau, nên body phải qua `redact.ts` TRƯỚC khi
   * ghi — và chỗ cưỡng chế được điều đó là method riêng đứng trước `saveWikiPage`.
   *
   * Thân trang là ĐÚNG bản đang xem (đã che + đã khử), nên trang Wiki và tệp xuất là
   * cùng một bản chụp — không có bản thứ hai lệch nội dung.
   */
  async function saveReportToWiki(): Promise<void> {
    const s = share.subject
    if (s?.kind !== 'report') return
    const res = await build('markdown')
    if (!res) return
    const day = new Date().toISOString().slice(0, 10)
    // Thư mục + tag là DỮ LIỆU trên đĩa, không phải chữ hiển thị: đem chúng đi dịch
    // thì cùng một báo cáo rơi vào hai thư mục khác nhau tuỳ ngôn ngữ UI đang bật.
    const path = `${WIKI_SPACE}/${s.reportKind}-${day}.md`
    try {
      const saved = await sc.request<{ ok: true; page: SavedWikiPage }>('infra.report-save', {
        source: s.projectId ? 'project' : 'global',
        ...(s.projectId !== undefined ? { projectId: s.projectId } : {}),
        path,
        title: s.title,
        tags: [WIKI_SPACE, s.reportKind],
        body: res.text,
        reportKind: s.reportKind,
      })
      toast.add({
        title: t('infra.report.done.saved', { path: saved.page.path }),
        color: 'success',
      })
    } catch (err) {
      toast.add({ title: t('infra.report.done.saveFailed', { msg: errText(err) }), color: 'error' })
    }
  }

  /**
   * Đặt lịch chạy báo cáo — `schedules.upsert` với job `session-prompt` (job sẵn có).
   *
   * Nhịp KHÔNG được đoán ở client: nó đi kèm `infra.report-kinds` (cùng một nguồn với
   * câu lệnh), nên đổi nhịp trong spec là đổi ở sidecar, không phải săn trong UI.
   * `schedule === null` mà có `scheduleGapKey` nghĩa là nhịp trong spec CHƯA biểu diễn
   * được bằng trigger hiện có — nói thẳng ra thay vì lặng lẽ không làm gì.
   *
   * `id` cố định theo loại báo cáo: đặt lịch lần hai SỬA lịch cũ thay vì đẻ ra một
   * lịch trùng (hai lịch cùng loại = hai phiên trùng nhau mỗi tuần).
   */
  async function scheduleReport(kind?: ReportKind): Promise<void> {
    const s = share.subject
    // `kind` cho phép màn Báo cáo đặt lịch mà KHÔNG phải mở hộp xuất trước: ở
    // đó chưa có bản báo cáo nào để xuất (agent viết ra sau), nhưng nhịp chạy thì
    // đã biết. Vắng `kind` ⇒ lấy đối tượng đang mở trong hộp, như cũ.
    const reportKind = kind ?? (s?.kind === 'report' ? s.reportKind : null)
    if (!reportKind) return
    const info = reportInfo(reportKind)
    if (!info) return
    if (!info.schedule) {
      toast.add({
        title: t(info.scheduleGapKey ?? 'infra.report.gap.onDemand'),
        color: 'warning',
      })
      return
    }
    const acct = settings.resolveCreatorAccount()
    if (!acct.accountId) {
      // Lịch `session-prompt` không có tài khoản thì mọi lượt chạy sẽ đứng ở cổng
      // quyền lúc không có ai trực. Chặn ngay ở đây, đừng ghi một lịch chết.
      toast.add({ title: t('infra.report.error.noAccount'), color: 'warning' })
      return
    }
    const name = t(info.labelKey)
    try {
      await schedules.saveSchedule({
        // Tiền tố `awog-report-` để KHÔNG đụng id do người dùng đặt (id lịch là
        // slug của tên), mà vẫn idempotent: đặt lịch lần hai SỬA lịch cũ thay vì
        // đẻ ra lịch trùng — hai lịch cùng loại là hai phiên trùng nhau mỗi tuần.
        id: `awog-report-${reportKind}`,
        name,
        enabled: true,
        trigger: info.schedule,
        job: {
          kind: 'session-prompt',
          prompt: info.prompt,
          title: name,
          settings: {
            provider: settings.defaults.provider,
            modelId: settings.defaults.modelId,
            level: settings.defaults.thinkingLevel,
            // Lượt chạy theo lịch không có ai ngồi xem: 'ask' sẽ chặn ở tool ghi đầu
            // tiên rồi treo (ADR 0082). Báo cáo là việc đọc nên 'execute' an toàn.
            mode: 'execute',
            accountId: acct.accountId,
          },
        },
      })
      toast.add({ title: t('infra.report.done.scheduled', { name }), color: 'success' })
    } catch (err) {
      toast.add({
        title: t('infra.report.done.scheduleFailed', { msg: errText(err) }),
        color: 'error',
      })
    }
  }

  return {
    // state
    share,
    kinds,
    // getters
    forcedMask,
    subjectTitle,
    chatSource,
    reportInfo,
    // mở/đóng + tuỳ chọn
    openShare,
    closeShare,
    refresh,
    setFormat,
    setLang,
    setMask,
    setBucketsDomains,
    setAudience,
    // đường ra
    saveToFile,
    copyMarkdown,
    sendToChat,
    openFullPreview,
    // báo cáo
    loadReportKinds,
    saveReportToWiki,
    scheduleReport,
  }
}
