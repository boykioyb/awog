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
const CONTEXT_WINDOW: Record<string, number> = {
  // "5" generation. Fable 5 ships a native 1M window (no beta header); Opus 5
  // mirrors Opus 4.8 — 200k by default, 1M via the `-1m` variant + context-1m beta.
  'claude-fable-5': 1_000_000,
  'claude-opus-5': 200_000,
  'claude-opus-5-1m': 1_000_000,
  'claude-sonnet-5': 200_000,
  'claude-opus-4-8': 200_000,
  'claude-opus-4-8-1m': 1_000_000,
  'claude-opus-4-7': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5': 200_000,
}

const DEFAULT_WINDOW = 200_000

export function contextLimitFor(modelId: string | undefined): number {
  if (!modelId) return DEFAULT_WINDOW
  // 1. Exact hardcoded match first so the 1M variant isn't shadowed by the
  //    `claude-opus-4-8` prefix (authoritative for the base-vs-1m convention).
  if (modelId in CONTEXT_WINDOW) return CONTEXT_WINDOW[modelId] ?? DEFAULT_WINDOW
  // 2. Fetched catalog metadata — lets a newly-fetched model report its real
  //    window instead of snapping to the default (Provider Model Catalog, Pha 4).
  const fetched = providerModelContextWindow(modelId)
  if (fetched) return fetched
  // 3. Prefix match (versioned ids like `…-20251001`), else the default.
  const key = Object.keys(CONTEXT_WINDOW).find((k) => modelId.startsWith(k))
  return key ? (CONTEXT_WINDOW[key] ?? DEFAULT_WINDOW) : DEFAULT_WINDOW
}

// Tokens ≈ chars / 4 — the coarse heuristic shared with the usage panel and the
// engine-side estimate. Good enough for an occupancy gauge.
const CTX_DIVISOR = 4

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
