// Page-controller của màn Nhật ký hoạt động (task 3.9).
//
// NHẬT KÝ LÀ BẰNG CHỨNG, KHÔNG PHẢI MỘT BẢNG ĐIỀU KHIỂN. Vì vậy ba luật:
//
//   1. DỌN PHẢI ĐẾM ĐƯỢC. `expectRemoved` là số dòng người dùng ĐÃ THẤY, gửi kèm
//      khi dọn: sidecar chỉ xoá khi số thật khớp. Nếu ai đó vừa ghi thêm một dòng,
//      lượt dọn hỏng và người dùng chạy lại — thay vì âm thầm xoá nhiều hơn thứ họ
//      đồng ý.
//
//   2. DỌN `all` PHẢI GÕ CHỮ. Xoá cả nhật ký là mất đường truy vết của mọi hành
//      động đã qua; nó là hành động phá huỷ nên có lớp gõ tay, cùng khuôn với
//      `terminate`.
//
//   3. XUẤT ĐI QUA `fs.writeFile`. Không có đường ghi riêng cho tính năng này —
//      nếu có, nó là đường ghi duy nhất trong app không đi qua
//      `assertInsideWorkspace`.
import { computed, ref } from 'vue'
import { useConfirm } from '~/composables/useConfirm'
import { useFsApi } from '~/composables/useFsApi'
import { useInfraResourcesApi } from '~/composables/useInfraResourcesApi'
import { useSessionsStore } from '~/stores/sessions'
import { useToast } from '~/composables/useToast'
import { saveFilePath } from '~/composables/useFolderPicker'
import { useTextPrompt } from '~/composables/useTextPrompt'
import type {
  InfraAuditEntry,
  InfraAuditFilter,
  InfraAuditSummary,
} from '~/composables/useInfraResourcesApi'

/** Số dòng mỗi lượt đọc — màn hình không cần hơn, và nhật ký có thể rất dài. */
const PAGE = 500

/**
 * Chữ phải gõ để xoá cả nhật ký. Hằng số ở ĐÂY nhưng luật ở SIDECAR
 * (`infra.audit-clean` so đúng chuỗi này) — đổi một bên mà quên bên kia thì lượt
 * dọn hỏng kèm câu "chưa gõ đúng", chứ không âm thầm xoá.
 */
const DELETE_ALL = 'DELETE ALL'

export function useInfraAuditLog() {
  const api = useInfraResourcesApi()
  const fs = useFsApi()
  const toast = useToast()
  const { confirm } = useConfirm()
  const sessions = useSessionsStore()
  const { t } = useI18n()

  const entries = ref<InfraAuditEntry[]>([])
  const summary = ref<InfraAuditSummary | null>(null)
  const loading = ref(false)
  const error = ref('')
  const loadedAt = ref<number | null>(null)
  const selected = ref<InfraAuditEntry | null>(null)

  // ── Bộ lọc ────────────────────────────────────────────────────────────────
  const range = ref<'24h' | '7d' | '30d' | 'all'>('7d')
  const actor = ref('')
  const klass = ref<'' | InfraAuditEntry['class']>('')
  const decision = ref<'' | InfraAuditEntry['decision']>('')
  const contains = ref('')

  /** `range` → mốc ISO. `all` KHÔNG gửi `since` (không có mốc nào để lọc). */
  function sinceIso(): string | undefined {
    const now = Date.now()
    const H = 3600_000
    if (range.value === '24h') return new Date(now - 24 * H).toISOString()
    if (range.value === '7d') return new Date(now - 7 * 24 * H).toISOString()
    if (range.value === '30d') return new Date(now - 30 * 24 * H).toISOString()
    return undefined
  }

  const filter = computed<InfraAuditFilter>(() => {
    const since = sinceIso()
    return {
      ...(since ? { since } : {}),
      ...(actor.value.trim() ? { actor: actor.value.trim() } : {}),
      ...(klass.value ? { class: klass.value } : {}),
      ...(decision.value ? { decision: decision.value } : {}),
      ...(contains.value.trim() ? { contains: contains.value.trim() } : {}),
    }
  })

  /**
   * Nạp nhật ký. Gọi khi ĐỔI BỘ LỌC hoặc bấm ↻ — đọc file cục bộ, không tốn lời
   * gọi AWS nào, nên đây là màn duy nhất của Explorer được phép nạp khi mở.
   */
  async function load(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const res = await api.auditQuery({ ...filter.value, limit: PAGE })
      entries.value = res.entries
      summary.value = res.summary
      loadedAt.value = Date.now()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  // ── Xuất ──────────────────────────────────────────────────────────────────
  async function exportAs(format: 'csv' | 'jsonl'): Promise<void> {
    try {
      const res = await api.auditExport({ ...filter.value, format })
      if (res.count === 0) {
        toast.add({ title: t('infra.audit.export.empty'), color: 'warning' })
        return
      }
      const picked = await saveFilePath({
        title: t('infra.audit.export.save'),
        defaultPath: res.filename,
      })
      if (!picked) return
      // `workspaceRoot` là thư mục chứa tệp đích: hộp thoại lưu của hệ điều hành
      // cho chọn bất kỳ đâu, còn `fs.writeFile` cần một gốc để kiểm. Gốc chính là
      // nơi người dùng vừa chọn — không nới thêm quyền đọc/ghi nào khác.
      const cut = picked.lastIndexOf('/')
      const dir = cut > 0 ? picked.slice(0, cut) : '/'
      const name = cut >= 0 ? picked.slice(cut + 1) : picked
      await fs.writeFile(dir, name, res.text)
      toast.add({ title: t('infra.audit.export.done', { n: res.count }), color: 'success' })
    } catch (err) {
      toast.add({ title: err instanceof Error ? err.message : String(err), color: 'error' })
    }
  }

  // ── Dọn ───────────────────────────────────────────────────────────────────
  const cleaning = ref(false)

  /**
   * Dọn nhật ký. `mode: 'filtered'` chỉ xoá những dòng ĐANG hiện; `mode: 'all'`
   * xoá cả file. Cả hai đều gửi `expectRemoved` để sidecar từ chối nếu số dòng
   * đã đổi từ lúc người dùng nhìn.
   */
  async function clean(mode: 'filtered' | 'all'): Promise<void> {
    if (cleaning.value) return
    const expected = mode === 'all' ? (summary.value?.total ?? 0) : entries.value.length
    const ok = await confirm({
      title: t(mode === 'all' ? 'infra.audit.clean.allTitle' : 'infra.audit.clean.title'),
      description: t(mode === 'all' ? 'infra.audit.clean.allAsk' : 'infra.audit.clean.ask', {
        n: expected,
      }),
      confirmLabel: t('infra.audit.clean.go'),
      kind: 'danger',
    })
    if (!ok) return
    // Xoá CẢ nhật ký là mất đường truy vết của mọi hành động đã qua — nó có lớp
    // GÕ TAY, cùng khuôn với `terminate`. Lớp này kiểm ở sidecar (so chuỗi), ở
    // đây chỉ là chỗ để người dùng bày tỏ ý định một cách có chủ ý.
    let typed: string | undefined
    if (mode === 'all') {
      const answer = await useTextPrompt().prompt({
        title: t('infra.audit.clean.typeAsk', { word: DELETE_ALL }),
        placeholder: DELETE_ALL,
        submitLabel: t('infra.audit.clean.go'),
      })
      if (answer === null) return
      typed = answer
    }
    cleaning.value = true
    try {
      const res = await api.auditClean({
        ...(mode === 'all' ? {} : filter.value),
        mode,
        expectRemoved: expected,
        ...(typed !== undefined ? { typed } : {}),
      })
      if (!res.ok) {
        // `changed` = nhật ký vừa có dòng mới ⇒ con số người dùng đồng ý đã cũ.
        toast.add({
          title: t(
            res.reason === 'changed' ? 'infra.audit.clean.changed' : 'infra.audit.clean.denied',
          ),
          color: 'warning',
        })
        await load()
        return
      }
      toast.add({ title: t('infra.audit.clean.done', { n: res.removed }), color: 'success' })
      await load()
    } catch (err) {
      toast.add({ title: err instanceof Error ? err.message : String(err), color: 'error' })
    } finally {
      cleaning.value = false
    }
  }

  // ── ↗ Nhảy về phiên ───────────────────────────────────────────────────────
  /** Có phiên + id tin để nhảy tới không (dòng cũ có thể thiếu một trong hai). */
  const canJump = computed(
    () => (e: InfraAuditEntry) => e.sessionId !== undefined && e.messageId !== undefined,
  )

  /**
   * Nhảy về ĐÚNG tin trong phiên đã chạy hành động đó. Dùng lại
   * `requestMessageJump` của store phiên — màn phiên đã biết cách cuộn tới một
   * `eid`; tự cuộn ở đây là bản sao thứ hai của việc đó.
   */
  async function jumpToSession(entry: InfraAuditEntry): Promise<void> {
    const raw = entry.sessionId ?? ''
    const eid = entry.messageId ?? ''
    if (raw === '' || eid === '') return
    // `sessionId` trong nhật ký là id PHIÊN CỦA ENGINE (chuỗi), còn store dùng
    // khoá số của client — phải tra qua `engineId` chứ không được ép kiểu.
    const session = sessions.sessions.find((s) => s.engineId === raw || String(s.id) === raw)
    if (!session) {
      toast.add({ title: t('infra.audit.jump.missing'), color: 'warning' })
      return
    }
    sessions.requestMessageJump(session.id, eid)
    sessions.setActive(session.id)
    await navigateTo('/sessions')
  }

  return {
    entries,
    summary,
    loading,
    error,
    loadedAt,
    selected,
    range,
    actor,
    klass,
    decision,
    contains,
    load,
    exportAs,
    clean,
    cleaning,
    canJump,
    jumpToSession,
  }
}
