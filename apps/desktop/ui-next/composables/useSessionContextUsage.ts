import { computed } from 'vue'
import type { Session } from '~/composables/useSessionsData'
import { modelIdFromDisplay } from '~/composables/useSessionsData'
import {
  contextLimitForUsage,
  contextTokensFromUsage,
  estimateContextTokens,
  formatTokenCount,
  measuredContextTokens,
} from '~/utils/context-window'

// Context-window usage math for a session — extracted from SessionDetail so the
// global status bar (footer) can render the context chip + breakdown for the
// ACTIVE session without prop-drilling. Mirrors Claude-Code `/context`: a
// per-CATEGORY breakdown of the prompt (system / instructions / tools / mcp /
// agents / skills / memory / msgs). Occupancy = the engine's MEASURED prompt
// size of the last request (`contextTokens` — the same number the session list
// row shows), falling back to the itemised char breakdown, then to a visible-text
// estimate before the first real turn. Pure derivation off the session's reported
// usage — no IPC.
//
// Gauge measures the REAL prompt (decision changed 2026-10-11 — the earlier
// itemised-only gauge read 4% on a session whose request was actually 83% of the
// window, which left auto-compact permanently blind on tool-heavy sessions). So
// every row is now metered, including the two unmetered halves the char breakdown
// cannot name — `toolDefs` (schemas + context carried over) and `results` (what
// this turn's tool loop added) — sized from the engine's two MEASURED prompt
// sizes (`baseTokens` = first request, `contextTokens` = last). The itemised sum
// is still what we can point at; it just no longer owns the headline number.

const CTX_DIVISOR = 4

// Breakdown key order = render order = bar-segment order.
type BreakdownKey =
  | 'sys'
  | 'instr'
  | 'tools'
  | 'mcp'
  | 'agents'
  | 'skills'
  | 'memory'
  | 'msgs'
  | 'toolDefs'
  | 'results'
  | 'toolsUnsplit'
type Breakdown = Record<BreakdownKey, number>

// Palette intentionally avoids --del (red): every category here is benign, so a
// red swatch would falsely read as an error. Messages (usually the dominant
// bucket) gets the prominent violet; the rarely-co-shown static-context buckets
// (system prompt / memory files) share the accent family.
const CAT_META = [
  { key: 'sys', labelKey: 'sessions.detail.cat.systemPrompt', color: 'var(--accent)' },
  { key: 'instr', labelKey: 'sessions.detail.cat.instructions', color: 'var(--amber)' },
  { key: 'tools', labelKey: 'sessions.detail.cat.systemTools', color: 'var(--blue)' },
  { key: 'mcp', labelKey: 'sessions.detail.cat.mcpTools', color: 'var(--add)' },
  { key: 'agents', labelKey: 'sessions.detail.cat.customAgents', color: 'var(--mod)' },
  { key: 'skills', labelKey: 'sessions.detail.cat.skills', color: 'var(--green)' },
  { key: 'memory', labelKey: 'sessions.detail.cat.memoryFiles', color: 'var(--accent)' },
  { key: 'msgs', labelKey: 'sessions.detail.cat.messages', color: 'var(--violet)' },
  // The two halves of what the char breakdown cannot itemise, split by the engine's
  // two measurements (first request vs last request of the turn). They are kept
  // APART because their fixes are opposite: schemas shrink by detaching MCP servers,
  // accumulated results shrink by compacting / doing less in one turn.
  { key: 'toolDefs', labelKey: 'sessions.detail.cat.toolDefs', color: 'var(--textDim)' },
  { key: 'results', labelKey: 'sessions.detail.cat.toolResults', color: 'var(--textFaint)' },
  // Same remainder, but from a turn that reported no `baseTokens` (an engine build
  // before the two-point measurement, or a run that never got a first-request
  // usage). We cannot tell schemas from results there, so we must not claim to:
  // labelling an unsplit 192k as "Tool definitions" is a lie on a turn that made 34
  // tool calls.
  { key: 'toolsUnsplit', labelKey: 'sessions.detail.cat.toolsUnsplit', color: 'var(--textDim)' },
] as const satisfies readonly {
  key: BreakdownKey
  labelKey: string
  color: string
}[]

export type CatRow = {
  key: string
  label: string
  tokens: number
  color: string
  pct: number
}
export type CtxItemRow = { label: string; tokens: number }

export function useSessionContextUsage(session: () => Session) {
  const { t } = useI18n()
  const { fmtUsd } = useSessionCost()

  // Cumulative session cost (USD). undefined → no priced turn yet.
  const sessionCost = computed(() => session().usage?.cost)
  const model = computed(() => session().model)

  // Real engine usage when present; falls back to a rough estimate in browser-dev /
  // for a transcript persisted before per-turn `usage` shipped (a session that HAS a
  // persisted snapshot restores it on open — see the store's usageFromMessages).
  const usage = computed(() => session().usage)
  // Fallback occupancy estimate, shared with the store's auto-compact trigger so both
  // read the same number. TEXT-ONLY (see estimateContextTokens): the previous local
  // version counted every step's `detail` at chars/3 + 60/block — tool output the
  // model never receives — which read a ~35k-token prompt as 222k / 111% full.
  const estTok = computed(() => estimateContextTokens(session().msgs))
  // Occupancy = the MEASURED prompt size of the turn's last request (the same
  // number the session list row shows), so the gauge reports the real fill —
  // the earlier itemised-only number read 4% on a session actually at 83%.
  // Falls back to the itemised char sum, then the rough visible-text estimate
  // before the first real turn / in browser-dev.
  const measuredTok = computed(() => measuredContextTokens(usage.value))
  const totalTok = computed(
    () => measuredTok.value || contextTokensFromUsage(usage.value) || estTok.value,
  )
  // Context window follows the session's SELECTED model id (retains `-1m`); the
  // provider's base id collapses 1M → 200k, so we derive from the display the user
  // picked, not from usage. Prefer an engine-reported max if one is ever set.
  const maxTok = computed(() =>
    contextLimitForUsage(modelIdFromDisplay(session().model), usage.value),
  )
  const tokLabel = computed(() => formatTokenCount(totalTok.value))
  const limitLabel = computed(() => formatTokenCount(maxTok.value))
  const pct = computed(() =>
    maxTok.value ? Math.min(100, (totalTok.value / maxTok.value) * 100) : 0,
  )

  // Context-window breakdown by CONTENT category. The engine reports char sizes of
  // each prompt segment in usage.contextChars (÷4 ≈ tokens); the two unmetered
  // buckets carry whatever the MEASURED prompt holds beyond them. All rows now
  // sum to the real request size.
  const breakdown = computed<Breakdown>(() => {
    const cc = usage.value?.contextChars
    const tok = (chars: number | undefined) => Math.round((chars ?? 0) / CTX_DIVISOR)
    if (cc) {
      const itemised = {
        sys: tok(cc.systemPrompt ?? cc.system),
        instr: tok(cc.instructions),
        tools: tok(cc.systemTools ?? cc.tools),
        mcp: tok(cc.mcpTools),
        agents: tok(cc.customAgents),
        skills: tok(cc.skills),
        memory: tok(cc.memoryFiles),
        msgs: tok(cc.history),
      }
      // The engine measures TWO prompt sizes per turn: its first request
      // (`baseTokens` — the standing cost) and its last (`contextTokens` — the peak).
      // The part of the MEASURED prompt the char breakdown cannot itemise splits
      // cleanly between them:
      //   toolDefs = base − itemised text  → tool schemas + the runtime's own preset
      //              (plus context carried over from earlier turns on a resumed run)
      //   results  = peak − base           → what THIS turn's tool loop added
      // Without a `baseTokens` (older turn) everything falls into toolsUnsplit rather
      // than being invented as results — the honest reading of "we don't know yet".
      // These subtract from `measured`, not from `totalTok`: the gauge no longer
      // contains them, so deriving them from it would always yield 0 and the rows
      // would silently disappear.
      const sum = Object.values(itemised).reduce((a, b) => a + b, 0)
      const measured = measuredTok.value
      const remainder = Math.max(0, measured - sum)
      const base = usage.value?.baseTokens
      // No second measurement → one honestly-unlabelled bucket, not a guess.
      if (!base) {
        return { ...itemised, toolDefs: 0, results: 0, toolsUnsplit: remainder }
      }
      return {
        ...itemised,
        toolDefs: Math.max(0, Math.min(base, measured) - sum),
        results: Math.max(0, measured - Math.max(base, sum)),
        toolsUnsplit: 0,
      }
    }
    // Fallback before any real turn / in browser-dev: attribute the rough
    // visible-text estimate to Messages (the only segment we can see client-side).
    return {
      sys: 0,
      instr: 0,
      tools: 0,
      mcp: 0,
      agents: 0,
      skills: 0,
      memory: 0,
      msgs: estTok.value,
      toolDefs: 0,
      results: 0,
      toolsUnsplit: 0,
    }
  })

  // One row per category + Free space; tokens, % of the window, and a colour for
  // the square + bar segment. Empty categories (0 tokens) are dropped, except Free.
  // Free space is `maxTok - totalTok` — against the MEASURED occupancy now, so it
  // is the headroom the next request really has left.
  const catRows = computed<CatRow[]>(() => {
    const b = breakdown.value
    const limit = maxTok.value || 1
    const rows: CatRow[] = CAT_META.map((m) => ({
      key: m.key,
      label: t(m.labelKey),
      tokens: Math.round(b[m.key]),
      color: m.color,
      pct: (b[m.key] / limit) * 100,
    })).filter((r) => r.tokens > 0)
    const free = Math.max(0, maxTok.value - totalTok.value)
    rows.push({
      key: 'free',
      label: t('sessions.detail.cat.freeSpace'),
      tokens: free,
      color: 'var(--bgActive)',
      pct: (free / limit) * 100,
    })
    return rows
  })
  // Filled bar segments: every category except Free space, which is the empty track.
  const barSegments = computed(() => catRows.value.filter((r) => r.key !== 'free'))

  // Expandable detail sections (MEMORY FILES / CUSTOM AGENTS), each a flat list of
  // label + token count from the engine breakdown.
  const memoryFilesList = computed<CtxItemRow[]>(() =>
    (usage.value?.contextChars?.memoryFilesList ?? []).map((it) => ({
      label: it.label,
      tokens: Math.round(it.chars / CTX_DIVISOR),
    })),
  )
  const agentsList = computed<CtxItemRow[]>(() =>
    (usage.value?.contextChars?.customAgentsList ?? []).map((it) => ({
      label: it.label,
      tokens: Math.round(it.chars / CTX_DIVISOR),
    })),
  )

  return {
    fmtUsd,
    sessionCost,
    model,
    tokLabel,
    limitLabel,
    pct,
    barSegments,
    catRows,
    memoryFilesList,
    agentsList,
  }
}
