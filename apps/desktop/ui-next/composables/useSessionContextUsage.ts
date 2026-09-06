import { computed } from 'vue'
import type { Session } from '~/composables/useSessionsData'
import { modelIdFromDisplay } from '~/composables/useSessionsData'
import {
  contextLimitFor,
  contextTokensFromUsage,
  estimateContextTokens,
  formatTokenCount,
} from '~/utils/context-window'

// Context-window usage math for a session — extracted from SessionDetail so the
// global status bar (footer) can render the context chip + breakdown for the
// ACTIVE session without prop-drilling. Mirrors Claude-Code `/context`: a
// per-CATEGORY breakdown of the prompt (system / instructions / tools / mcp /
// agents / skills / memory / msgs). Occupancy = the engine's MEASURED prompt size
// for the last request (input + cacheRead + cacheWrite of that one request — never
// `output`, which is the response), falling back to the itemised char sum. The
// difference between the two lands in the `other` row: tool schemas + the tool
// results the loop accumulated, which the char breakdown cannot see. Pure derivation
// off the session's reported usage — no IPC.

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
  | 'other'
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
  // Everything the char breakdown cannot itemise: tool SCHEMAS (SDK built-ins +
  // each attached MCP server) and the tool RESULTS the loop accumulated this turn.
  // Only appears when the engine reported a measured occupancy larger than the
  // itemised sum — which is the normal case on the Claude SDK path.
  { key: 'other', labelKey: 'sessions.detail.cat.other', color: 'var(--textDim)' },
] as const satisfies readonly { key: BreakdownKey; labelKey: string; color: string }[]

export type CatRow = { key: string; label: string; tokens: number; color: string; pct: number }
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
  // Occupancy = the assembled prompt content the model sees (the breakdown sum),
  // NOT the API usage total. When the engine breakdown is present we sum it (so the
  // gauge and the per-category rows always agree); before the first real turn /
  // browser-dev we fall back to the rough visible-text estimate.
  // Prefer the MEASURED prompt size of the last request (tool schemas + tool results
  // included); fall back to the itemised char sum, then to the visible-text estimate.
  const totalTok = computed(() => contextTokensFromUsage(usage.value) || estTok.value)
  // Context window follows the session's SELECTED model id (retains `-1m`); the
  // provider's base id collapses 1M → 200k, so we derive from the display the user
  // picked, not from usage. Prefer an engine-reported max if one is ever set.
  const maxTok = computed(
    () => usage.value?.max ?? contextLimitFor(modelIdFromDisplay(session().model)),
  )
  const tokLabel = computed(() => formatTokenCount(totalTok.value))
  const limitLabel = computed(() => formatTokenCount(maxTok.value))
  const pct = computed(() =>
    maxTok.value ? Math.min(100, (totalTok.value / maxTok.value) * 100) : 0,
  )

  // Context-window breakdown by CONTENT category. The engine reports char sizes of
  // each prompt segment in usage.contextChars (÷4 ≈ tokens); the `other` bucket
  // carries whatever the measured prompt holds beyond them, so the rows always sum
  // to totalTok.
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
      // Rows must sum to the gauge. When the engine measured a bigger prompt than we
      // can itemise, the difference IS real content (tool schemas + tool results) —
      // show it rather than letting the bar and the total disagree.
      const sum = Object.values(itemised).reduce((a, b) => a + b, 0)
      return { ...itemised, other: Math.max(0, totalTok.value - sum) }
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
      other: 0,
    }
  })

  // One row per category + Free space; tokens, % of the window, and a colour for
  // the square + bar segment. Empty categories (0 tokens) are dropped, except Free.
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
  // Filled bar segments (everything except Free space, which is the empty track).
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
