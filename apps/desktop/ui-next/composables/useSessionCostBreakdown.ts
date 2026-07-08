import { computed, ref, watch } from 'vue'
import type { Session } from '~/composables/useSessionsData'
import { useSidecar } from '~/composables/useSidecar'

// Per-session cost timeline for the workspace Cost tab. A session may span many
// days, so the sidecar (`sessions.costBreakdown`) returns spend split by local day
// (summed from each turn's persisted `usage.costUsd` — single source of truth); this
// composable owns the IPC + rolls it into 1d/7d/30d/all/custom ranges client-side.
// SoC: no fs/SDK, all cost math already priced sidecar-side.

export type CostDay = { date: string; costUsd: number; totalTokens: number; turns: number }
export type CostBreakdown = {
  sessionId: string
  byDay: CostDay[]
  total: { costUsd: number; totalTokens: number; turns: number }
  firstAt?: string
  lastAt?: string
  hasUnpriced: boolean
}

export type CostRange = '1d' | '7d' | '30d' | 'all' | 'custom'

const EMPTY: CostBreakdown = {
  sessionId: '',
  byDay: [],
  total: { costUsd: 0, totalTokens: 0, turns: 0 },
  hasUnpriced: false,
}

// Local YYYY-MM-DD — matches the sidecar's day key (same machine timezone), so
// string comparison against `byDay[].date` is a valid range test.
function localDayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Start-of-today minus (days - 1) — `days` INCLUDES today, mirroring the Activity
// rollup's rangeToWindow so the two pages agree on what "7d" means.
function cutoffKey(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (days - 1))
  return localDayKey(d.getTime())
}

const RANGE_DAYS: Record<Exclude<CostRange, 'all' | 'custom'>, number> = {
  '1d': 1,
  '7d': 7,
  '30d': 30,
}

export function useSessionCostBreakdown(session: () => Session) {
  const sc = useSidecar()

  const data = ref<CostBreakdown>(EMPTY)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const range = ref<CostRange>('7d')
  // Custom-range bounds (inclusive YYYY-MM-DD); default to the session's span.
  const customFrom = ref('')
  const customTo = ref('')

  // Compact token formatter: 1.2k / 999.
  const kfmt = (n: number): string => (n > 999 ? `${(n / 1000).toFixed(1)}k` : String(n))
  // USD formatter — sub-cent turns shouldn't read $0.00 (mirrors useSessionCost).
  function fmtUsd(n: number | undefined): string {
    if (n == null) return '—'
    if (n === 0) return '$0'
    if (n < 0.01) return `$${n.toFixed(4)}`
    if (n < 1) return `$${n.toFixed(3)}`
    return `$${n.toFixed(2)}`
  }

  async function fetchBreakdown(): Promise<void> {
    const eid = session().engineId
    if (!sc.available || !eid) {
      data.value = EMPTY
      return
    }
    loading.value = true
    error.value = null
    try {
      data.value = await sc.request<CostBreakdown>('sessions.costBreakdown', { sessionId: eid })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load cost'
      data.value = EMPTY
    } finally {
      loading.value = false
    }
  }

  // Re-fetch on session switch and whenever the cumulative cost changes (a turn just
  // finished pricing) — cheap: one JSONL read for one session, sidecar-side.
  watch(
    () => [session().engineId, session().usage?.cost] as const,
    () => void fetchBreakdown(),
    { immediate: true },
  )

  // Seed the custom-range inputs from the session span once the data lands (and the
  // user hasn't already typed bounds).
  watch(
    () => [data.value.firstAt, data.value.lastAt] as const,
    ([first, last]) => {
      if (first && !customFrom.value) customFrom.value = localDayKey(Date.parse(first))
      if (last && !customTo.value) customTo.value = localDayKey(Date.parse(last))
    },
    { immediate: true },
  )

  // Days included in the selected range (oldest → newest) for the mini bar list.
  const rangeDays = computed<CostDay[]>(() => {
    const all = data.value.byDay
    if (range.value === 'all') return all
    if (range.value === 'custom') {
      const from = customFrom.value
      const to = customTo.value
      return all.filter((d) => (!from || d.date >= from) && (!to || d.date <= to))
    }
    const cut = cutoffKey(RANGE_DAYS[range.value])
    return all.filter((d) => d.date >= cut)
  })

  // Cost/tokens/turns summed over the selected range.
  const rangeTotal = computed(() =>
    rangeDays.value.reduce(
      (a, d) => ({
        costUsd: a.costUsd + d.costUsd,
        totalTokens: a.totalTokens + d.totalTokens,
        turns: a.turns + d.turns,
      }),
      { costUsd: 0, totalTokens: 0, turns: 0 },
    ),
  )

  const lifetime = computed(() => data.value.total)
  const hasData = computed(() => data.value.byDay.length > 0)
  const hasUnpriced = computed(() => data.value.hasUnpriced)
  // Session span as local day keys (undefined until a priced turn lands).
  const firstDay = computed(() =>
    data.value.firstAt ? localDayKey(Date.parse(data.value.firstAt)) : undefined,
  )
  const lastDay = computed(() =>
    data.value.lastAt ? localDayKey(Date.parse(data.value.lastAt)) : undefined,
  )
  // Peak day cost in the selected range → normalizes the mini bar heights.
  const maxDayCost = computed(() => rangeDays.value.reduce((m, d) => Math.max(m, d.costUsd), 0))

  return {
    loading,
    error,
    range,
    customFrom,
    customTo,
    rangeDays,
    rangeTotal,
    lifetime,
    hasData,
    hasUnpriced,
    firstDay,
    lastDay,
    maxDayCost,
    kfmt,
    fmtUsd,
    refresh: fetchBreakdown,
  }
}
