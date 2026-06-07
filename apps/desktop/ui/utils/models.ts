import type { ProviderName, ThinkingLevel } from '~/types'

export interface ModelDef {
  id: string
  label: string
  vendor: string
  tier: string
  provider: ProviderName | 'local'
  supportsThinking: boolean
  maxLevel: ThinkingLevel
}

export const MODELS: ModelDef[] = [
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    vendor: 'Anthropic',
    tier: 'Frontier',
    provider: 'anthropic',
    supportsThinking: true,
    maxLevel: 'max',
  },
  {
    // AWOG-internal id (not a real API name). Sidecar maps it to claude-opus-4-8
    // + the context-1m beta header — see resolveModelRequest in models-map.ts.
    id: 'claude-opus-4-8-1m',
    label: 'Claude Opus 4.8 (1M context)',
    vendor: 'Anthropic',
    tier: 'Frontier',
    provider: 'anthropic',
    supportsThinking: true,
    maxLevel: 'max',
  },
  {
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
    vendor: 'Anthropic',
    tier: 'Frontier',
    provider: 'anthropic',
    supportsThinking: true,
    maxLevel: 'max',
  },
  {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    vendor: 'Anthropic',
    tier: 'Frontier',
    provider: 'anthropic',
    supportsThinking: true,
    maxLevel: 'max',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    vendor: 'Anthropic',
    tier: 'Balanced',
    provider: 'anthropic',
    supportsThinking: true,
    maxLevel: 'extra-high',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    vendor: 'Anthropic',
    tier: 'Fast',
    provider: 'anthropic',
    supportsThinking: false,
    maxLevel: 'low',
  },
  // ─── OpenAI ────────────────────────────────────────────────────────────────
  // Ids verified against pi getModels('openai'). AWOG thinking levels map to pi
  // reasoning (medium→low, high→medium, extra-high→high) — see runtime/thinking.
  // maxLevel is capped at the highest AWOG level the model usefully expresses
  // (pi 'high'); higher AWOG levels clamp down at runtime regardless.
  {
    id: 'gpt-5.1',
    label: 'GPT-5.1',
    vendor: 'OpenAI',
    tier: 'Frontier',
    provider: 'openai',
    supportsThinking: true,
    maxLevel: 'extra-high',
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 mini',
    vendor: 'OpenAI',
    tier: 'Fast',
    provider: 'openai',
    supportsThinking: true,
    maxLevel: 'extra-high',
  },
  {
    id: 'o3',
    label: 'o3',
    vendor: 'OpenAI',
    tier: 'Reasoning',
    provider: 'openai',
    supportsThinking: true,
    maxLevel: 'extra-high',
  },
  {
    id: 'gpt-4.1',
    label: 'GPT-4.1',
    vendor: 'OpenAI',
    tier: 'Fast',
    provider: 'openai',
    supportsThinking: false,
    maxLevel: 'low',
  },
  // ─── Google ──────────────────────────────────────────────────────────────
  // Ids verified against pi getModels('google').
  {
    id: 'gemini-3-pro-preview',
    label: 'Gemini 3 Pro',
    vendor: 'Google',
    tier: 'Frontier',
    provider: 'google',
    supportsThinking: true,
    maxLevel: 'extra-high',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    vendor: 'Google',
    tier: 'Frontier',
    provider: 'google',
    supportsThinking: true,
    maxLevel: 'extra-high',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    vendor: 'Google',
    tier: 'Fast',
    provider: 'google',
    supportsThinking: true,
    maxLevel: 'extra-high',
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    vendor: 'Google',
    tier: 'Fast',
    provider: 'google',
    supportsThinking: false,
    maxLevel: 'low',
  },
]

export const PROVIDER_LABEL: Record<ProviderName, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}

export const LEVEL_LABEL: Record<ThinkingLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  'extra-high': 'Extra high',
  max: 'Max',
}

const LEVEL_RANK: Record<ThinkingLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  'extra-high': 3,
  max: 4,
}

export const modelById = (id: string) => MODELS.find((m) => m.id === id)

export const modelsForProvider = (provider: ProviderName) =>
  MODELS.filter((m) => m.provider === provider)

export const levelsForModel = (model: ModelDef | undefined): ThinkingLevel[] => {
  if (!model || !model.supportsThinking) return ['low']
  const max = LEVEL_RANK[model.maxLevel]
  return (['low', 'medium', 'high', 'extra-high', 'max'] as ThinkingLevel[]).filter(
    (lv) => LEVEL_RANK[lv] <= max,
  )
}
