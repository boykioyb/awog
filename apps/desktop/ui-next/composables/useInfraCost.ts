// Tab "Chi phí" của `/infra` (Mốc 7, việc 7.1 · 7.2 · 7.3) — page-controller.
//
// TRẠNG THÁI Ở MỨC MODULE, HÀM THÌ KHÔNG. Cùng lý do với `useInfraDashboards`: tab này
// nằm dưới `<NuxtPage keepalive />` và kết quả một lượt dò phải sống qua lần đổi tab —
// nạp lại là trả tiền lần nữa. `useSidecar()`/`useToast()`/`useI18n()` vẫn gọi TRONG
// thân hàm vì chúng cần app instance.
//
// KHÔNG TỰ CHẠY. Không `onMounted`, không `watch`, không hẹn giờ. Hai nút là hai đường
// vào duy nhất, và cả hai đều tốn tiền thật:
//   · "Nạp chi phí"  → 3 request `ce` × $0.01;
//   · "Dò lãng phí"  → nhiều `describe-*` (miễn phí) và, NẾU người dùng bật, thêm một lô
//     `get-metric-data` (tính theo metric × điểm).
// Vì vậy hai phép dò trả tiền mặc định TẮT và có nhãn nói rõ trước khi bấm.
import { computed, ref } from 'vue'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import { useInfraContext } from '~/composables/useInfraContext'
import { useSidecar } from '~/composables/useSidecar'
import { useToast } from '~/composables/useToast'

// ─── Hợp đồng dây (khớp `sidecar/methods/infra.cost.ts`) ────────────────────

export type CostService = {
  service: string
  amountUsd: number
  previousUsd: number
  deltaUsd: number
}

export type CostSummary = {
  periodStart: string
  periodEnd: string
  previousStart: string
  previousEnd: string
  totalUsd: number
  previousTotalUsd: number
  forecastUsd: number | null
  forecastError: string | null
  services: CostService[]
  topIncreases: CostService[]
  calls: number
  estimatedUsd: number
  asOf: string
}

export const WASTE_CHECKS = [
  'eip-idle',
  'ebs-unattached',
  'snapshot-stale',
  'logs-no-retention',
  'lb-no-targets',
  'ec2-idle',
  'nat-idle',
] as const
export type WasteCheck = (typeof WASTE_CHECKS)[number]

export type WasteFinding = {
  check: WasteCheck
  resourceId: string
  label: string
  region: string
  monthlyUsd: number | null
  overEstimate: boolean
  detail: Record<string, string>
}

export type WasteReport = {
  findings: WasteFinding[]
  ran: WasteCheck[]
  failed: { check: WasteCheck; error: string }[]
  totalMonthlyUsd: number
  unpricedCount: number
  region: string
}

/** Ngân sách (7.4) — khớp `sidecar/infra/cost/budgets.ts`. */
export type Budget = {
  name: string
  budgetType: string
  timeUnit: string
  limitUsd: number | null
  actualUsd: number | null
  forecastUsd: number | null
}

export type CleanupDraftWire = {
  name: string
  description: string
  kind: 'instruction'
  variables: never[]
  steps: { id: string; title: string; verb: string; tool: string; args: string[]; note: string }[]
}

type SummaryWire = { ok: true; summary: CostSummary } | { ok: false; error: string }
type WasteWire =
  | {
      ok: true
      report: WasteReport
      pricing: { asOf: string; region: string }
      paidChecks: WasteCheck[]
    }
  | { ok: false; error: string }
type DraftWire = { ok: true; draft: CleanupDraftWire }
type BudgetListWire = { ok: true; budgets: Budget[] } | { ok: false; error: string }
type BudgetSaveWire =
  | { ok: true; blocked: false; ranOk: boolean; error: string }
  | { ok: false; blocked: true; gate: { reason: string } }
  | { ok: false; blocked?: undefined; error: string }

// ─── Trạng thái mức module ──────────────────────────────────────────────────

const summary = ref<CostSummary | null>(null)
const summaryLoading = ref(false)
const summaryError = ref('')

const report = ref<WasteReport | null>(null)
const wasteLoading = ref(false)
const wasteError = ref('')
const pricing = ref<{ asOf: string; region: string } | null>(null)
const paidChecks = ref<WasteCheck[]>([])

/** Phép dò đang bật. Hai phép trả tiền mặc định TẮT — xem đầu file. */
const enabled = ref<Set<WasteCheck>>(
  new Set<WasteCheck>([
    'eip-idle',
    'ebs-unattached',
    'snapshot-stale',
    'logs-no-retention',
    'lb-no-targets',
  ]),
)

const budgets = ref<Budget[] | null>(null)
const budgetsLoading = ref(false)
const budgetsError = ref('')
const budgetSaving = ref(false)

/** Phát hiện người dùng tick để đưa vào playbook dọn dẹp. Khoá = `check + resourceId`. */
const picked = ref<Set<string>>(new Set())

export function findingKey(f: WasteFinding): string {
  return `${f.check}::${f.resourceId}`
}

export function useInfraCost() {
  const sc = useSidecar()
  const toast = useToast()
  const { t } = useI18n()
  const { askAgent } = useInfraAskAgent()
  const infraContext = useInfraContext({ sessionId: null })

  const context = computed(() => {
    const e = infraContext.effective.value
    return {
      ...(e.profile ? { profile: e.profile } : {}),
      ...(e.region ? { region: e.region } : {}),
      ...(e.accountId ? { accountId: e.accountId } : {}),
    }
  })
  const hasAccount = computed(() => Boolean(context.value.profile))
  const sidecarAvailable = computed(() => sc.available)
  const region = computed(() => infraContext.effective.value.region ?? '')

  // ── 7.1 — chi phí ─────────────────────────────────────────────────────────

  async function loadSummary(force = false): Promise<void> {
    if (summaryLoading.value) return
    summaryLoading.value = true
    summaryError.value = ''
    try {
      const res = await sc.request<SummaryWire>('infra.cost-summary', {
        // `region` CỐ Ý không gửi: Cost Explorer là dịch vụ toàn cục và sidecar ghim
        // `us-east-1`. Gửi vùng của người dùng là hứa một thứ lời gọi không làm.
        context: { ...(context.value.profile ? { profile: context.value.profile } : {}) },
        ...(force ? { force: true } : {}),
        surface: 'cost',
      })
      if (!res.ok) {
        summaryError.value = res.error
        return
      }
      summary.value = res.summary
    } catch (err) {
      summaryError.value = err instanceof Error ? err.message : String(err)
    } finally {
      summaryLoading.value = false
    }
  }

  /** Chênh lệch so với kỳ trước, tính trên phần ĐÃ phát sinh — không phải trên dự báo. */
  const deltaUsd = computed(() =>
    summary.value
      ? Math.round((summary.value.totalUsd - summary.value.previousTotalUsd) * 100) / 100
      : 0,
  )

  // ── 7.2 — dò lãng phí ─────────────────────────────────────────────────────

  function toggleCheck(check: WasteCheck): void {
    const next = new Set(enabled.value)
    if (next.has(check)) next.delete(check)
    else next.add(check)
    enabled.value = next
  }

  const paidEnabled = computed(
    () => [...enabled.value].filter((c) => paidChecks.value.includes(c)).length,
  )

  async function scanWaste(): Promise<void> {
    if (wasteLoading.value || enabled.value.size === 0) return
    wasteLoading.value = true
    wasteError.value = ''
    picked.value = new Set()
    try {
      const res = await sc.request<WasteWire>('infra.cost-waste', {
        context: context.value,
        checks: [...enabled.value],
        surface: 'cost',
      })
      if (!res.ok) {
        wasteError.value = res.error
        return
      }
      report.value = res.report
      pricing.value = res.pricing
      paidChecks.value = res.paidChecks
    } catch (err) {
      wasteError.value = err instanceof Error ? err.message : String(err)
    } finally {
      wasteLoading.value = false
    }
  }

  function togglePick(f: WasteFinding): void {
    const key = findingKey(f)
    const next = new Set(picked.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    picked.value = next
  }

  function pickAll(): void {
    const all = report.value?.findings ?? []
    picked.value =
      picked.value.size === all.length ? new Set() : new Set(all.map((f) => findingKey(f)))
  }

  const pickedFindings = computed(() =>
    (report.value?.findings ?? []).filter((f) => picked.value.has(findingKey(f))),
  )

  /** Tiền của những phát hiện ĐANG CHỌN có giá. Khoản `null` không được cộng là 0. */
  const pickedMonthlyUsd = computed(
    () => Math.round(pickedFindings.value.reduce((n, f) => n + (f.monthlyUsd ?? 0), 0) * 100) / 100,
  )

  // ── 7.4 — ngân sách ───────────────────────────────────────────────────────

  /** Budgets đòi `--account-id` tường minh; không đoán được từ profile. */
  const accountId = computed(() => infraContext.effective.value.accountId ?? '')

  async function loadBudgets(): Promise<void> {
    if (budgetsLoading.value) return
    if (!accountId.value) {
      budgetsError.value = t('infra.cost.budget.noAccountId')
      return
    }
    budgetsLoading.value = true
    budgetsError.value = ''
    try {
      const res = await sc.request<BudgetListWire>('infra.budget-list', {
        context: {
          ...(context.value.profile ? { profile: context.value.profile } : {}),
          accountId: accountId.value,
        },
        surface: 'cost',
      })
      if (!res.ok) {
        budgetsError.value = res.error
        return
      }
      budgets.value = res.budgets
    } catch (err) {
      budgetsError.value = err instanceof Error ? err.message : String(err)
    } finally {
      budgetsLoading.value = false
    }
  }

  /**
   * Tạo hoặc sửa một ngân sách. Đây là lượt GHI duy nhất của tab này, nên nó đi qua
   * `runGated` ở sidecar và có thể về với nhánh "bị chặn, cần duyệt" — surface phải nói
   * ra thay vì im lặng coi như hỏng.
   */
  async function saveBudget(input: {
    name: string
    limitUsd: number
    emails: string[]
    update: boolean
  }): Promise<boolean> {
    if (budgetSaving.value) return false
    if (!accountId.value) {
      toast.add({ title: t('infra.cost.budget.noAccountId'), color: 'error' })
      return false
    }
    budgetSaving.value = true
    try {
      const res = await sc.request<BudgetSaveWire>('infra.budget-save', {
        context: {
          ...(context.value.profile ? { profile: context.value.profile } : {}),
          accountId: accountId.value,
        },
        name: input.name,
        limitUsd: input.limitUsd,
        ...(input.emails.length ? { emails: input.emails } : {}),
        update: input.update,
        surface: 'cost',
      })
      if (!res.ok) {
        toast.add({
          title: res.blocked === true ? res.gate.reason : res.error,
          color: res.blocked === true ? 'warning' : 'error',
        })
        return false
      }
      if (!res.ranOk) {
        toast.add({ title: res.error, color: 'error' })
        return false
      }
      toast.add({ title: t('infra.cost.budget.saved', { name: input.name }), color: 'success' })
      await loadBudgets()
      return true
    } catch (err) {
      toast.add({ title: err instanceof Error ? err.message : String(err), color: 'error' })
      return false
    } finally {
      budgetSaving.value = false
    }
  }

  // ── 7.3 — sinh playbook dọn dẹp ───────────────────────────────────────────

  /**
   * Xin sidecar dựng bản nháp. KHÔNG ghi gì xuống đĩa ở lượt này — bản nháp đi thẳng vào
   * trình soạn playbook để người dùng xem trước khi Lưu. Hình dạng lệnh AWS do sidecar
   * dựng, không phải ở đây.
   */
  async function buildCleanupDraft(): Promise<CleanupDraftWire | null> {
    const findings = pickedFindings.value
    if (findings.length === 0) return null
    try {
      const res = await sc.request<DraftWire>('infra.cost-cleanup-draft', {
        findings,
        name: t('infra.cost.cleanup.planName', { region: region.value || '—' }),
        region: region.value,
      })
      return res.draft
    } catch (err) {
      toast.add({ title: err instanceof Error ? err.message : String(err), color: 'error' })
      return null
    }
  }

  // ── Luật 4 của infra-README: chip câu hỏi thay cho ô trống ────────────────
  //
  // Mọi màn hạ tầng khác đều có; hai màn của mốc 7 trước đây là ngoại lệ duy nhất.
  // README lấy đúng ví dụ "Tháng này tốn bao nhiêu?" cho màn này.
  //
  // GỬI KÈM ẢNH CHỤP SỐ LIỆU ĐANG XEM, không chỉ câu hỏi: agent trả lời được "vì sao
  // tăng" chỉ khi nó thấy con số. Ảnh chụp dựng từ state đã nạp — không gọi thêm lời
  // gọi tính tiền nào.

  const askSuggestions = computed(() => [
    { key: 'month', text: t('infra.cost.ask.month') },
    { key: 'forecast', text: t('infra.cost.ask.forecast') },
    { key: 'waste', text: t('infra.cost.ask.waste') },
  ])

  /** Có gì để kể chưa — chip tắt khi cả hai khối đều chưa nạp. */
  const hasSnapshot = computed(() => summary.value !== null || report.value !== null)

  function snapshotText(): string {
    const lines: string[] = []
    const sum = summary.value
    if (sum) {
      lines.push(`Kỳ ${sum.periodStart} → ${sum.periodEnd}`)
      lines.push(`Đã phát sinh: $${sum.totalUsd.toFixed(2)}`)
      lines.push(`Tháng trước: $${sum.previousTotalUsd.toFixed(2)}`)
      if (sum.forecastUsd !== null) lines.push(`Dự báo cuối tháng: $${sum.forecastUsd.toFixed(2)}`)
      if (sum.services.length) {
        lines.push('Dịch vụ tốn nhất:')
        for (const svc of sum.services) {
          lines.push(
            `  ${svc.service}: $${svc.amountUsd.toFixed(2)} (kỳ trước $${svc.previousUsd.toFixed(2)})`,
          )
        }
      }
    }
    const rep = report.value
    if (rep) {
      lines.push('')
      lines.push(
        `Lãng phí: ${String(rep.findings.length)} phát hiện, ~$${rep.totalMonthlyUsd.toFixed(2)}/tháng (ước lượng)`,
      )
      for (const f of rep.findings.slice(0, 20)) {
        const money = f.monthlyUsd === null ? 'chưa định giá' : `$${f.monthlyUsd.toFixed(2)}/tháng`
        lines.push(`  [${f.check}] ${f.label} — ${money}`)
      }
    }
    return lines.join('\n')
  }

  async function ask(text: string): Promise<void> {
    const snap = snapshotText()
    const label = t('infra.cost.title')
    if (!snap) {
      await askAgent(text, label)
      return
    }
    await askAgent(`${text}\n\n\`\`\`\n${snap}\n\`\`\``, label)
  }

  return {
    // ngữ cảnh
    context,
    hasAccount,
    sidecarAvailable,
    region,
    // chi phí
    summary,
    summaryLoading,
    summaryError,
    loadSummary,
    deltaUsd,
    // lãng phí
    report,
    wasteLoading,
    wasteError,
    pricing,
    paidChecks,
    enabled,
    toggleCheck,
    paidEnabled,
    scanWaste,
    checks: WASTE_CHECKS,
    // ngân sách
    accountId,
    budgets,
    budgetsLoading,
    budgetsError,
    budgetSaving,
    loadBudgets,
    saveBudget,
    // chọn + dọn dẹp
    picked,
    togglePick,
    pickAll,
    pickedFindings,
    pickedMonthlyUsd,
    buildCleanupDraft,
    // hỏi agent (luật 4)
    askSuggestions,
    hasSnapshot,
    ask,
  }
}
