import type { Session, SessionMessage } from '~/types'

// Per-model context window (input tokens). Source: Anthropic public docs as of M0
// verification (2026-05-27). Update when new models ship or 1M-context flag is enabled.
const CONTEXT_WINDOW: Record<string, number> = {
  'claude-opus-4-8': 200_000,
  'claude-opus-4-8-1m': 1_000_000,
  'claude-opus-4-7': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5': 200_000,
}

export function contextLimitFor(modelId: string | undefined): number {
  if (!modelId) return 200_000
  // Exact match first so the 1M variant isn't shadowed by the `claude-opus-4-8`
  // prefix, then fall back to a prefix match (20251001-style versioned ids).
  if (modelId in CONTEXT_WINDOW) return CONTEXT_WINDOW[modelId] ?? 200_000
  const key = Object.keys(CONTEXT_WINDOW).find((k) => modelId.startsWith(k))
  return key ? (CONTEXT_WINDOW[key] ?? 200_000) : 200_000
}

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

// Coarse token estimate (~4 chars ≈ 1 token). Used only as a fallback before any
// agent turn has reported real usage.
const estimateTextTokens = (s: string | undefined): number => (s ? Math.ceil(s.length / 4) : 0)

// Last assistant message that carries provider usage — the authoritative source
// of current context occupancy.
function lastAgentWithUsage(session: Session): SessionMessage | null {
  const msgs = session.messages
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i]
    if (m?.role === 'agent' && m.usage) return m
  }
  return null
}

export interface ContextUsage {
  // Total context tokens occupied after the last turn (full prompt + reply).
  used: number
  // Context window of the model that produced the last turn.
  limit: number
  // used/limit as a 0–100 integer (capped at 100).
  percent: number
  model: string
}

// Real context occupancy after the last turn = the full prompt last sent
// (uncached input + cache-read history + cache-write) plus the reply. The cache
// buckets are essential: with prompt caching the bare `inputTokens` is only the
// uncached delta, so it alone would collapse to a few k no matter how long the
// chat gets. Before any agent turn has usage, falls back to a coarse text
// estimate (systemPrompt + message text). Single source of truth for both the
// context-status widget and the auto-compact trigger (ADR 0047).
export function contextUsage(session: Session, systemPrompt?: string): ContextUsage {
  const last = lastAgentWithUsage(session)
  // The window follows the user's SELECTED model (session.settings.modelId),
  // which retains AWOG-internal variants like `-1m`. The provider-reported
  // `modelUsed` is the API base id — the 1M variant `claude-opus-4-8-1m`
  // resolves to `claude-opus-4-8` + a beta header — so deriving the limit from
  // it wrongly collapses 1M → 200k after the first reply lands.
  const model = session.settings.modelId
  const limit = contextLimitFor(model)
  let used: number
  const u = last?.usage
  if (u) {
    used = u.inputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0) + u.outputTokens
  } else {
    const msgTokens = session.messages
      .filter((m) => m.role !== 'system')
      .reduce((acc, m) => acc + estimateTextTokens(m.text), 0)
    used = estimateTextTokens(systemPrompt) + msgTokens
  }
  const percent = limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100))
  return { used, limit, percent, model }
}

// Tokens reserved for the summary prompt + output — mirrors Pi's
// DEFAULT_COMPACTION_SETTINGS.reserveTokens so the UI auto-trigger and the
// sidecar cut agree on "near full" (ADR 0047).
export const COMPACTION_RESERVE_TOKENS = 16384

// Mirror Pi's `shouldCompact`: the context can no longer fit another turn within
// the reserve headroom. This is the auto-compact threshold ("when nearly full").
export function shouldAutoCompact(session: Session, systemPrompt?: string): boolean {
  const { used, limit } = contextUsage(session, systemPrompt)
  if (limit <= 0) return false
  return used > limit - COMPACTION_RESERVE_TOKENS
}
