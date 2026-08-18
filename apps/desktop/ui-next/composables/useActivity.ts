// Activity orchestrator — fetches the usage/cost summary from the sidecar
// (`activity.summary`) for a chosen time range + optional account filter, and
// derives the view the UI binds to (summary cards, timeseries chart, by-model
// + by-account tables, missing-price flags). SoC: it only reaches the sidecar
// through useSidecar; no fs/SDK access. The Activity modal (ActivityView.vue)
// stays a thin template binding this composable's refs.
//
// Compile-time decoupled from the sidecar: when the Electron bridge is absent or
// `activity.summary` fails, the summary stays EMPTY and the error surfaces. Usage
// and cost figures are never synthesized — a sample number here reads as the
// user's own spend.
import { computed, ref, watch } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { useAccounts } from '~/composables/useAccounts'
import { useProjects } from '~/composables/useProjects'
import { formatTokenCount } from '~/utils/context-window'

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

// One active day inside a session's row — re-priced with the page's catalog and
// filters, so the expanded days sum to the collapsed row (a session's own Cost
// tab prices from persisted per-turn cost instead; the two can differ).
export type ActivitySessionDay = {
  date: string
  totalTokens: number
  costUsd: number
  turns: number
}

export type ActivityBySession = {
  sessionId: string
  title: string
  projectId?: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  costUsd: number
  turns: number
  lastAt: string
  byDay: ActivitySessionDay[]
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
  bySession: ActivityBySession[]
  byDay: ActivityByDay[]
  // Models referenced in the period that have no configured price → cost is
  // under-reported for them. The page flags these rows.
  missingPrices: string[]
}

// Sort order for the by-session table.
export type SessionSort = 'most' | 'least'

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
const PROJECT_ALL = 'all' as const

// Client-side memo of successful summaries, keyed by range|accountId|projectId.
// Flipping ranges (1d/7d/30d…) or reopening the modal within the TTL serves the
// cached result instantly — no IPC round-trip and no bySession JSONL re-scan.
// Module-level so it survives ActivityView's v-if remount; the short TTL bounds
// staleness for the live "today" bucket (a running session keeps spending).
const SUMMARY_TTL_MS = 30_000
const summaryCache = new Map<string, { summary: ActivitySummary; at: number }>()

function summaryCacheKey(range: ActivityRange, accountId: string, projectId: string): string {
  return `${range}|${accountId}|${projectId}`
}

// ── Compact + currency formatting (module-level pure helpers) ──

// Compact token formatting: 2_400_000_000 → "2.4B", 2_400_000 → "2.4M", 720 → "720".
// Same rule as the session surfaces — one formatter, one source of truth.
export function formatTokens(n: number): string {
  return formatTokenCount(n)
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
    bySession: [],
    byDay: [],
    missingPrices: [],
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

  const bySession: ActivityBySession[] = Array.isArray(r.bySession)
    ? r.bySession.map((s) => {
        const x = (s ?? {}) as Record<string, unknown>
        const projectId = str(x.projectId)
        return {
          sessionId: str(x.sessionId),
          title: str(x.title),
          ...(projectId ? { projectId } : {}),
          provider: str(x.provider),
          model: str(x.model),
          inputTokens: num(x.inputTokens),
          outputTokens: num(x.outputTokens),
          cacheReadTokens: num(x.cacheReadTokens),
          cacheWriteTokens: num(x.cacheWriteTokens),
          totalTokens: num(x.totalTokens),
          costUsd: num(x.costUsd),
          turns: num(x.turns),
          lastAt: str(x.lastAt),
          byDay: Array.isArray(x.byDay)
            ? (x.byDay as unknown[]).map((d) => {
                const y = (d ?? {}) as Record<string, unknown>
                return {
                  date: str(y.date),
                  totalTokens: num(y.totalTokens),
                  costUsd: num(y.costUsd),
                  turns: num(y.turns),
                }
              })
            : [],
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
    bySession,
    byDay,
    missingPrices,
  }
}

export function useActivity() {
  const sc = useSidecar()
  const { accounts } = useAccounts()
  const { projects } = useProjects()

  const range = ref<ActivityRange>('7d')
  // 'all' = no account filter; otherwise a real account id from useAccounts.
  const accountId = ref<string>(ACCOUNT_ALL)
  // 'all' = no project filter; otherwise a real project id from useProjects.
  const projectId = ref<string>(PROJECT_ALL)
  // By-session table sort: most-used (default) or least-used.
  const sessionSort = ref<SessionSort>('most')
  // Session ids whose per-day drill-down is open in the by-session table.
  const expandedSessions = ref(new Set<string>())
  const summary = ref<ActivitySummary>(emptySummary(range.value))
  const loading = ref(false)
  // True only until the very first summary lands. The cards show "…" during this
  // one; after that a range/filter switch keeps the previous numbers visible while
  // the new ones load (stale-while-revalidate) so the view never blanks/flickers.
  const initialLoad = ref(sc.available)
  const error = ref<string | null>(null)

  // Account filter options for the AppSelect (All + each real account).
  const accountOptions = computed(() => [
    { id: ACCOUNT_ALL, label: '' as string, display: '' as string },
    ...accounts.value.map((a) => ({ id: a.id, label: a.label, display: a.display })),
  ])

  // Low-level fetch for one (range, account, project) combo — serves the memo when
  // fresh, else hits the sidecar and stores the result. Never touches summary /
  // loading, so it doubles as the prefetch primitive. Returns null when offline.
  async function requestSummary(
    r: ActivityRange,
    acc: string,
    proj: string,
    force: boolean,
  ): Promise<ActivitySummary | null> {
    if (!sc.available) return null
    const key = summaryCacheKey(r, acc, proj)
    if (!force) {
      const hit = summaryCache.get(key)
      if (hit && Date.now() - hit.at < SUMMARY_TTL_MS) return hit.summary
    }
    const res = await sc.request<unknown>('activity.summary', {
      range: r,
      ...(acc !== ACCOUNT_ALL ? { accountId: acc } : {}),
      ...(proj !== PROJECT_ALL ? { projectId: proj } : {}),
    })
    const norm = normalize(res, r)
    summaryCache.set(key, { summary: norm, at: Date.now() })
    return norm
  }

  // Load the summary for the CURRENT selection into the view. `force` bypasses the
  // memo. A stale-response guard drops any result whose selection changed while it
  // was in flight (fast range flipping) so late arrivals never clobber the view.
  async function fetchSummary(force = false): Promise<void> {
    if (!sc.available) {
      initialLoad.value = false
      return
    }
    const r = range.value
    const acc = accountId.value
    const proj = projectId.value
    const selectionCurrent = (): boolean =>
      r === range.value && acc === accountId.value && proj === projectId.value

    // Memo hit → swap instantly, no loading flash.
    const key = summaryCacheKey(r, acc, proj)
    const hit = force ? undefined : summaryCache.get(key)
    if (hit && Date.now() - hit.at < SUMMARY_TTL_MS) {
      summary.value = hit.summary
      error.value = null
      loading.value = false
      initialLoad.value = false
      return
    }

    loading.value = true
    error.value = null
    try {
      const norm = await requestSummary(r, acc, proj, force)
      if (!selectionCurrent()) return // superseded by a newer selection — discard
      if (norm) summary.value = norm
    } catch (err) {
      if (!selectionCurrent()) return
      // Transient failure or an unimplemented method: show the empty summary plus
      // the error, never invented totals.
      console.warn('[activity] activity.summary failed', err)
      summary.value = emptySummary(r)
      error.value = err instanceof Error ? err.message : 'Failed to load activity'
    } finally {
      if (selectionCurrent()) {
        loading.value = false
        initialLoad.value = false
      }
    }
  }

  // Warm every range for the current account/project combo in the background so a
  // range switch is instant (the "precompute" the user expects). Sequential —
  // cheapest range first ('all' scans the most history) — to avoid firing five
  // concurrent JSONL scans; already-fresh combos are skipped by the memo.
  async function prefetchAll(): Promise<void> {
    if (!sc.available) return
    const acc = accountId.value
    const proj = projectId.value
    for (const r of ACTIVITY_RANGES) {
      // Bail if the filter combo changed under us — a new prefetch pass took over.
      if (acc !== accountId.value || proj !== projectId.value) return
      // The visible range is already handled by fetchSummary — don't double-fetch.
      if (r === range.value) continue
      try {
        await requestSummary(r, acc, proj, false)
      } catch {
        // Best-effort warm-up; the on-demand fetch will surface any real error.
      }
    }
  }

  // Re-fetch the visible selection when range or a filter changes (immediate first
  // load), and warm the other ranges whenever the filter combo changes.
  watch([range, accountId, projectId], () => void fetchSummary(), { immediate: true })
  watch([accountId, projectId], () => void prefetchAll(), { immediate: true })
  // A new window/filter means new rows — an open drill-down would otherwise show
  // days that no longer belong to the row above it.
  watch([range, accountId, projectId], () => expandedSessions.value.clear())

  // Toggle a session's per-day drill-down (by-session table).
  function toggleSessionDays(sessionId: string): void {
    const open = expandedSessions.value
    if (open.has(sessionId)) open.delete(sessionId)
    else open.add(sessionId)
  }
  const isSessionExpanded = (sessionId: string): boolean => expandedSessions.value.has(sessionId)

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
  // by-session rows sorted by total tokens; direction driven by sessionSort so
  // the user can flip between most-used and least-used sessions.
  const bySession = computed(() => {
    const rows = [...summary.value.bySession]
    const dir = sessionSort.value === 'most' ? -1 : 1
    return rows.sort(
      (a, b) => dir * (a.totalTokens - b.totalTokens) || dir * (a.costUsd - b.costUsd),
    )
  })

  const isEmpty = computed(
    () => !loading.value && totals.value.totalTokens === 0 && summary.value.byDay.length === 0,
  )

  return {
    // state
    range,
    accountId,
    projectId,
    sessionSort,
    accountOptions,
    accounts,
    projects,
    loading,
    initialLoad,
    error,
    available: sc.available,
    // derived
    summary,
    totals,
    chartBars,
    byModel,
    byAccount,
    bySession,
    missingPriceSet,
    hasMissingPrices,
    isEmpty,
    // actions
    fetchSummary,
    isSessionExpanded,
    toggleSessionDays,
    // formatters (re-exported for the template)
    formatTokens,
    formatCost,
  }
}
