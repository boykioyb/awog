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

// Compact token count: <1k raw, <1M as `123k` / `1.2k`, else `1.00M`.
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}
