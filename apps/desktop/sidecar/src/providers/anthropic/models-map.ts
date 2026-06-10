// Allowlist + read-friendly catalog of Anthropic model ids accepted by AWOG.
// Anthropic /v1/messages accepts these alias ids directly (verified M0); no
// need to map to dated snapshots like `claude-haiku-4-5-20251001`.

export const ANTHROPIC_MODELS = [
  'claude-fable-5',
  // 1M-context variant of Fable 5 — same AWOG-internal-id mechanism as
  // claude-opus-4-8-1m below (rewritten to the base model + context-1m beta).
  'claude-fable-5-1m',
  'claude-opus-4-8',
  // 1M-context variant of Opus 4.8. AWOG-internal id only — it is NOT a real
  // API model name. resolveModelRequest() maps it to `claude-opus-4-8` plus the
  // `context-1m-2025-08-07` beta header, which is how SDK 0.3.152 enables the
  // 1M window (Claude Code's `[1m]` model-suffix syntax is unsupported here).
  'claude-opus-4-8-1m',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
] as const

export type AnthropicModelId = (typeof ANTHROPIC_MODELS)[number]

export function isAnthropicModel(id: string): id is AnthropicModelId {
  return (ANTHROPIC_MODELS as readonly string[]).includes(id)
}

// Claude Code subagent AGENT.md files commonly set `model:` to a short alias
// (haiku/sonnet/opus) or `inherit`, not a full AWOG model id. Map those to the
// concrete model so the task engine can run such agents. Full ids + unknown
// values pass through unchanged (caller still validates via isAnthropicModel).
const MODEL_ALIASES: Record<string, AnthropicModelId> = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
  // `inherit`/`default` have no parent in a task run → pick a sensible mid model.
  inherit: 'claude-sonnet-4-6',
  default: 'claude-sonnet-4-6',
}

export function normalizeModelId(id: string | undefined): string {
  if (!id) return ''
  return MODEL_ALIASES[id.trim().toLowerCase()] ?? id
}

// Beta header that opts a request into the 1M-token context window.
const CONTEXT_1M_BETA = 'context-1m-2025-08-07'

// Map an AWOG model id to the request shape the SDK expects: the real API model
// name plus any beta headers. Most ids pass through unchanged; the 1M variant
// rewrites to the base model and attaches the context-1m beta.
export function resolveModelRequest(id: string): { model: string; betas?: string[] } {
  if (id === 'claude-fable-5-1m') {
    return { model: 'claude-fable-5', betas: [CONTEXT_1M_BETA] }
  }
  if (id === 'claude-opus-4-8-1m') {
    return { model: 'claude-opus-4-8', betas: [CONTEXT_1M_BETA] }
  }
  return { model: id }
}

// Whether each model supports the `thinking` request parameter. claude-haiku-4-5
// does NOT support thinking; runner skips it for that model. M4 does not enable
// thinking yet — M5/M7 will wire it for models with SUPPORTS_THINKING[id] === true.
export const SUPPORTS_THINKING: Record<AnthropicModelId, boolean> = {
  'claude-fable-5': true,
  'claude-fable-5-1m': true,
  'claude-opus-4-8': true,
  'claude-opus-4-8-1m': true,
  'claude-opus-4-7': true,
  'claude-opus-4-6': true,
  'claude-sonnet-4-6': true,
  'claude-haiku-4-5': false,
}
