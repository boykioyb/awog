// Map AWOG ThinkingLevel → Pi `SimpleStreamOptions.reasoning` (ADR 0078, which
// amends the mapping recorded in ADR 0029 item 6).
//
// AWOG's picker IS the Claude Code effort picker, and Pi's reasoning scale
// (off | minimal | low | medium | high | xhigh | max) carries the very same
// names, so the mapping is 1:1 — nothing is shifted:
//   low        → 'low'
//   medium     → 'medium'
//   high       → 'high'
//   extra-high → 'xhigh'
//   max        → 'max'
//
// Pi's 'minimal' stays unused: AWOG's picker has no level below 'low'.
//
// ACCEPTED DIVERGENCE at 'low': on the Claude SDK path (Anthropic provider)
// `thinkingFromLevel` in claude-sdk/shared.ts still returns `{ type: 'disabled' }`,
// so "Low" means extended thinking OFF on Anthropic while it means
// `reasoning: 'low'` here. Deliberate, see ADR 0078 — Anthropic gets its depth
// hint from `effort: 'low'` either way, and matching the Claude Code scale on
// every other provider was judged more valuable than mirroring that one switch.
//
// Degrade rules (provider-agnostic — Pi maps reasoning per provider, so this
// works for Anthropic, OpenAI o-series + gpt-5, and Google Gemini alike):
//   - model.reasoning === false → always undefined (e.g. Haiku, gpt-4.1,
//     gemini-2.0-flash, every custom endpoint).
//   - the requested Pi level not in getSupportedThinkingLevels(model) → clamp
//     down to the model's nearest supported level via clampThinkingLevel; if
//     that clamps to 'off' (or 'minimal' below our floor) → undefined. Models
//     that never declare 'xhigh'/'max' (e.g. Gemini) therefore land on 'high'
//     for both 'extra-high' and 'max' — the model's own ceiling, not a mapping
//     bug.

import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai'
import type { ThinkingLevel as AwogThinkingLevel } from '../types/shared.js'

type PiReasoning = NonNullable<SimpleStreamOptions['reasoning']>

// AWOG level → desired Pi reasoning level (1:1 with the Claude Code picker).
const LEVEL_MAP: Record<AwogThinkingLevel, PiReasoning> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  'extra-high': 'xhigh',
  max: 'max',
}

export function toReasoning(
  level: AwogThinkingLevel,
  model: Model<Api>,
): PiReasoning | undefined {
  if (!model.reasoning) return undefined

  const desired = LEVEL_MAP[level]
  // Clamp the desired level to what this concrete model actually supports
  // (e.g. 'xhigh' is only on selected families). clampThinkingLevel returns a
  // ModelThinkingLevel which may be 'off'.
  const clamped = clampThinkingLevel(model, desired)
  if (clamped === 'off') return undefined

  // Final guard: only return a level the model lists as supported.
  const supported = getSupportedThinkingLevels(model)
  if (!supported.includes(clamped)) return undefined

  // clamped is now a non-'off' ModelThinkingLevel == PiReasoning.
  return clamped
}
