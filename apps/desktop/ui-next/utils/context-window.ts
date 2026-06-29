import type { ContextChars } from '~/composables/useSessionsData'

// Per-model context window (input tokens), ported from apps/desktop/ui. The
// window follows the user's SELECTED model id — which retains AWOG-internal
// variants like `-1m`. The provider-reported base id collapses the 1M variant
// (`claude-opus-4-8-1m` → `claude-opus-4-8` + a beta header), so deriving the
// limit from it would wrongly snap 1M back to 200k. Source: Anthropic public
// docs. Update when new models ship or a 1M-context flag is enabled.
const CONTEXT_WINDOW: Record<string, number> = {
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
  // Exact match first so the 1M variant isn't shadowed by the `claude-opus-4-8`
  // prefix, then fall back to a prefix match (versioned ids like `…-20251001`).
  if (modelId in CONTEXT_WINDOW) return CONTEXT_WINDOW[modelId] ?? DEFAULT_WINDOW
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
// We deliberately do NOT derive occupancy from API usage (input + cacheRead +
// cacheWrite + output). Per Anthropic, the prompt size IS input + cacheRead +
// cacheWrite — the cached prefix is just the cached vs uncached split of these same
// content segments, NOT extra occupancy — and `output` is the response, never part
// of the input window. Summing those on top of the itemised content produced a
// phantom "cache + overhead" bucket that pushed the gauge past 100%. Counting the
// assembled content directly (like `/context`) is self-consistent with the
// breakdown and never overshoots. Returns 0 when no breakdown is available (the
// caller falls back to its own rough estimate / treats the session as empty).
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

// Compact token count: <1k raw, <1M as `123k` / `1.2k`, else `1.00M`.
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}
