import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'

// Kiểm định skill — state + IPC cho bảng "Kiểm tra" trong SkillDetail.
//
// Hai phần tách bạch, đúng như chi phí của chúng:
//   • doctor — chẩn đoán TĨNH, không gọi model. Chạy ngay khi mở bảng.
//   • eval   — hỏi model xem với danh mục skill hiện có nó có chọn skill này cho
//              từng prompt mẫu không. CHỈ chạy khi người dùng bấm, vì nó tốn tiền.
//
// State là per-instance (không module-level): bảng thuộc về đúng một skill đang
// mở, đóng lại là quên. Vấn đề doctor trả về ở dạng máy đọc được (`rule` +
// `params`) — câu chữ dựng ở component qua i18n.

export type SkillTierSource = 'global' | 'project'

export type SkillIssueSeverity = 'error' | 'warn' | 'info'

export type SkillIssue = {
  rule: string
  severity: SkillIssueSeverity
  params?: Record<string, string | number>
}

export type SkillDoctorStats = {
  fileBytes: number
  bodyChars: number
  descriptionChars: number
  assetFiles: number
}

export type SkillDoctorReport = {
  id: string
  source: SkillTierSource
  projectId?: string
  checkedAt: number
  issues: SkillIssue[]
  stats: SkillDoctorStats
}

export type SkillEvalExpectation = 'activate' | 'skip'

export type SkillEvalCase = {
  id: string
  prompt: string
  expect: SkillEvalExpectation
}

export type SkillEvalCaseResult = {
  caseId: string
  prompt: string
  expect: SkillEvalExpectation
  chosen: string | null
  pass: boolean
  reason: string
  status: 'scored' | 'skipped' | 'error'
  errorMessage?: string
}

export type SkillEvalBudget = {
  maxCalls: number
  maxCostUsd: number
  maxWallclockMs: number
}

export type SkillEvalRun = {
  runId: string
  startedAt: number
  finishedAt: number
  modelId: string
  results: SkillEvalCaseResult[]
  passed: number
  total: number
  estimatedCostUsd: number
  pricingKnown: boolean
  budget: SkillEvalBudget
  stoppedBy?: 'calls' | 'cost' | 'wallclock' | 'error'
}

export type SkillEvalRecord = {
  version: 1
  skillId: string
  source: SkillTierSource
  projectId?: string
  cases: SkillEvalCase[]
  runs: SkillEvalRun[]
}

export type SkillEvalTarget = {
  id: string
  source: SkillTierSource
  projectId?: string
  // Tier project cần quét để bắt trùng id/tên và dựng danh mục cho eval.
  projectIds: string[]
}

function newCaseId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// Bộ ca mồi khi skill chưa từng được kiểm: một ca "nên kích hoạt", một ca "không
// nên" — hình dạng tối thiểu để bài kiểm có nghĩa (chỉ có ca dương thì mọi skill
// đều đạt).
const seedCases = (): SkillEvalCase[] => [
  { id: newCaseId(), prompt: '', expect: 'activate' },
  { id: newCaseId(), prompt: '', expect: 'skip' },
]

export function useSkillEval(target: () => SkillEvalTarget) {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const doctorReport = ref<SkillDoctorReport | null>(null)
  const doctorBusy = ref(false)
  const evalBusy = ref(false)
  const cases = ref<SkillEvalCase[]>(seedCases())
  const runs = ref<SkillEvalRun[]>([])
  const budget = ref<SkillEvalBudget | null>(null)
  const lastError = ref('')

  // Định danh skill gửi kèm mọi RPC — (source, projectId, id) là một bộ ba.
  const skillRef = (): Record<string, unknown> => {
    const t = target()
    return {
      id: t.id,
      source: t.source,
      ...(t.projectId ? { projectId: t.projectId } : {}),
    }
  }

  // `skills.list` chỉ nhận tối đa 50 tier project; cắt ở đây để một workspace
  // nhiều project không làm cả lời gọi bị zod từ chối.
  const scanIds = (): string[] => target().projectIds.slice(0, 50)

  const issueCounts = computed(() => {
    const issues = doctorReport.value?.issues ?? []
    return {
      error: issues.filter((i) => i.severity === 'error').length,
      warn: issues.filter((i) => i.severity === 'warn').length,
      info: issues.filter((i) => i.severity === 'info').length,
    }
  })

  const latestRun = computed<SkillEvalRun | null>(() => runs.value[0] ?? null)

  // Ca trống không được gửi đi: nó tốn một lượt gọi model để hỏi một câu rỗng.
  const runnableCases = computed(() => cases.value.filter((c) => c.prompt.trim().length > 0))
  const canRunEval = computed(
    () => available.value && !evalBusy.value && runnableCases.value.length > 0,
  )

  async function runDoctor(): Promise<void> {
    if (!available.value) return
    doctorBusy.value = true
    try {
      const res = await sc.request<{ report: SkillDoctorReport }>('skills.doctor', {
        ...skillRef(),
        projectIds: scanIds(),
      })
      doctorReport.value = res.report
      lastError.value = ''
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    } finally {
      doctorBusy.value = false
    }
  }

  // Bộ ca + lịch sử đã lưu (nếu có). Không gọi model.
  async function loadReport(): Promise<void> {
    if (!available.value) return
    try {
      const res = await sc.request<{ record: SkillEvalRecord | null; budget: SkillEvalBudget }>(
        'skills.evalReport',
        skillRef(),
      )
      budget.value = res.budget
      if (res.record) {
        if (res.record.cases.length > 0) cases.value = res.record.cases.map((c) => ({ ...c }))
        runs.value = res.record.runs
      }
      lastError.value = ''
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    }
  }

  async function runEval(): Promise<void> {
    if (!canRunEval.value) return
    evalBusy.value = true
    try {
      const res = await sc.request<{ record: SkillEvalRecord; budget: SkillEvalBudget }>(
        'skills.eval',
        { ...skillRef(), projectIds: scanIds(), cases: runnableCases.value },
      )
      runs.value = res.record.runs
      budget.value = res.budget
      lastError.value = ''
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    } finally {
      evalBusy.value = false
    }
  }

  function addCase(expect: SkillEvalExpectation): void {
    cases.value = [...cases.value, { id: newCaseId(), prompt: '', expect }]
  }

  function removeCase(id: string): void {
    cases.value = cases.value.filter((c) => c.id !== id)
  }

  function toggleExpect(id: string): void {
    cases.value = cases.value.map((c) =>
      c.id === id ? { ...c, expect: c.expect === 'activate' ? 'skip' : 'activate' } : c,
    )
  }

  // Kết quả của một ca trong lần chạy gần nhất (khớp theo id ca).
  function resultFor(caseId: string): SkillEvalCaseResult | undefined {
    return latestRun.value?.results.find((r) => r.caseId === caseId)
  }

  return {
    available,
    doctorReport,
    doctorBusy,
    issueCounts,
    evalBusy,
    cases,
    runs,
    latestRun,
    budget,
    lastError,
    canRunEval,
    runDoctor,
    loadReport,
    runEval,
    addCase,
    removeCase,
    toggleExpect,
    resultFor,
  }
}
