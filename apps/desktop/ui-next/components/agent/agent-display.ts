// Pure display helpers for the Agents feature — avatar color/initials, provider
// + model friendly labels, and the per-provider engine-id model catalog used by
// the editor's model picker. The model catalog + labels now come from the single
// provider-model source (useProviderModels); these are thin re-exports so the
// Agents feature keeps one import surface. No IPC in these helpers (SoC).
import type { Agent } from '~/stores/agents'
import type { ProviderName } from '~/stores/settings'
import { providerModelDisplayName, providerModelsShown } from '~/composables/useProviderModels'

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

// Engine model id → friendly display name — delegates to the single provider-model
// source. Unknown ids fall back to the raw id.
export function modelDisplayName(modelId: string): string {
  return providerModelDisplayName(modelId)
}

// Per-provider model catalog (engine id + display label) for the editor picker —
// the auto-filtered "modern" subset from the single provider-model source.
export function modelsForProvider(provider: ProviderName): { id: string; label: string }[] {
  return providerModelsShown(provider).map((m) => ({ id: m.id, label: m.name }))
}
