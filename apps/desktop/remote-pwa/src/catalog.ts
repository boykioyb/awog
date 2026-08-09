import { ref } from 'vue'
import { gateway } from './gateway'
import type { RemoteAccount, RemoteBootstrap, RemoteModel, RemoteProject } from './types'

// Desktop catalog the phone needs to label rows and offer "New session": the
// project list, the model catalog per usable provider, and the desktop's own
// session defaults. One gateway-local call (`remote.bootstrap`) — the phone never
// sees project paths, account labels or the settings blob.

export const projects = ref<RemoteProject[]>([])
export const providers = ref<RemoteBootstrap['providers']>([])
export const defaults = ref<RemoteBootstrap['defaults']>({
  provider: 'anthropic',
  modelId: 'claude-opus-5',
  level: 'high',
})

// Why the catalog is empty, if it is. A phone talking to a desktop whose Electron
// main predates `remote.bootstrap` gets "method not allowed" here — silently
// showing empty pickers would look like a missing feature instead of a stale build.
export const catalogError = ref<string | null>(null)

const byId = ref<Map<string, RemoteProject>>(new Map())
let loaded = false

export function projectName(id: string | null | undefined): string {
  if (!id) return ''
  return byId.value.get(id)?.name ?? id
}

export function projectColor(id: string | null | undefined): string | null {
  if (!id) return null
  return byId.value.get(id)?.color ?? null
}

export function modelsFor(provider: string): RemoteModel[] {
  return providers.value.find((p) => p.provider === provider)?.models ?? []
}

// A friendly model label from any provider's catalog (the row/badge shows the
// name the desktop shows; unknown ids fall back to the raw id).
export function modelName(modelId: string): string {
  for (const p of providers.value) {
    const hit = p.models.find((m) => m.id === modelId)
    if (hit) return hit.name
  }
  return modelId
}

export async function loadCatalog(force = false): Promise<void> {
  if (loaded && !force) return
  try {
    const data = await gateway.request<RemoteBootstrap>('remote.bootstrap', {})
    projects.value = data.projects
    providers.value = data.providers
    defaults.value = data.defaults
    byId.value = new Map(data.projects.map((p) => [p.id, p]))
    catalogError.value = null
    loaded = true
  } catch (e) {
    // Non-fatal: rows fall back to raw ids and the gateway still resolves
    // defaults server-side — but the pickers have nothing to offer, so say why.
    catalogError.value = e instanceof Error ? e.message : 'Không tải được danh mục'
  }
}

// ─── Session config vocabularies ────────────────────────────────────────────

// Thinking levels — mirrors ThinkingLevel in ui-next/types/index.ts (the sidecar
// zod schema is the enforcing copy).
export const THINKING_LEVELS = ['low', 'medium', 'high', 'extra-high', 'max'] as const

export const THINKING_LABELS: Record<string, string> = {
  low: 'Thấp',
  medium: 'Vừa',
  high: 'Cao',
  'extra-high': 'Rất cao',
  max: 'Tối đa',
}

// Response styles (ADR 0046). `id` is the ENGINE SLUG — the sidecar's
// STYLE_DIRECTIVES key (apps/desktop/sidecar/src/style/styles.ts); the labels
// mirror ui-next/composables/useSessionModelConfig.ts. An id the sidecar doesn't
// know degrades to "no style" there, so a drift here is cosmetic, not fatal.
export const RESPONSE_STYLES: { group: string; rows: { id: string; label: string }[] }[] = [
  {
    group: 'Mặc định',
    rows: [
      { id: 'Default', label: 'Normal' },
      { id: 'auto', label: 'Auto' },
    ],
  },
  {
    group: 'Nhanh gọn',
    rows: [
      { id: 'military', label: 'Military' },
      { id: 'caveman', label: 'Caveman' },
      { id: 'reality-check', label: 'Reality Check' },
      { id: 'step-by-step', label: 'Step by Step' },
      { id: 'socratic', label: 'Socratic' },
      { id: 'bluf', label: 'BLUF' },
      { id: 'checklist', label: 'Checklist' },
      { id: 'code-first', label: 'Code First' },
    ],
  },
  {
    group: 'Vui',
    rows: [
      { id: 'yoda', label: 'Yoda' },
      { id: 'pirate', label: 'Pirate' },
      { id: 'hacker-80s', label: '80s Hacker' },
      { id: 'dad-joke', label: 'Dad Joke' },
      { id: 'noir', label: 'Noir' },
      { id: 'speedrun', label: 'Speedrun' },
      { id: 'corporate', label: 'Corporate' },
    ],
  },
  {
    group: 'Đào sâu',
    rows: [
      { id: 'rubber-duck', label: 'Rubber Duck' },
      { id: 'feynman', label: 'Feynman' },
      { id: 'first-principles', label: 'First Principles' },
      { id: 'devils-advocate', label: "Devil's Advocate" },
      { id: 'mentor', label: 'Mentor' },
      { id: 'pair', label: 'Pair' },
    ],
  },
]

export function accountsFor(provider: string): RemoteAccount[] {
  return providers.value.find((p) => p.provider === provider)?.accounts ?? []
}

export function activeAccountFor(provider: string): string | null {
  return providers.value.find((p) => p.provider === provider)?.activeAccountId ?? null
}

// Models a given account can serve: a custom endpoint / Codex account curates its
// own list; everything else uses the provider catalog.
export function modelsForAccount(provider: string, accountId: string): RemoteModel[] {
  const own = accountsFor(provider).find((a) => a.id === accountId)?.models
  if (own?.length) return own.map((id) => ({ id, name: id }))
  return modelsFor(provider)
}

export function accountLabel(provider: string, accountId: string | undefined): string {
  if (!accountId) return 'Mặc định'
  return accountsFor(provider).find((a) => a.id === accountId)?.label ?? accountId
}
