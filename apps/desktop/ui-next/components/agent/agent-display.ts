// Pure display helpers for the Agents feature — avatar color/initials, provider
// + model friendly labels, and the per-provider engine-id model catalog used by
// the editor's model picker. No store/IPC access (SoC: display only).
import type { Agent } from '~/stores/agents'
import type { ProviderName } from '~/stores/settings'

// Deterministic accent palette keyed off the agent id hash (prototype AGCOL
// vibe: translucent tint bg + bright foreground). var() tokens aren't usable in
// a JS hash-pick (we need N distinct colors), so this is an intentional curated
// palette of soft tints — matches the prototype's static agent avatars.
const AVATAR_PALETTE: { bg: string; fg: string }[] = [
  { bg: 'rgba(167,139,250,.15)', fg: '#c4b5fd' },
  { bg: 'rgba(16,185,129,.15)', fg: '#6ee7b7' },
  { bg: 'rgba(239,68,68,.13)', fg: '#fca5a5' },
  { bg: 'rgba(96,165,250,.15)', fg: '#93c5fd' },
  { bg: 'rgba(245,158,11,.15)', fg: '#fcd34d' },
  { bg: 'rgba(236,72,153,.15)', fg: '#f9a8d4' },
  { bg: 'rgba(45,212,191,.15)', fg: '#5eead4' },
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

// Avatar tint for an agent — stable per (source|projectId|id).
export function agentAvatar(agent: Pick<Agent, 'id' | 'source' | 'projectId'>): {
  bg: string
  fg: string
} {
  const key = `${agent.source}|${agent.projectId ?? ''}|${agent.id}`
  return AVATAR_PALETTE[hashString(key) % AVATAR_PALETTE.length] as { bg: string; fg: string }
}

// 2-char initials: the role tag when short, else first letters of the name
// words, else the first two chars of the id.
export function agentInitials(agent: Pick<Agent, 'name' | 'role' | 'id'>): string {
  const role = (agent.role ?? '').trim()
  if (role && role.length <= 3) return role.toUpperCase()
  const words = (agent.name ?? '')
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase()
  const base = (agent.name || agent.id || '?').replace(/[^a-z0-9]/gi, '')
  return (base.slice(0, 2) || '?').toUpperCase()
}

// --- Provider + model catalog --------------------------------------------

const PROVIDER_LABELS: Record<ProviderName, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}

export function providerDisplayName(provider: ProviderName): string {
  return PROVIDER_LABELS[provider] ?? provider
}

export const PROVIDERS: { id: ProviderName; label: string }[] = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google' },
]

// Engine model id → friendly display name. Aligned with the sidecar
// providers/anthropic/models-map + the sessions model catalog. Unknown ids fall
// back to the raw id.
const MODEL_LABELS: Record<string, string> = {
  'claude-fable-5': 'Fable 5',
  'claude-opus-5': 'Opus 5',
  'claude-opus-5-1m': 'Opus 5 (1M)',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-opus-4-8-1m': 'Opus 4.8 (1M)',
  'claude-opus-4-7': 'Opus 4.7',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5': 'Haiku 4.5',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.5-pro': 'GPT-5.5 Pro',
  'gpt-5.4-mini': 'GPT-5.4 mini',
  'gpt-5.1': 'GPT-5.1',
  'o4-mini': 'o4-mini',
  'gpt-5': 'GPT-5',
  'gpt-5-mini': 'GPT-5 mini',
  o3: 'o3',
  'gpt-4.1': 'GPT-4.1',
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
}

export function modelDisplayName(modelId: string): string {
  return MODEL_LABELS[modelId] ?? modelId
}

// Per-provider model catalog (engine id + display label) for the editor picker.
const PROVIDER_MODELS: Record<ProviderName, { id: string; label: string }[]> = {
  anthropic: [
    { id: 'claude-opus-5', label: 'Opus 5' },
    { id: 'claude-opus-5-1m', label: 'Opus 5 (1M)' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5' },
    { id: 'claude-opus-4-8', label: 'Opus 4.8' },
    { id: 'claude-opus-4-8-1m', label: 'Opus 4.8 (1M)' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    { id: 'gpt-5.1', label: 'GPT-5.1' },
    { id: 'o4-mini', label: 'o4-mini' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
  ],
  google: [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  ],
}

export function modelsForProvider(provider: ProviderName): { id: string; label: string }[] {
  return PROVIDER_MODELS[provider] ?? []
}
