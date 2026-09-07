import type { ContextChars, SessionMessage } from '~/composables/useSessionsData'
import { providerModelContextWindow } from '~/composables/useProviderModels'

// Per-model context window (input tokens), ported from apps/desktop/ui. The
// window follows the user's SELECTED model id — which retains AWOG-internal
// variants like `-1m`. The provider-reported base id collapses the 1M variant
// (`claude-opus-4-8-1m` → `claude-opus-4-8` + a beta header), so deriving the
// limit from it would wrongly snap 1M back to 200k. This map is AUTHORITATIVE for
// the ids it lists (it encodes the base-vs-1m convention that provider metadata
// doesn't); a fetched model NOT listed here falls back to its catalog metadata
// (see contextLimitFor). Source: Anthropic public docs.
// The 200k-base + `-1m`-variant convention below described the Opus 4.6/4.7 era,
// where 1M needed the `context-1m` beta header. The current generation ships 1M
// NATIVELY, so the old 200k rows were simply stale — and a stale row here is not
// cosmetic: it rendered as "217k / 200k · 100%, free space 0" on a request the API
// had just accepted, and it pins auto-compact to a ceiling that does not exist.
// Three independent confirmations for `claude-opus-4-8`: a 217,049-token request
// accepted on this account, Claude Code's own context panel reporting `/1M` for the
// same account, and Anthropic's current model table. The `-1m` ids are kept (they
// still resolve) even though they now equal their base. Haiku 4.5 stays at 200k.
const CONTEXT_WINDOW: Record<string, number> = {
  'claude-fable-5': 1_000_000,
  'claude-opus-5': 1_000_000,
  'claude-opus-5-1m': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-opus-4-8': 1_000_000,
  'claude-opus-4-8-1m': 1_000_000,
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-4-5': 200_000,
}

const DEFAULT_WINDOW = 200_000

export function contextLimitFor(modelId: string | undefined): number {
  if (!modelId) return DEFAULT_WINDOW
  // Fetched catalog metadata, when the provider reports a BIGGER window than the
  // table below. The table is a cached constant and goes stale the moment a model's
  // window grows — seen live: a 217,049-token request ACCEPTED on `claude-opus-4-8`
  // while this table still said 200k, which rendered as "217k / 200k · 100%, free
  // space 0". Taking the larger value keeps the base-vs-1m convention intact (the
  // table is only ever raised, never lowered, so a collapsed `-1m` id can't snap
  // back down) while letting Settings → Models → Fetch correct a stale row.
  const fetched = providerModelContextWindow(modelId)
  // 1. Exact hardcoded match first so the 1M variant isn't shadowed by the
  //    `claude-opus-4-8` prefix (authoritative for the base-vs-1m convention).
  if (modelId in CONTEXT_WINDOW) {
    const hard = CONTEXT_WINDOW[modelId] ?? DEFAULT_WINDOW
    return fetched && fetched > hard ? fetched : hard
  }
  // 2. Fetched catalog metadata — lets a newly-fetched model report its real
  //    window instead of snapping to the default (Provider Model Catalog, Pha 4).
  if (fetched) return fetched
  // 3. Prefix match (versioned ids like `…-20251001`), else the default.
  const key = Object.keys(CONTEXT_WINDOW).find((k) => modelId.startsWith(k))
  return key ? (CONTEXT_WINDOW[key] ?? DEFAULT_WINDOW) : DEFAULT_WINDOW
}

// The window to measure occupancy against: the declared limit, floored by the
// biggest prompt the provider has actually ACCEPTED for this session.
//
// A 200-response to an N-token request is proof the window is at least N — so a
// gauge reading "217k / 200k · 100%, free space 0" is not a full window, it is a
// wrong denominator. Flooring makes the gauge self-correcting: it can never claim
// a session is full while the provider keeps accepting bigger prompts, and it
// stops auto-compact firing forever against a limit that does not exist.
export function contextLimitForUsage(
  modelId: string | undefined,
  usage: { max?: number; contextTokens?: number } | undefined,
): number {
  const declared = usage?.max ?? contextLimitFor(modelId)
  return Math.max(declared, usage?.contextTokens ?? 0)
}

// Tokens ≈ chars / 4 — the coarse heuristic shared with the usage panel and the
// engine-side estimate. Good enough for an occupancy gauge.
export const CTX_DIVISOR = 4

// Context-window OCCUPANCY in tokens: the size of the prompt the model actually
// sees, summed from the engine's per-segment char breakdown (÷4 ≈ tokens) the way
// Claude Code's `/context` measures it — system prompt + instructions + system
// tools + MCP tools + custom agents + skills + memory files + messages.
//
// This counts only the text AWOG itself assembles, so it UNDER-reports whenever the
// runtime adds content of its own (tool schemas, and the tool results a turn
// accumulates). Prefer contextTokensFromUsage, which takes the engine's measured
// number when there is one and falls back to this. Returns 0 when no breakdown is
// available (the caller falls back to its own rough estimate).
//
// Note on the API tally: the prompt size IS input + cacheRead + cacheWrite of a
// SINGLE request (disjoint buckets); `output` is the response and never part of the
// input window, and summing a whole turn's totals (many requests) would overshoot —
// which is why the engine reports the last request's three buckets explicitly.
export function contextTokensFromChars(cc: ContextChars | undefined): number {
  if (!cc) return 0
  const tok = (chars: number | undefined): number => Math.round((chars ?? 0) / CTX_DIVISOR)
  return (
    tok(cc.systemPrompt ?? cc.system) +
    tok(cc.instructions) +
    tok(cc.systemTools ?? cc.tools) +
    tok(cc.mcpTools) +
    tok(cc.customAgents) +
    tok(cc.skills) +
    tok(cc.memoryFiles) +
    tok(cc.history)
  )
}

// Context-window occupancy in tokens, preferring the MEASURED number the engine
// reports (the prompt size of the last request) over the char-breakdown sum.
//
// Why measured wins: `contextChars` itemises only the text AWOG assembles. It cannot
// see the tool schemas the runtime sends (SDK built-ins, and every attached MCP
// server's tool list) nor the tool results the loop accumulates inside a turn — on
// the Claude SDK path it also reports systemTools/mcpTools as 0 because those live
// inside the SDK. Measured against real sessions the breakdown read ~28k tokens where
// the request actually carried ~138k, so a gauge built on it never reached the
// auto-compact threshold and sessions ran at the most expensive end of the window.
//
// Returns 0 when neither is available (caller falls back to its own estimate).
export function contextTokensFromUsage(
  usage: { contextTokens?: number; contextChars?: ContextChars } | undefined,
): number {
  if (usage?.contextTokens && usage.contextTokens > 0) return usage.contextTokens
  return contextTokensFromChars(usage?.contextChars)
}

// Rough occupancy estimate from the CLIENT-side transcript, for the cases with no
// engine breakdown: browser-dev, and a transcript persisted before per-turn `usage`
// shipped. TEXT-ONLY on purpose — the runtimes replay the reply/user text only (the
// Claude path's renderHistoryPrefix, the Pi path's historyToAgentMessages), so a
// step's `detail` (diff / file content / terminal output) is UI-only and must NEVER
// be counted: doing so read a ~35k-token prompt as 222k. Same chars/4 heuristic as
// the engine breakdown, so the two paths are comparable. Shared by the usage panel
// and the auto-compact trigger — they must agree on what "% full" means.
export function estimateContextTokens(msgs: SessionMessage[]): number {
  const chars = msgs.reduce((acc, m) => {
    if (m.role === 'user' || m.role === 'system') return acc + m.text.length
    return acc + m.blocks.reduce((b, k) => b + (k.kind === 'text' ? k.text.length : 0), 0)
  }, 0)
  return Math.floor(chars / CTX_DIVISOR)
}

// Drop trailing zeros from a fixed-decimal string ("4.00" → "4", "720.10" → "720.1").
// Guarded on the dot so an integer string ("1000") is never truncated.
function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

// Compact token count, single source of truth for every token/turn readout.
// Precision shrinks as the unit grows so the string stays ~4-5 chars:
//   842 · 1.5k · 266k · 4M · 16.92M · 720.1M · 2.45B
// The billion tier matters: an agentic day is millions of cache-read tokens, so a
// 7d Activity total lands in the billions and `2446.1M` is unreadable.
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs < 1000) return String(Math.round(n))
  if (abs < 1_000_000) return `${trimZeros((n / 1000).toFixed(abs < 10_000 ? 1 : 0))}k`
  if (abs < 1_000_000_000) return `${trimZeros((n / 1_000_000).toFixed(abs < 10_000_000 ? 2 : 1))}M`
  return `${trimZeros((n / 1_000_000_000).toFixed(2))}B`
}
