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
// agents / skills / memory / msgs). Occupancy = the ITEMISED char breakdown only,
// falling back to a visible-text estimate before the first real turn. Pure derivation
// off the session's reported usage — no IPC.
//
// Tool definitions and tool results are UNMETERED (`metered: false`): they are listed
// with their token size, but contribute no Usage %, no bar segment, and nothing to
// the gauge total — user's call, 2026-09-12. Their size still comes from the engine's
// two MEASURED prompt sizes (`baseTokens` = first request, `contextTokens` = last),
// so the rows stay real numbers; they are simply excluded from what the window is
// said to hold. Consequence, stated plainly: the gauge and `free space` describe the
// nameable content, NOT the request — the same turn that itemises ~28k can send
// ~138k — and auto-compact, which reads the same occupancy, fires that much later.

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
  {
    key: 'sys',
    labelKey: 'sessions.detail.cat.systemPrompt',
    color: 'var(--accent)',
    metered: true,
  },
  {
    key: 'instr',
    labelKey: 'sessions.detail.cat.instructions',
    color: 'var(--amber)',
    metered: true,
  },
  {
    key: 'tools',
    labelKey: 'sessions.detail.cat.systemTools',
    color: 'var(--blue)',
    metered: true,
  },
  { key: 'mcp', labelKey: 'sessions.detail.cat.mcpTools', color: 'var(--add)', metered: true },
  {
    key: 'agents',
    labelKey: 'sessions.detail.cat.customAgents',
    color: 'var(--mod)',
    metered: true,
  },
  { key: 'skills', labelKey: 'sessions.detail.cat.skills', color: 'var(--green)', metered: true },
  {
    key: 'memory',
    labelKey: 'sessions.detail.cat.memoryFiles',
    color: 'var(--accent)',
    metered: true,
  },
  { key: 'msgs', labelKey: 'sessions.detail.cat.messages', color: 'var(--violet)', metered: true },
  // The two halves of what the char breakdown cannot itemise, split by the engine's
  // two measurements (first request vs last request of the turn). They are kept
  // APART because their fixes are opposite: schemas shrink by detaching MCP servers,
  // accumulated results shrink by compacting / doing less in one turn.
  // Unmetered: token size only, no Usage % and no bar segment (see the file header).
  {
    key: 'toolDefs',
    labelKey: 'sessions.detail.cat.toolDefs',
    color: 'var(--textDim)',
    metered: false,
  },
  {
    key: 'results',
    labelKey: 'sessions.detail.cat.toolResults',
    color: 'var(--textFaint)',
    metered: false,
  },
  // Same remainder, but from a turn that reported no `baseTokens` (an engine build
  // before the two-point measurement, or a run that never got a first-request
  // usage). We cannot tell schemas from results there, so we must not claim to:
  // labelling an unsplit 192k as "Tool definitions" is a lie on a turn that made 34
  // tool calls.
  {
    key: 'toolsUnsplit',
    labelKey: 'sessions.detail.cat.toolsUnsplit',
    color: 'var(--textDim)',
    metered: false,
  },
] as const satisfies readonly {
  key: BreakdownKey
  labelKey: string
  color: string
  metered: boolean
}[]

// `metered: false` → the row shows its token count but no share of the window: no
// Usage %, no bar segment. `pct` stays the honest share so a future surface can use
// it; only the rendering is withheld.
export type CatRow = {
  key: string
  label: string
  tokens: number
  color: string
  pct: number
  metered: boolean
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
  // Occupancy = the sum of the ITEMISED segments, so the gauge and the metered rows
  // always agree; before the first real turn / browser-dev we fall back to the rough
  // visible-text estimate. Tool schemas + tool results are deliberately outside it.
  const totalTok = computed(() => contextTokensFromUsage(usage.value) || estTok.value)
  // The real prompt size of the turn's last request — used ONLY to size the unmetered
  // tool rows below, never to move the gauge.
  const measuredTok = computed(() => measuredContextTokens(usage.value))
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
  // each prompt segment in usage.contextChars (÷4 ≈ tokens); the unmetered tool
  // buckets carry whatever the MEASURED prompt holds beyond them. Metered rows sum to
  // totalTok; metered + unmetered sum to the real request size.
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
  // Free space is `maxTok - totalTok`, i.e. against the ITEMISED occupancy: it reports
  // the headroom left for nameable content, and reads higher than the window really
  // has by the size of the two unmetered tool rows shown just above it.
  const catRows = computed<CatRow[]>(() => {
    const b = breakdown.value
    const limit = maxTok.value || 1
    const rows: CatRow[] = CAT_META.map((m) => ({
      key: m.key,
      label: t(m.labelKey),
      tokens: Math.round(b[m.key]),
      color: m.color,
      pct: (b[m.key] / limit) * 100,
      metered: m.metered,
    })).filter((r) => r.tokens > 0)
    const free = Math.max(0, maxTok.value - totalTok.value)
    rows.push({
      key: 'free',
      label: t('sessions.detail.cat.freeSpace'),
      tokens: free,
      color: 'var(--bgActive)',
      pct: (free / limit) * 100,
      metered: true,
    })
    return rows
  })
  // Filled bar segments: the metered categories only (Free space is the empty
  // track, and the unmetered tool buckets are deliberately not drawn).
  const barSegments = computed(() => catRows.value.filter((r) => r.key !== 'free' && r.metered))

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
