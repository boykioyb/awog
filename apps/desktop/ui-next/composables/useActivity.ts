// Activity page orchestrator — fetches the usage/cost summary from the sidecar
// (`activity.summary`) for a chosen time range + optional account filter, and
// derives the view the page binds to (summary cards, timeseries chart, by-model
// + by-account tables, missing-price flags). SoC: it only reaches the sidecar
// through useSidecar; no fs/SDK access. The page (pages/activity.vue) stays a
// thin template binding this composable's refs.
//
// Compile-time decoupled from the sidecar: when the Electron bridge is absent
// (browser-dev) or the `activity.summary` method is not yet implemented, it
// falls back to a deterministic mock so the page renders without breaking.
import { computed, ref, watch } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { useAccounts } from '~/composables/useAccounts'

// Time range selector value — mirrors the sidecar contract.
export type ActivityRange = '1d' | '7d' | '30d' | '90d' | 'all'

export const ACTIVITY_RANGES: readonly ActivityRange[] = ['1d', '7d', '30d', '90d', 'all'] as const

export type ActivityTotals = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  costUsd: number
  turns: number
}

export type ActivityByModel = {
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  costUsd: number
  turns: number
}

export type ActivityByAccount = {
  accountId: string
  label: string
  provider: string
  totalTokens: number
  costUsd: number
  turns: number
}

export type ActivityByDay = {
  date: string
  totalTokens: number
  costUsd: number
}

export type ActivitySummary = {
  range: ActivityRange
  from: string
  to: string
  totals: ActivityTotals
  byModel: ActivityByModel[]
  byAccount: ActivityByAccount[]
  byDay: ActivityByDay[]
  // Models referenced in the period that have no configured price → cost is
  // under-reported for them. The page flags these rows.
  missingPrices: string[]
}

// One chart column derived from byDay — height normalized 0..100 against the
// max-cost (or max-token) bucket, with the value/date kept for the tooltip.
export type ActivityChartBar = {
  date: string
  costUsd: number
  totalTokens: number
  height: number
  hi: boolean
}

const ACCOUNT_ALL = 'all' as const

// ── Compact + currency formatting (module-level pure helpers) ──

// Compact token formatting: 2_400_000 → "2.4M", 14_000 → "14k", 720 → "720".
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.round(n))
}

// USD cost: small amounts keep 4 decimals ($0.0021), larger keep 2 ($12.34).
export function formatCost(n: number): string {
  if (!Number.isFinite(n)) return '$0.00'
  const abs = Math.abs(n)
  if (abs > 0 && abs < 1) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

function emptySummary(range: ActivityRange): ActivitySummary {
  const now = new Date().toISOString()
  return {
    range,
    from: now,
    to: now,
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      turns: 0,
    },
    byModel: [],
    byAccount: [],
    byDay: [],
    missingPrices: [],
  }
}

// Deterministic browser-dev seed so the page renders fully off-shell. The day
// buckets follow a gentle wave; per-model/per-account splits are stable.
function mockSummary(range: ActivityRange): ActivitySummary {
  const dayCount = range === '1d' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 30
  const today = new Date()
  const byDay: ActivityByDay[] = []
  for (let i = dayCount - 1; i >= 0; i -= 1) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const wave = 0.55 + 0.45 * Math.sin((i / Math.max(dayCount, 1)) * Math.PI * 2)
    byDay.push({
      date: d.toISOString().slice(0, 10),
      totalTokens: Math.round(180_000 * wave),
      costUsd: Number((2.4 * wave).toFixed(4)),
    })
  }
  const totalTokens = byDay.reduce((s, d) => s + d.totalTokens, 0)
  const costUsd = Number(byDay.reduce((s, d) => s + d.costUsd, 0).toFixed(4))
  const turns = dayCount * 18
  return {
    range,
    from: byDay[0]?.date ?? today.toISOString(),
    to: byDay[byDay.length - 1]?.date ?? today.toISOString(),
    totals: {
      inputTokens: Math.round(totalTokens * 0.18),
      outputTokens: Math.round(totalTokens * 0.12),
      cacheReadTokens: Math.round(totalTokens * 0.62),
      cacheWriteTokens: Math.round(totalTokens * 0.08),
      totalTokens,
      costUsd,
      turns,
    },
    byModel: [
      {
        model: 'claude-opus-4-8',
        provider: 'Anthropic',
        inputTokens: Math.round(totalTokens * 0.1),
        outputTokens: Math.round(totalTokens * 0.08),
        cacheReadTokens: Math.round(totalTokens * 0.4),
        cacheWriteTokens: Math.round(totalTokens * 0.05),
        totalTokens: Math.round(totalTokens * 0.63),
        costUsd: Number((costUsd * 0.7).toFixed(4)),
        turns: Math.round(turns * 0.6),
      },
      {
        model: 'gpt-5-codex',
        provider: 'OpenAI',
        inputTokens: Math.round(totalTokens * 0.08),
        outputTokens: Math.round(totalTokens * 0.04),
        cacheReadTokens: Math.round(totalTokens * 0.22),
        cacheWriteTokens: Math.round(totalTokens * 0.03),
        totalTokens: Math.round(totalTokens * 0.37),
        costUsd: Number((costUsd * 0.3).toFixed(4)),
        turns: Math.round(turns * 0.4),
      },
    ],
    byAccount: [
      {
        accountId: 'mock-anthropic',
        label: 'Personal',
        provider: 'Anthropic',
        totalTokens: Math.round(totalTokens * 0.63),
        costUsd: Number((costUsd * 0.7).toFixed(4)),
        turns: Math.round(turns * 0.6),
      },
      {
        accountId: 'mock-openai',
        label: 'Codex',
        provider: 'OpenAI',
        totalTokens: Math.round(totalTokens * 0.37),
        costUsd: Number((costUsd * 0.3).toFixed(4)),
        turns: Math.round(turns * 0.4),
      },
    ],
    byDay,
    missingPrices: range === 'all' ? ['gpt-5-codex'] : [],
  }
}

// Defensive: the sidecar response is L1 (untrusted) — coerce numeric fields and
// arrays into the expected shape rather than trusting it blindly.
function normalize(raw: unknown, range: ActivityRange): ActivitySummary {
  const base = emptySummary(range)
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

  const totalsRaw = (r.totals ?? {}) as Record<string, unknown>
  const totals: ActivityTotals = {
    inputTokens: num(totalsRaw.inputTokens),
    outputTokens: num(totalsRaw.outputTokens),
    cacheReadTokens: num(totalsRaw.cacheReadTokens),
    cacheWriteTokens: num(totalsRaw.cacheWriteTokens),
    totalTokens: num(totalsRaw.totalTokens),
    costUsd: num(totalsRaw.costUsd),
    turns: num(totalsRaw.turns),
  }

  const byModel: ActivityByModel[] = Array.isArray(r.byModel)
    ? r.byModel.map((m) => {
        const x = (m ?? {}) as Record<string, unknown>
        return {
          model: str(x.model),
          provider: str(x.provider),
          inputTokens: num(x.inputTokens),
          outputTokens: num(x.outputTokens),
          cacheReadTokens: num(x.cacheReadTokens),
          cacheWriteTokens: num(x.cacheWriteTokens),
          totalTokens: num(x.totalTokens),
          costUsd: num(x.costUsd),
          turns: num(x.turns),
        }
      })
    : []

  const byAccount: ActivityByAccount[] = Array.isArray(r.byAccount)
    ? r.byAccount.map((a) => {
        const x = (a ?? {}) as Record<string, unknown>
        return {
          accountId: str(x.accountId),
          label: str(x.label),
          provider: str(x.provider),
          totalTokens: num(x.totalTokens),
          costUsd: num(x.costUsd),
          turns: num(x.turns),
        }
      })
    : []

  const byDay: ActivityByDay[] = Array.isArray(r.byDay)
    ? r.byDay.map((d) => {
        const x = (d ?? {}) as Record<string, unknown>
        return { date: str(x.date), totalTokens: num(x.totalTokens), costUsd: num(x.costUsd) }
      })
    : []

  const missingPrices: string[] = Array.isArray(r.missingPrices)
    ? r.missingPrices.filter((m): m is string => typeof m === 'string')
    : []

  return {
    range: (str(r.range, range) as ActivityRange) || range,
    from: str(r.from, base.from),
    to: str(r.to, base.to),
    totals,
    byModel,
    byAccount,
    byDay,
    missingPrices,
  }
}

export function useActivity() {
  const sc = useSidecar()
  const { accounts } = useAccounts()

  const range = ref<ActivityRange>('7d')
  // 'all' = no account filter; otherwise a real account id from useAccounts.
  const accountId = ref<string>(ACCOUNT_ALL)
  const summary = ref<ActivitySummary>(sc.available ? emptySummary(range.value) : mockSummary('7d'))
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Account filter options for the AppSelect (All + each real account).
  const accountOptions = computed(() => [
    { id: ACCOUNT_ALL, label: '' as string, display: '' as string },
    ...accounts.value.map((a) => ({ id: a.id, label: a.label, display: a.display })),
  ])

  async function fetchSummary(): Promise<void> {
    if (!sc.available) {
      summary.value = mockSummary(range.value)
      return
    }
    loading.value = true
    error.value = null
    try {
      const res = await sc.request<unknown>('activity.summary', {
        range: range.value,
        ...(accountId.value !== ACCOUNT_ALL ? { accountId: accountId.value } : {}),
      })
      summary.value = normalize(res, range.value)
    } catch (err) {
      // Method not yet implemented (parallel work) or a transient failure: keep
      // the page usable with the mock seed rather than an empty/broken screen.
      console.warn('[activity] activity.summary failed', err)
      summary.value = mockSummary(range.value)
      error.value = err instanceof Error ? err.message : 'Failed to load activity'
    } finally {
      loading.value = false
    }
  }

  // Re-fetch when the range or account filter changes (immediate first load).
  watch([range, accountId], () => void fetchSummary(), { immediate: true })

  // ── Derived view ──

  const totals = computed(() => summary.value.totals)

  // Set of models with no configured price — fast lookup for the by-model table.
  const missingPriceSet = computed(() => new Set(summary.value.missingPrices))
  const hasMissingPrices = computed(() => summary.value.missingPrices.length > 0)

  // Chart bars from byDay — normalized against the max-cost bucket so the chart
  // reads as a cost timeseries (falls back to token max when all costs are 0).
  const chartBars = computed<ActivityChartBar[]>(() => {
    const days = summary.value.byDay
    if (!days.length) return []
    const maxCost = Math.max(...days.map((d) => d.costUsd), 0)
    const useCost = maxCost > 0
    const maxToken = Math.max(...days.map((d) => d.totalTokens), 1)
    const peakVal = useCost ? maxCost : maxToken
    const peakIdx = days.findIndex((d) => (useCost ? d.costUsd : d.totalTokens) === peakVal)
    return days.map((d, i) => {
      const v = useCost ? d.costUsd : d.totalTokens
      const ref = useCost ? maxCost : maxToken
      return {
        date: d.date,
        costUsd: d.costUsd,
        totalTokens: d.totalTokens,
        height: Math.max(3, Math.round((v / (ref || 1)) * 100)),
        hi: i === peakIdx,
      }
    })
  })

  // by-model rows sorted by cost desc (highest spend first).
  const byModel = computed(() =>
    [...summary.value.byModel].sort(
      (a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens,
    ),
  )
  // by-account rows sorted by cost desc.
  const byAccount = computed(() =>
    [...summary.value.byAccount].sort(
      (a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens,
    ),
  )

  const isEmpty = computed(
    () => !loading.value && totals.value.totalTokens === 0 && summary.value.byDay.length === 0,
  )

  return {
    // state
    range,
    accountId,
    accountOptions,
    accounts,
    loading,
    error,
    available: sc.available,
    // derived
    summary,
    totals,
    chartBars,
    byModel,
    byAccount,
    missingPriceSet,
    hasMissingPrices,
    isEmpty,
    // actions
    fetchSummary,
    // formatters (re-exported for the template)
    formatTokens,
    formatCost,
  }
}
