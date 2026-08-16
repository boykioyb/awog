// Provider model catalog — the SINGLE source for the per-provider model list
// (spec: docs/features/provider-model-catalog.md). Models belong to the PROVIDER,
// not the account: every Anthropic account shares one Anthropic list. This module
// replaces the three hardcoded copies that used to live in useSessionsData
// (PROVIDER_MODELS/MODEL_DISPLAY), agent-display (PROVIDER_MODELS/MODEL_LABELS) and
// the account editor (MODEL_CATALOG).
//
// State is a MODULE SINGLETON (reactive record) so the plain exported helpers
// below (`providerModelsShown`, `providerModelDisplayName`, …) can read it without
// a Vue component instance — the many sync call sites keep their signatures.
// Reading `catalog[p]` inside a computed tracks the dependency, so a `load()`
// (the Settings "Fetch" button, Pha 3) reactively refreshes every picker.
import { reactive } from 'vue'
import type { ProviderName } from '~/stores/settings'
import { useSidecar } from './useSidecar'

export type ModelSource = 'pi' | 'api' | 'both'

// Mirror of the sidecar models.list ModelInfo (apps/desktop/sidecar/src/methods/
// models.list.ts) — kept in sync by hand (no shared types barrel across packages).
export interface ModelInfo {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
  source: ModelSource
}

type ModelsListResponse = { models: ModelInfo[]; live: boolean; fetchedAt: string }

// Bundled seed — mirrors the previously-hardcoded curated picker lists so the
// picker is never empty before a Fetch. Order is the curated default order (drives
// the first-pick fallback). load() keeps this order first, appending fetched ids.
const SEED: Record<ProviderName, ModelInfo[]> = {
  anthropic: [
    { id: 'claude-opus-5', name: 'Opus 5', source: 'pi' },
    { id: 'claude-opus-5-1m', name: 'Opus 5 (1M)', source: 'pi' },
    { id: 'claude-sonnet-5', name: 'Sonnet 5', source: 'pi' },
    { id: 'claude-opus-4-8', name: 'Opus 4.8', source: 'pi' },
    { id: 'claude-opus-4-8-1m', name: 'Opus 4.8 (1M)', source: 'pi' },
    { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', source: 'pi' },
    { id: 'claude-haiku-4-5', name: 'Haiku 4.5', source: 'pi' },
  ],
  openai: [
    { id: 'gpt-5.5', name: 'GPT-5.5', source: 'pi' },
    { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro', source: 'pi' },
    // GPT-5.6 tiers — also the newest ChatGPT-subscription (Codex) models, so
    // they carry the display names a Codex connection's curated list renders.
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', source: 'pi' },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', source: 'pi' },
    { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', source: 'pi' },
    { id: 'gpt-5.4', name: 'GPT-5.4', source: 'pi' },
    { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', source: 'pi' },
    { id: 'gpt-5.1', name: 'GPT-5.1', source: 'pi' },
    { id: 'o4-mini', name: 'o4-mini', source: 'pi' },
    { id: 'gpt-4.1', name: 'GPT-4.1', source: 'pi' },
  ],
  google: [
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', source: 'pi' },
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', source: 'pi' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', source: 'pi' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', source: 'pi' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', source: 'pi' },
  ],
}

// Display-only labels for ids known to the runtime but not in the curated picker
// (e.g. Fable, older Opus/GPT snapshots). Used purely as a display fallback so a
// stored session/agent model id still round-trips to a friendly name.
const EXTRA_LABELS: Record<string, string> = {
  'claude-fable-5': 'Fable 5',
  'claude-opus-4-7': 'Opus 4.7',
  'claude-opus-4-6': 'Opus 4.6',
  'gpt-5': 'GPT-5',
  'gpt-5-mini': 'GPT-5 mini',
  o3: 'o3',
}

const PROVIDERS: ProviderName[] = ['anthropic', 'openai', 'google']

const clone = (list: ModelInfo[]): ModelInfo[] => list.map((m) => ({ ...m }))

// Full per-provider catalog. Seeded to the curated list; replaced in-place by load().
const catalog = reactive<Record<ProviderName, ModelInfo[]>>({
  anthropic: clone(SEED.anthropic),
  openai: clone(SEED.openai),
  google: clone(SEED.google),
})

export type ProviderStatus = {
  loading: boolean
  live: boolean
  fetchedAt?: string
  error?: string
}
const status = reactive<Record<ProviderName, ProviderStatus>>({
  anthropic: { loading: false, live: false },
  openai: { loading: false, live: false },
  google: { loading: false, live: false },
})

// Per-provider ENABLED subset the picker shows. `null` = follow the auto-filter
// default (isModernModelId); an array = the user's explicit pick (Settings toggles).
// Persisted to localStorage alongside the fetched catalog (see hydrate/persist).
const enabled = reactive<Record<ProviderName, string[] | null>>({
  anthropic: null,
  openai: null,
  google: null,
})

// --- persistence (localStorage — a UI-presentation cache, not an engine setting;
// the model actually sent still comes from the per-session/task pick) -----------

const STORAGE_KEY = 'awog.providerModels.v1'
type Persisted = {
  enabled: Record<ProviderName, string[] | null>
  catalog: Record<ProviderName, ModelInfo[]>
  status: Record<ProviderName, { fetchedAt?: string; live: boolean }>
}

function persist(): void {
  if (typeof window === 'undefined') return
  try {
    const data: Persisted = {
      enabled: { ...enabled },
      catalog: { ...catalog },
      status: {
        anthropic: { fetchedAt: status.anthropic.fetchedAt, live: status.anthropic.live },
        openai: { fetchedAt: status.openai.fetchedAt, live: status.openai.live },
        google: { fetchedAt: status.google.fetchedAt, live: status.google.live },
      },
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Quota / disabled storage — the cache is best-effort; drop silently.
  }
}

function hydrate(): void {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw) as Partial<Persisted>
    for (const p of PROVIDERS) {
      const list = data.catalog?.[p]
      // Merge the bundled seed FIRST so default models shipped in a newer app
      // version still appear over an older cache; persisted entries add fetched
      // extras + win on metadata for shared ids.
      if (Array.isArray(list) && list.length) catalog[p] = orderMerged(p, [...SEED[p], ...list])
      const en = data.enabled?.[p]
      if (en === null || Array.isArray(en)) enabled[p] = en
      const st = data.status?.[p]
      if (st) {
        status[p].fetchedAt = st.fetchedAt
        status[p].live = !!st.live
      }
    }
  } catch {
    // Corrupt cache — ignore and fall back to the bundled seed.
  }
}

// --- auto-filter (the "concise modern" picker subset) ------------------------

const DATED = /-\d{8}$/

// Whether a model id belongs in the default picker. Drops dated snapshots,
// `-latest` aliases, non-text modalities, and clearly older generations. This is a
// lightweight heuristic (Pi's list is already chat-only; the live fetch layer does
// per-provider chat filtering in Pha 3). Settings shows the FULL `all()` list.
export function isModernModelId(id: string): boolean {
  const s = id.toLowerCase()
  if (DATED.test(s)) return false
  if (s.endsWith('-latest')) return false
  // Non-text / non-chat modalities.
  if (/(embedding|whisper|tts|dall-e|moderation|realtime|audio|transcribe|image|aqa|gemma)/.test(s))
    return false
  // Old Anthropic generations (keep 4.x + fable-5 + haiku-4.5).
  if (/^claude-(instant|1|2|3)/.test(s)) return false
  // Old OpenAI generations (keep gpt-4.1; drop gpt-0..3, gpt-4/4o/4-turbo, legacy).
  if (/^gpt-[0-3]/.test(s)) return false
  if (/^gpt-4($|[^.])/.test(s)) return false
  if (/^(text-|davinci|babbage|curie|ada)/.test(s)) return false
  // Old Google generations.
  if (/^gemini-1/.test(s)) return false
  return true
}

// --- reads (pure module helpers — safe to call outside a component) -----------

export function providerModelsAll(provider: ProviderName): ModelInfo[] {
  return catalog[provider] ?? []
}

export function providerModelsShown(provider: ProviderName): ModelInfo[] {
  const en = enabled[provider]
  if (en === null) return providerModelsAll(provider).filter((m) => isModernModelId(m.id))
  const set = new Set(en)
  return providerModelsAll(provider).filter((m) => set.has(m.id))
}

// Whether a model id is in the picker (its enabled subset). Used by the Settings
// toggle rows over the FULL `all()` list.
export function isModelEnabled(provider: ProviderName, id: string): boolean {
  const en = enabled[provider]
  return en === null ? isModernModelId(id) : en.includes(id)
}

// Whether the user has overridden the auto-filter default for this provider.
export function isProviderCustomized(provider: ProviderName): boolean {
  return enabled[provider] !== null
}

// Toggle a model in/out of the picker. The first toggle materialises the current
// shown set (so a tick reads as include and an untick as exclude), mirroring the
// MCP-whitelist pattern used elsewhere.
export function toggleModelEnabled(provider: ProviderName, id: string): void {
  const base = enabled[provider] ?? providerModelsShown(provider).map((m) => m.id)
  const set = new Set(base)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  enabled[provider] = [...set]
  persist()
}

// Clear the override — the provider reverts to the auto-filter default.
export function resetProviderEnabled(provider: ProviderName): void {
  enabled[provider] = null
  persist()
}

// Engine model ids of the shown subset — for the id-based pickers (project/agent/
// translate defaults) that persist a modelId rather than a display name.
export function providerModelIds(provider: ProviderName): string[] {
  return providerModelsShown(provider).map((m) => m.id)
}

// Fetched context-window (input tokens) for a model id, if the catalog knows it
// (Pi metadata / live Google). Returns undefined for ids not in any catalog so the
// caller keeps its authoritative hardcoded map (which encodes AWOG's 1M-variant
// convention that provider metadata doesn't).
export function providerModelContextWindow(id: string): number | undefined {
  for (const p of PROVIDERS) {
    const hit = catalog[p].find((m) => m.id === id)
    if (hit?.contextWindow) return hit.contextWindow
  }
  return undefined
}

// Engine model id → friendly display name (unknown → the raw id).
export function providerModelDisplayName(id: string): string {
  for (const p of PROVIDERS) {
    const hit = catalog[p].find((m) => m.id === id)
    if (hit) return hit.name
  }
  return EXTRA_LABELS[id] ?? id
}

// Display name → engine model id (unknown → the display string itself, so custom
// endpoint ids round-trip). Searches the catalog then the display-only fallbacks.
export function providerModelIdFromDisplay(display: string): string {
  for (const p of PROVIDERS) {
    const hit = catalog[p].find((m) => m.name === display)
    if (hit) return hit.id
  }
  const extra = Object.entries(EXTRA_LABELS).find(([, name]) => name === display)
  return extra?.[0] ?? display
}

// --- fetch (Settings "Fetch" button — Pha 3 wires this) ----------------------

// Keep the curated order first, appending any newly-fetched ids after it.
function orderMerged(provider: ProviderName, models: ModelInfo[]): ModelInfo[] {
  const byId = new Map(models.map((m) => [m.id, m]))
  const out: ModelInfo[] = []
  for (const s of SEED[provider]) {
    const m = byId.get(s.id)
    if (m) {
      out.push(m)
      byId.delete(s.id)
    }
  }
  for (const m of byId.values()) out.push(m)
  return out
}

async function load(
  provider: ProviderName,
  opts?: { live?: boolean; accountId?: string },
): Promise<void> {
  const sc = useSidecar()
  if (!sc.available) return
  status[provider].loading = true
  status[provider].error = undefined
  try {
    const res = await sc.request<ModelsListResponse>('models.list', {
      provider,
      live: opts?.live ?? false,
      accountId: opts?.accountId,
    })
    if (Array.isArray(res.models) && res.models.length) {
      catalog[provider] = orderMerged(provider, res.models)
    }
    status[provider].live = res.live
    status[provider].fetchedAt = res.fetchedAt
    persist()
  } catch (err) {
    status[provider].error = err instanceof Error ? err.message : String(err)
  } finally {
    status[provider].loading = false
  }
}

// Restore the persisted enabled subset + fetched catalog on module load so the
// picker + Settings reflect prior toggles/fetches before any component mounts.
hydrate()

export function useProviderModels() {
  return {
    catalog,
    status,
    all: providerModelsAll,
    shown: providerModelsShown,
    displayName: providerModelDisplayName,
    idFromDisplay: providerModelIdFromDisplay,
    isEnabled: isModelEnabled,
    isCustomized: isProviderCustomized,
    toggle: toggleModelEnabled,
    reset: resetProviderEnabled,
    isModern: isModernModelId,
    load,
  }
}
