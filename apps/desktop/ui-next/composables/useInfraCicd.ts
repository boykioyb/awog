// Page-controller của tab `/infra → Triển khai` (Mốc 4, task 4.2–4.6).
//
// Toàn bộ state + lời gọi RPC nằm ở đây, SFC chỉ bind — khuôn `useXxxManager()` của
// .claude/rules/nuxt-vue.md §Composable.
//
// NĂM LUẬT CỦA FILE NÀY:
//   1. KHÔNG tự chạy. Không `watch`, không `onMounted` nào gọi CLI sau lưng người
//      dùng. Bảng chỉ nạp khi mở tab hoặc khi bấm ↻ — vì một lượt nạp là nhiều
//      tiến trình `aws` cộng một `gh run list` cho MỖI dự án.
//   2. KHÔNG tự ghép argv. UI gửi *con trỏ* (`ref` của dòng + `kind` của hành
//      động); sidecar tra ra ngữ cảnh thật rồi dựng lệnh. Một cái tên pipeline do
//      AWS bịa ra không bao giờ thành cờ của `aws`, và `cwd` của `gh` vẫn là
//      `project.path` đọc từ đĩa.
//   3. Cổng quyền không được nhại lại ở đây. `blocked` + vé ⇒ hộp duyệt hạ tầng
//      (useConfirm `kind: 'infra'`) rồi gọi lại kèm vé; `requiresApproval: false`
//      ⇒ hộp chỉ còn nút chép lệnh. Không có đường gửi "đã duyệt" tự khai.
//   4. Hỏng MỘT nguồn không được làm trắng bảng: `results` giữ nguyên hình dạng
//      theo từng nguồn và UI nói ra nguồn nào không đọc được.
//   5. Log build là dữ liệu L1 nhưng đã được redact + clamp ở sidecar; ở đây nó
//      chỉ được đẩy vào phiên qua nút "Hỏi agent" — không tự chảy vào đâu.
import { computed, ref } from 'vue'
import { githubSlugFromRemote } from '~/components/project/data'
import { useConfirm } from '~/composables/useConfirm'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import { useInfraContext } from '~/composables/useInfraContext'
import {
  useInfraCicdApi,
  type CicdBlocked,
  type CicdLogValue,
  type CicdProjectRef,
  type CicdRun,
  type CicdRunDetail,
  type CicdSource,
  type CicdSourceResult,
  type CicdStatus,
  type CicdWorkflow,
} from '~/composables/useInfraCicdApi'
import { useSidecar } from '~/composables/useSidecar'
import { useToast } from '~/composables/useToast'
import { useProjectsStore } from '~/stores/projects'
import { useSettingsStore } from '~/stores/settings'
import { copyText } from '~/utils/clipboard'
import type { InfraActionClass } from '~/composables/useConfirm'

/** Trần dòng mỗi nguồn xin từ sidecar. Đủ để nhìn, không đủ để nghẽn. */
export const CICD_LIMIT = 15
/** Trần dự án GitHub quét — khớp `MAX_GH_PROJECTS` của sidecar. */
export const MAX_GH_PROJECTS = 12

export const CICD_SOURCES: readonly CicdSource[] = [
  'github',
  'codepipeline',
  'codebuild',
  'amplify',
]

/** Cửa sổ thời gian của bảng. `0` = tất cả. */
export const CICD_WINDOWS = [
  { value: '1', ms: 24 * 60 * 60 * 1000 },
  { value: '7', ms: 7 * 24 * 60 * 60 * 1000 },
  { value: '30', ms: 30 * 24 * 60 * 60 * 1000 },
  { value: 'all', ms: 0 },
] as const

export type CicdRow = CicdRun & { sourceNote: string | null }

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** `key|a|b` → `t(key, { p1: a, p2: b })`; dấu `|` chỉ là khuôn truyền tham số. */
export function noteParts(note: string): { key: string; params?: Record<string, string> } {
  const [key, ...rest] = note.split('|')
  if (rest.length === 0) return { key: key ?? '' }
  const params: Record<string, string> = {}
  rest.forEach((v, i) => (params[`p${i + 1}`] = v))
  return { key: key ?? '', params }
}

/**
 * Câu lỗi của sidecar có HAI loại, và chúng không được đối xử như nhau:
 *   · mã của AWOG (`cicd.badJson`) — khoá i18n, phải dịch;
 *   · câu của AWS/`gh` ("not authorized", "does not exist") — người dùng cần ĐỌC
 *     ĐÚNG câu đó để tra cứu, nên giữ nguyên văn.
 * Phân biệt bằng tiền tố chứ không bằng danh sách cứng: sidecar thêm mã mới thì
 * chỗ này không phải sửa. Khoá i18n nằm dưới `infra.cicd.*` (mã của sidecar bỏ
 * tiền tố `infra.` cho ngắn).
 */
export function cicdMessage(
  raw: string,
  t: (key: string, params?: Record<string, string>) => string,
  params?: Record<string, string>,
): string {
  if (raw.startsWith('cicd.')) return t(`infra.${raw}`, params)
  if (raw.startsWith('infra.')) return t(raw, params)
  return raw
}

/**
 * Dự án GitHub đưa vào bảng: chỉ dự án có remote GitHub (không remote thì `gh run
 * list` không có repo để hỏi). Tài khoản gh giải theo đúng luật của tab PR:
 * `project.githubAccount` → `settings.githubAccount` → tài khoản đang active.
 *
 * HÀM TRẦN, không phải computed: vòng poll thông báo (useCicdNotify) gọi nó từ
 * `setInterval`, ngoài mọi reactive effect — và cả hai chỗ phải nhìn thấy ĐÚNG
 * một danh sách, nếu không thì thông báo nói về pipeline mà bảng không có.
 */
export function githubProjectsFor(max = MAX_GH_PROJECTS): CicdProjectRef[] {
  const settings = useSettingsStore()
  const out: CicdProjectRef[] = []
  for (const p of useProjectsStore().projects) {
    if (!githubSlugFromRemote(p.gitRemote)) continue
    const account = (p.githubAccount || settings.githubAccount || '').trim()
    out.push({ projectId: p.id, ...(account ? { account } : {}) })
    if (out.length >= max) break
  }
  return out
}

export function useInfraCicd() {
  const sc = useSidecar()
  const api = useInfraCicdApi()
  const { t } = useI18n()
  const toast = useToast()
  const { confirm } = useConfirm()
  const ask = useInfraAskAgent()
  const infraContext = useInfraContext({ sessionId: null })

  // ── Bộ lọc ────────────────────────────────────────────────────────────────
  const sourceFilter = ref<CicdSource | 'all'>('all')
  const branchFilter = ref('')
  const windowKey = ref<string>('7')

  const loading = ref(false)
  const error = ref('')
  const results = ref<CicdSourceResult[]>([])
  const loadedAt = ref('')

  const detail = ref<CicdRunDetail | null>(null)
  const detailLoading = ref(false)
  const detailError = ref('')
  /** Id dòng đang mở chi tiết — nút sáng đúng dòng dù `ref` của bảng đã đổi. */
  const openId = ref('')

  const stepLog = ref<{ stepId: string; value: CicdLogValue } | null>(null)
  const logLoading = ref('')
  const logError = ref('')

  const busy = ref(false)

  /** Ngữ cảnh AWS dùng cho mọi lời gọi của tab — CÙNG ngữ cảnh với Explorer/Logs. */
  const ctx = computed(() => {
    const e = infraContext.effective.value
    return {
      ...(e.profile ? { profile: e.profile } : {}),
      ...(e.region ? { region: e.region } : {}),
      ...(e.accountId ? { accountId: e.accountId } : {}),
    }
  })

  /**
   * Dự án GitHub đưa vào bảng: chỉ dự án có remote GitHub (không remote thì
   * `gh run list` không có repo để hỏi). Tài khoản gh giải theo đúng luật của tab
   * PR: `project.githubAccount` → `settings.githubAccount` → tài khoản đang active.
   */
  const ghProjects = computed<CicdProjectRef[]>(() => githubProjectsFor())

  const activeSources = computed<CicdSource[]>(() =>
    sourceFilter.value === 'all' ? [...CICD_SOURCES] : [sourceFilter.value],
  )

  /** Dòng của bảng: gộp mọi nguồn, rồi lọc theo nhánh và cửa sổ thời gian. */
  const rows = computed<CicdRow[]>(() => {
    const cut = windowCut()
    const branch = branchFilter.value.trim().toLowerCase()
    const out: CicdRow[] = []
    for (const r of results.value) {
      for (const run of r.runs) {
        if (branch && !run.branch.toLowerCase().includes(branch)) continue
        // Dòng không có mốc thời gian KHÔNG bị coi là "ngoài cửa sổ": nguồn không
        // nói thì giấu nó đi là trả lời sai câu người dùng vừa hỏi.
        if (cut > 0 && run.startedAt) {
          const ts = Date.parse(run.startedAt)
          if (Number.isFinite(ts) && ts < cut) continue
        }
        out.push({ ...run, sourceNote: r.note })
      }
    }
    return out.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
  })

  function windowCut(): number {
    const w = CICD_WINDOWS.find((x) => x.value === windowKey.value)
    return w && w.ms > 0 ? Date.now() - w.ms : 0
  }

  /** Nguồn CÓ vấn đề (lỗi hoặc bị cổng chặn) — để UI nói ra thay vì im lặng. */
  const sourceIssues = computed(() =>
    results.value
      .filter((r) => r.error !== null || r.blocked !== null)
      .map((r) => ({ source: r.source, error: r.error, blocked: r.blocked })),
  )

  /** Nguồn bị CẮT BỚT (chỉ đọc N tài nguyên đầu) — cũng phải nói ra, không chỉ lỗi. */
  const sourceNotes = computed(() =>
    results.value
      .filter((r) => r.note !== null)
      .map((r) => ({ source: r.source, note: r.note as string })),
  )

  const counts = computed<Record<CicdStatus, number>>(() => {
    const out = {
      queued: 0,
      running: 0,
      waiting: 0,
      success: 0,
      failed: 0,
      cancelled: 0,
      skipped: 0,
      unknown: 0,
    } as Record<CicdStatus, number>
    for (const r of rows.value) out[r.status] += 1
    return out
  })

  // ── Nạp bảng ──────────────────────────────────────────────────────────────
  async function refresh(tickets?: Partial<Record<CicdSource, string>>): Promise<void> {
    if (!sc.available || loading.value) return
    loading.value = true
    error.value = ''
    try {
      const res = await api.list({
        sources: activeSources.value,
        projects: activeSources.value.includes('github') ? ghProjects.value : [],
        context: ctx.value,
        limit: CICD_LIMIT,
        ...(branchFilter.value.trim() ? { branch: branchFilter.value.trim() } : {}),
        ...(tickets ? { tickets } : {}),
      })
      results.value = res.results
      loadedAt.value = new Date().toISOString()
    } catch (err) {
      error.value = messageOf(err)
      results.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Người dùng bấm "Duyệt" cho một NGUỒN bị cổng chặn khi nạp bảng. Vé chỉ dùng
   * được một lần và gắn đúng lời gọi đã sinh ra nó, nên lượt nạp lại phải y hệt.
   */
  async function approveSource(source: CicdSource): Promise<void> {
    const issue = results.value.find((r) => r.source === source)?.blocked
    if (!issue) return
    const label = t(`infra.cicd.source.${source}`)
    const ticket = await confirmBlocked(
      issue,
      t('infra.cicd.confirm.readSource', { source: label }),
    )
    if (!ticket) return
    await refresh({ [source]: ticket })
  }

  // ── Chi tiết ──────────────────────────────────────────────────────────────
  async function openRun(run: CicdRun, ticket?: string): Promise<void> {
    if (!sc.available || detailLoading.value) return
    detailLoading.value = true
    detailError.value = ''
    openId.value = run.id
    stepLog.value = null
    try {
      const res = await api.detail({
        source: run.source,
        ref: run.ref,
        context: ctx.value,
        ...(ticket ? { approvalTicket: ticket } : {}),
      })
      if (res.ok) {
        detail.value = res.value
        return
      }
      if (res.blocked) {
        const t2 = await confirmBlocked(res, `${run.title} — ${run.commit || run.project}`)
        if (t2) {
          detailLoading.value = false
          await openRun(run, t2)
          return
        }
      } else {
        detailError.value = res.error
      }
      detail.value = null
    } catch (err) {
      detailError.value = messageOf(err)
      detail.value = null
    } finally {
      detailLoading.value = false
    }
  }

  function closeDetail(): void {
    detail.value = null
    detailError.value = ''
    stepLog.value = null
    openId.value = ''
  }

  // ── Log của MỘT bước ──────────────────────────────────────────────────────
  async function loadStepLog(stepId: string, ticket?: string): Promise<void> {
    const run = detail.value?.run
    if (!run || !sc.available) return
    // Bấm lại đúng bước đang mở = đóng log. Chỉ khi KHÔNG phải lượt gọi lại kèm
    // vé — lượt đó quay về đây qua chính hàm này và phải đọc, không phải đóng.
    if (!ticket && stepLog.value?.stepId === stepId) {
      stepLog.value = null
      logError.value = ''
      return
    }
    logLoading.value = stepId
    logError.value = ''
    try {
      const res = await api.log({
        source: run.source,
        ref: run.ref,
        stepId,
        context: ctx.value,
        ...(ticket ? { approvalTicket: ticket } : {}),
      })
      if (res.ok) {
        stepLog.value = { stepId, value: res.value }
        return
      }
      // Log build cũng là một lệnh ĐỌC qua cổng: trên tài khoản production nó có
      // thể bị siết nhịp. Không xin vé ở đây thì người dùng chỉ nhận được câu giải
      // thích và không có đường nào đi tiếp.
      if (res.blocked) {
        const next = await confirmBlocked(res, `${t('infra.cicd.stepLog')} — ${run.title}`)
        if (next) {
          logLoading.value = ''
          await loadStepLog(stepId, next)
          return
        }
      }
      logError.value = res.blocked ? res.reason : res.error
      toast.add({
        title: res.blocked ? res.reason : cicdMessage(res.error, t),
        color: 'error',
      })
    } catch (err) {
      logError.value = messageOf(err)
      toast.add({ title: logError.value, color: 'error' })
    } finally {
      logLoading.value = ''
    }
  }

  async function copyCommand(command: string): Promise<void> {
    const ok = await copyText(command)
    toast.add({
      title: ok ? t('infra.cicd.toast.copied') : t('infra.cicd.toast.copyFailed'),
      color: ok ? 'success' : 'error',
    })
  }

  // ── Hành động ─────────────────────────────────────────────────────────────
  /**
   * Chạy một hành động GHI trên một dòng (hoặc trên chi tiết đang mở). Bị chặn ⇒
   * hộp duyệt hạ tầng rồi gọi lại Y NGUYÊN payload kèm vé.
   */
  async function act(
    kind: 'rerun' | 'cancel' | 'dispatch' | 'approve',
    run: CicdRun,
    opts: {
      /** Nhãn người dùng đọc ("Chạy lại", "Huỷ"…). */
      label: string
      consequence: string
      /** Bước hỏng: chỉ chạy lại bước đó. */
      failedOnly?: boolean
      workflow?: string
      gitRef?: string
      inputs?: { key: string; value: string }[]
      /** Duyệt: id việc đang chờ + đồng ý/từ chối. */
      approvalId?: string
      approve?: boolean
      summary?: string
      after?: () => void
    },
  ): Promise<boolean> {
    if (!sc.available || busy.value) return false
    busy.value = true
    try {
      const payload = {
        source: run.source,
        kind,
        ref: opts.approvalId ? { ...run.ref, approvalId: opts.approvalId } : run.ref,
        context: ctx.value,
        ...(opts.failedOnly !== undefined ? { failedOnly: opts.failedOnly } : {}),
        ...(opts.workflow !== undefined ? { workflow: opts.workflow } : {}),
        ...(opts.gitRef !== undefined ? { gitRef: opts.gitRef } : {}),
        ...(opts.inputs !== undefined ? { inputs: opts.inputs } : {}),
        ...(opts.approve !== undefined ? { approve: opts.approve } : {}),
        ...(opts.summary !== undefined ? { summary: opts.summary } : {}),
      }
      const res = await api.action(payload)
      if (res.ok) {
        toast.add({ title: t('infra.cicd.toast.done', { action: opts.label }), color: 'success' })
        opts.after?.()
        return true
      }
      if (res.blocked) {
        const ticket = await confirmBlocked(res, `${opts.label} — ${run.title}`)
        if (!ticket) return false
        const again = await api.action({ ...payload, approvalTicket: ticket })
        if (again.ok) {
          toast.add({ title: t('infra.cicd.toast.done', { action: opts.label }), color: 'success' })
          opts.after?.()
          return true
        }
        if (!again.blocked) toast.add({ title: cicdMessage(again.error, t), color: 'error' })
        return false
      }
      toast.add({ title: cicdMessage(res.error, t), color: 'error' })
      return false
    } catch (err) {
      toast.add({ title: messageOf(err), color: 'error' })
      return false
    } finally {
      busy.value = false
    }
  }

  // ── Kích hoạt chạy mới ────────────────────────────────────────────────────
  const dispatchOpen = ref(false)
  const dispatchRun = ref<CicdRun | null>(null)
  const dispatchWorkflows = ref<CicdWorkflow[]>([])
  const dispatchWorkflow = ref('')
  const dispatchRefValue = ref('')
  const dispatchLoading = ref(false)

  async function openDispatch(run: CicdRun): Promise<void> {
    dispatchRun.value = run
    dispatchOpen.value = true
    dispatchWorkflow.value = ''
    dispatchRefValue.value = run.branch || 'main'
    dispatchWorkflows.value = []
    if (run.source !== 'github') return
    dispatchLoading.value = true
    try {
      const res = await api.workflows({
        projectId: run.ref['projectId'] ?? '',
        ...(run.ref['repoPath'] ? { repoPath: run.ref['repoPath'] } : {}),
        ...(run.ref['account'] ? { account: run.ref['account'] } : {}),
      })
      if (res.ok) dispatchWorkflows.value = res.value
      else if (!res.blocked) toast.add({ title: cicdMessage(res.error, t), color: 'error' })
    } catch (err) {
      toast.add({ title: messageOf(err), color: 'error' })
    } finally {
      dispatchLoading.value = false
    }
  }

  function closeDispatch(): void {
    dispatchOpen.value = false
    dispatchRun.value = null
  }

  async function submitDispatch(): Promise<void> {
    const run = dispatchRun.value
    if (!run) return
    const ok = await act('dispatch', run, {
      label: t('infra.cicd.action.dispatch'),
      consequence: t('infra.cicd.consequence.dispatch', { project: run.project }),
      ...(run.source === 'github'
        ? { workflow: dispatchWorkflow.value, gitRef: dispatchRefValue.value }
        : {}),
      after: closeDispatch,
    })
    if (!ok) return
  }

  // ── Hỏi agent về một lần chạy hỏng ────────────────────────────────────────
  /**
   * Đẩy ĐÚNG lần chạy đang mở vào phiên: log của bước hỏng (đã redact + clamp ở
   * sidecar) nếu lấy được, không thì bảng bước. Không đẩy cả trang — một bảng 15
   * dòng là ngữ cảnh model không hỏi tới.
   */
  async function askAbout(run: CicdRun): Promise<void> {
    const d = detail.value?.run.id === run.id ? detail.value : null
    const lines: string[] = [
      `[hạ tầng] ${run.project} · ${run.title} — ${run.status}${run.stepName ? ` ở bước "${run.stepName}"` : ''}`,
      `${t('infra.cicd.col.commit')}: ${run.commit || '—'} · ${t('infra.cicd.col.branch')}: ${run.branch || '—'}`,
    ]
    if (d && d.steps.length > 0) {
      lines.push(
        '',
        'Bước:',
        ...d.steps.map((s) => `- ${s.group ? `${s.group} / ` : ''}${s.name}: ${s.status}`),
      )
    }
    const failing = d?.steps.find((s) => s.status === 'failed')
    if (run.source === 'github' && failing) {
      try {
        const res = await api.log({
          source: run.source,
          ref: run.ref,
          stepId: failing.id,
          context: ctx.value,
        })
        if (res.ok) {
          lines.push(
            '',
            `Log bước "${failing.name}" (đã lọc bí mật):`,
            '```',
            ...res.value.lines,
            '```',
          )
        }
      } catch {
        // Không lấy được log thì vẫn gửi phần thông tin đã có — im lặng bỏ qua
        // cả nút là giấu đi việc nút không làm được gì.
      }
    }
    await ask.askAgent(lines.join('\n'), `${run.project} · ${run.title}`)
  }

  // ── Hộp duyệt hạ tầng dùng chung (ADR 0088 §5) ────────────────────────────
  async function confirmBlocked(
    res: CicdBlocked | (Omit<CicdBlocked, 'blocked'> & { requiresApproval: boolean }),
    target: string,
  ): Promise<string | null> {
    const cls = (['read', 'write', 'destructive'] as const).find((c) => c === res.class) ?? 'write'
    const base = {
      kind: 'infra' as const,
      action: t('infra.cicd.confirm.action'),
      target,
      command: res.command,
      context: { ...ctx.value },
      accountKind: res.accountKind === 'production' ? ('production' as const) : ('normal' as const),
      class: cls as InfraActionClass,
    }
    if (!res.requiresApproval || !res.approvalTicket) {
      await confirm({
        ...base,
        consequence: res.reason || t('infra.cicd.confirm.consequence'),
        blocked: true,
      })
      return null
    }
    const ok = await confirm({
      ...base,
      consequence: res.reason || t('infra.cicd.confirm.consequence'),
    })
    return ok ? res.approvalTicket : null
  }

  return {
    // bộ lọc + trạng thái
    sourceFilter,
    branchFilter,
    windowKey,
    loading,
    error,
    results,
    loadedAt,
    rows,
    counts,
    sourceIssues,
    sourceNotes,
    ghProjects,
    ctx,
    // chi tiết
    detail,
    detailLoading,
    detailError,
    openId,
    stepLog,
    logLoading,
    logError,
    // kích hoạt
    dispatchOpen,
    dispatchRun,
    dispatchWorkflows,
    dispatchWorkflow,
    dispatchRefValue,
    dispatchLoading,
    // hành động
    busy,
    refresh,
    approveSource,
    openRun,
    closeDetail,
    loadStepLog,
    act,
    openDispatch,
    closeDispatch,
    submitDispatch,
    askAbout,
    copyCommand,
  }
}
