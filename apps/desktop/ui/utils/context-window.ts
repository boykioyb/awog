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
