import { computed } from 'vue'
import type { Session } from '~/composables/useSessionsData'
import { modelIdFromDisplay } from '~/composables/useSessionsData'
import { contextLimitFor, formatTokenCount } from '~/utils/context-window'

// Context-window usage math for a session — extracted from SessionDetail so the
// global status bar (footer) can render the context chip + breakdown for the
// ACTIVE session without prop-drilling. Mirrors Claude-Code `/context`: a
// per-CATEGORY breakdown of the prompt (system / instructions / tools / mcp /
// agents / skills / memory / msgs) plus an "Other" remainder, scaled to the real
// token total. Pure derivation off the session's reported usage — no IPC.

const CTX_DIVISOR = 4

// Breakdown key order = render order = bar-segment order. `other` is derived last.
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
  { key: 'other', labelKey: 'sessions.detail.cat.other', color: 'var(--textFaint)' },
] as const satisfies readonly { key: BreakdownKey; labelKey: string; color: string }[]

export type CatRow = { key: string; label: string; tokens: number; color: string; pct: number }
export type CtxItemRow = { label: string; tokens: number }

export function useSessionContextUsage(session: () => Session) {
  const { t } = useI18n()
  const { fmtUsd } = useSessionCost()

  // Compact token formatter: 1.2k / 999.
  const kfmt = (n: number): string => (n > 999 ? `${(n / 1000).toFixed(1)}k` : String(n))

  // Cumulative session cost (USD). undefined → no priced turn yet.
  const sessionCost = computed(() => session().usage?.cost)
  const model = computed(() => session().model)

  // Real engine usage when present; falls back to a rough chars/3 estimate in
  // browser-dev / before the first real turn finishes (no usage yet).
  const usage = computed(() => session().usage)
  const estTok = computed(() => {
    const chars = session().msgs.reduce((a, m) => {
      if (m.role === 'user' || m.role === 'system') return a + m.text.length
      return (
        a +
        m.blocks.reduce(
          (b, k) =>
            b +
            ('text' in k ? k.text.length : 0) +
            ('detail' in k ? (k.detail || '').length : 0) +
            60,
          0,
        )
      )
    }, 0)
    return Math.floor(chars / 3)
  })
  const totalTok = computed(() => usage.value?.total ?? estTok.value)
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
  // each prompt segment in usage.contextChars (÷4 ≈ tokens). An "Other" bucket
  // absorbs the cache/thinking/structure overhead the char estimate can't see.
  const breakdown = computed<Breakdown>(() => {
    const cap = Math.max(totalTok.value, 1)
    const cc = usage.value?.contextChars
    const tok = (chars: number | undefined) => Math.round((chars ?? 0) / CTX_DIVISOR)
    if (cc) {
      const sys = tok(cc.systemPrompt ?? cc.system)
      const instr = tok(cc.instructions)
      const tools = tok(cc.systemTools ?? cc.tools)
      const mcp = tok(cc.mcpTools)
      const agents = tok(cc.customAgents)
      const skills = tok(cc.skills)
      const memory = tok(cc.memoryFiles)
      const msgs = tok(cc.history)
      const est = sys + instr + tools + mcp + agents + skills + memory + msgs
      // Overshoot → scale every segment to the real total (Other 0); undershoot →
      // the deficit is the genuine unattributed remainder (prompt-cache, thinking…).
      if (est > cap && est > 0) {
        const k = cap / est
        return {
          sys: sys * k,
          instr: instr * k,
          tools: tools * k,
          mcp: mcp * k,
          agents: agents * k,
          skills: skills * k,
          memory: memory * k,
          msgs: msgs * k,
          other: 0,
        }
      }
      return {
        sys,
        instr,
        tools,
        mcp,
        agents,
        skills,
        memory,
        msgs,
        other: Math.max(0, totalTok.value - est),
      }
    }
    // Fallback before any real turn / in browser-dev: visible message text only.
    const msgs = Math.min(estTok.value, cap)
    return {
      sys: 0,
      instr: 0,
      tools: 0,
      mcp: 0,
      agents: 0,
      skills: 0,
      memory: 0,
      msgs,
      other: Math.max(0, totalTok.value - msgs),
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
    kfmt,
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
