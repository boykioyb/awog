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

/** Phát hiện người dùng tick để đưa vào playbook dọn dẹp. Khoá = `check + resourceId`. */
const picked = ref<Set<string>>(new Set())

export function findingKey(f: WasteFinding): string {
  return `${f.check}::${f.resourceId}`
}

export function useInfraCost() {
  const sc = useSidecar()
  const toast = useToast()
  const { t } = useI18n()
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
    // chọn + dọn dẹp
    picked,
    togglePick,
    pickAll,
    pickedFindings,
    pickedMonthlyUsd,
    buildCleanupDraft,
  }
}
