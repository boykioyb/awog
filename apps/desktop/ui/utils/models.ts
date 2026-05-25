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
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
    vendor: 'Anthropic',
    tier: 'Frontier',
    provider: 'anthropic',
    supportsThinking: true,
    maxLevel: 'extra-high',
  },
  {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    vendor: 'Anthropic',
    tier: 'Frontier',
    provider: 'anthropic',
    supportsThinking: true,
    maxLevel: 'extra-high',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    vendor: 'Anthropic',
    tier: 'Balanced',
    provider: 'anthropic',
    supportsThinking: true,
    maxLevel: 'high',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    vendor: 'Anthropic',
    tier: 'Fast',
    provider: 'anthropic',
    supportsThinking: false,
    maxLevel: 'standard',
  },
  {
    id: 'gpt-5',
    label: 'GPT-5',
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
    maxLevel: 'high',
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
    id: 'codex-1',
    label: 'Codex 1',
    vendor: 'OpenAI',
    tier: 'Coding',
    provider: 'openai',
    supportsThinking: false,
    maxLevel: 'standard',
  },
  {
    id: 'gemini-2-5-pro',
    label: 'Gemini 2.5 Pro',
    vendor: 'Google',
    tier: 'Frontier',
    provider: 'google',
    supportsThinking: true,
    maxLevel: 'high',
  },
  {
    id: 'gemini-2-5-flash',
    label: 'Gemini 2.5 Flash',
    vendor: 'Google',
    tier: 'Fast',
    provider: 'google',
    supportsThinking: false,
    maxLevel: 'standard',
  },
  {
    id: 'llama-3-3-70b',
    label: 'Llama 3.3 70B',
    vendor: 'Local',
    tier: 'Local',
    provider: 'local',
    supportsThinking: false,
    maxLevel: 'standard',
  },
  {
    id: 'qwen-3-coder-32b',
    label: 'Qwen 3 Coder 32B',
    vendor: 'Local',
    tier: 'Coding',
    provider: 'local',
    supportsThinking: false,
    maxLevel: 'standard',
  },
]

export const PROVIDER_LABEL: Record<ProviderName, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}

export const LEVEL_LABEL: Record<ThinkingLevel, string> = {
  standard: 'Standard',
  high: 'High',
  'extra-high': 'Extra High',
}

const LEVEL_RANK: Record<ThinkingLevel, number> = {
  standard: 0,
  high: 1,
  'extra-high': 2,
}

export const modelById = (id: string) => MODELS.find((m) => m.id === id)

export const modelsForProvider = (provider: ProviderName) =>
  MODELS.filter((m) => m.provider === provider)

export const levelsForModel = (model: ModelDef | undefined): ThinkingLevel[] => {
  if (!model || !model.supportsThinking) return ['standard']
  const max = LEVEL_RANK[model.maxLevel]
  return (['standard', 'high', 'extra-high'] as ThinkingLevel[]).filter(
    (lv) => LEVEL_RANK[lv] <= max,
  )
}
