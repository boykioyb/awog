// Map AWOG ThinkingLevel → Pi `SimpleStreamOptions.reasoning` (ADR 0029 item 6).
//
// AWOG levels (Claude Code effort picker) → Pi reasoning levels:
//   low        → undefined  (no extended thinking — matches sdk branch where
//                            'low' = budget 0 = thinking off)
//   medium     → 'low'
//   high       → 'medium'
//   extra-high → 'high'
//   max        → 'xhigh'
//
// Degrade rules (provider-agnostic — Pi maps reasoning per provider, so this
// works for Anthropic, OpenAI o-series + gpt-5, and Google Gemini alike):
//   - model.reasoning === false → always undefined (e.g. Haiku, gpt-4.1,
//     gemini-2.0-flash, every custom endpoint).
//   - the requested Pi level not in getSupportedThinkingLevels(model) → clamp
//     down to the model's nearest supported level via clampThinkingLevel; if
//     that clamps to 'off' (or 'minimal' below our floor) → undefined.

import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai'
import type { ThinkingLevel as AwogThinkingLevel } from '../types/shared.js'

type PiReasoning = NonNullable<SimpleStreamOptions['reasoning']>

// AWOG level → desired Pi reasoning level. 'low' maps to undefined (off) and is
// handled before this map is consulted.
const LEVEL_MAP: Record<Exclude<AwogThinkingLevel, 'low'>, PiReasoning> = {
  medium: 'low',
  high: 'medium',
  'extra-high': 'high',
  max: 'xhigh',
}

export function toReasoning(
  level: AwogThinkingLevel,
  model: Model<Api>,
): PiReasoning | undefined {
  if (level === 'low') return undefined
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
