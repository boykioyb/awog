// Allowlist + read-friendly catalog of Anthropic model ids accepted by AWOG.
// Anthropic /v1/messages accepts these alias ids directly (verified M0); no
// need to map to dated snapshots like `claude-haiku-4-5-20251001`.

export const ANTHROPIC_MODELS = [
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
] as const

export type AnthropicModelId = (typeof ANTHROPIC_MODELS)[number]

export function isAnthropicModel(id: string): id is AnthropicModelId {
  return (ANTHROPIC_MODELS as readonly string[]).includes(id)
}

// Whether each model supports the `thinking` request parameter. claude-haiku-4-5
// does NOT support thinking; runner skips it for that model. M4 does not enable
// thinking yet — M5/M7 will wire it for models with SUPPORTS_THINKING[id] === true.
export const SUPPORTS_THINKING: Record<AnthropicModelId, boolean> = {
  'claude-opus-4-7': true,
  'claude-opus-4-6': true,
  'claude-sonnet-4-6': true,
  'claude-haiku-4-5': false,
}
