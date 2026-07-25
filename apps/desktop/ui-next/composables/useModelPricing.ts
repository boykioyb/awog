// Model pricing editor state — loads the effective price table from the sidecar
// (`activity.pricing` → default + override merged, with an `isOverride` flag per
// model) and persists user overrides via `settings.set('modelPricing', map)`.
// SoC: orchestrates IPC only; no fs/SDK. Compile-time decoupled from the sidecar:
// when the bridge is absent (browser-dev) or the methods are not yet implemented
// it falls back to a small mock catalog so the Settings section stays editable.
import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'

// USD per 1M tokens. Mirrors one row of activity.pricing().models.
export type PriceSource = 'default' | 'remote' | 'override'
export type ModelPrice = {
  model: string
  provider: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  isOverride: boolean
  // Where the effective price comes from: bundled default, fetched remote
  // catalog, or a user override (override > remote > default).
  source: PriceSource
}

// The four editable price fields (USD / 1M tokens) — the override payload shape.
export type PriceFields = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type ModelPricingOverrides = Record<string, PriceFields>

type PricingResponse = { models?: unknown; fetchedAt?: unknown }
// activity.pricing.fetch result — same `models` shape + when/how-many it updated.
type PricingFetchResponse = { models?: unknown; fetchedAt?: unknown; updated?: unknown }

function mockPricing(): ModelPrice[] {
  return [
    {
      model: 'claude-opus-5',
      provider: 'Anthropic',
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite: 6.25,
      isOverride: false,
      source: 'default',
    },
    {
      model: 'claude-sonnet-5',
      provider: 'Anthropic',
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
      isOverride: false,
      source: 'default',
    },
    {
      model: 'gpt-5-codex',
      provider: 'OpenAI',
      input: 1.25,
      output: 10,
      cacheRead: 0.125,
      cacheWrite: 0,
      isOverride: false,
      source: 'default',
    },
    {
      model: 'gemini-2.5-pro',
      provider: 'Google',
      input: 1.25,
      output: 10,
      cacheRead: 0.31,
      cacheWrite: 0,
      isOverride: false,
      source: 'default',
    },
  ]
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function normalizeModels(raw: unknown): ModelPrice[] {
  if (!Array.isArray(raw)) return []
  return raw.map((m) => {
    const x = (m ?? {}) as Record<string, unknown>
    return {
      model: str(x.model),
      provider: str(x.provider),
      input: num(x.input),
      output: num(x.output),
      cacheRead: num(x.cacheRead),
      cacheWrite: num(x.cacheWrite),
      isOverride: x.isOverride === true,
      source: x.source === 'override' || x.source === 'remote' ? x.source : 'default',
    }
  })
}

export function useModelPricing() {
  const sc = useSidecar()

  const models = ref<ModelPrice[]>(sc.available ? [] : mockPricing())
  const loading = ref(false)
  const error = ref<string | null>(null)
  // ISO time the remote price catalog was last fetched (null = never / bundled only).
  const fetchedAt = ref<string | null>(null)
  // True while a `activity.pricing.fetch` round-trip is in flight (button state).
  const fetching = ref(false)
  // Working copy of overrides keyed by model — built from the loaded table; saved
  // back wholesale so removing a row's override deletes its key.
  const overrides = ref<ModelPricingOverrides>({})
  const dirty = ref(false)

  function seedOverrides(list: ModelPrice[]): void {
    const next: ModelPricingOverrides = {}
    for (const m of list) {
      if (m.isOverride) {
        next[m.model] = {
          input: m.input,
          output: m.output,
          cacheRead: m.cacheRead,
          cacheWrite: m.cacheWrite,
        }
      }
    }
    overrides.value = next
    dirty.value = false
  }

  async function load(): Promise<void> {
    if (!sc.available) {
      models.value = mockPricing()
      seedOverrides(models.value)
      return
    }
    loading.value = true
    error.value = null
    try {
      const res = await sc.request<PricingResponse>('activity.pricing')
      models.value = normalizeModels(res?.models)
      fetchedAt.value = typeof res?.fetchedAt === 'string' ? res.fetchedAt : null
      seedOverrides(models.value)
    } catch (err) {
      console.warn('[pricing] activity.pricing failed', err)
      models.value = mockPricing()
      seedOverrides(models.value)
      error.value = err instanceof Error ? err.message : 'Failed to load pricing'
    } finally {
      loading.value = false
    }
  }

  // Effective (edited) price for a model — the override if present, else the
  // loaded default. Drives the editable inputs.
  const effectivePrice = (model: ModelPrice): PriceFields =>
    overrides.value[model.model] ?? {
      input: model.input,
      output: model.output,
      cacheRead: model.cacheRead,
      cacheWrite: model.cacheWrite,
    }

  const isOverridden = (model: string): boolean => model in overrides.value

  // Edit one price field — promotes the model into the overrides map (seeded from
  // its current effective values) and patches the field.
  function setField(model: ModelPrice, field: keyof PriceFields, value: number): void {
    const current = overrides.value[model.model] ?? { ...effectivePrice(model) }
    const next: ModelPricingOverrides = {
      ...overrides.value,
      [model.model]: { ...current, [field]: Number.isFinite(value) ? value : 0 },
    }
    overrides.value = next
    dirty.value = true
  }

  // Drop a model's override → it reverts to the default on next load/save.
  function resetModel(model: string): void {
    if (!(model in overrides.value)) return
    const next = { ...overrides.value }
    delete next[model]
    overrides.value = next
    dirty.value = true
  }

  async function save(): Promise<void> {
    if (!sc.available) {
      // Off-shell: reflect the edit locally so the section behaves.
      models.value = models.value.map((m) => {
        const ov = overrides.value[m.model]
        return ov ? { ...m, ...ov, isOverride: true } : { ...m, isOverride: false }
      })
      dirty.value = false
      return
    }
    loading.value = true
    error.value = null
    try {
      await sc.request('settings.set', { modelPricing: overrides.value })
      await load()
    } catch (err) {
      console.warn('[pricing] settings.set modelPricing failed', err)
      error.value = err instanceof Error ? err.message : 'Failed to save pricing'
    } finally {
      loading.value = false
    }
  }

  // Fetch the latest prices from the curated remote catalog (LiteLLM) via the
  // sidecar, persisting a remote layer (override > remote > default). Re-seeds the
  // table; user overrides are untouched. Returns how many models were updated.
  async function fetchRemote(): Promise<number> {
    if (!sc.available) return 0
    fetching.value = true
    error.value = null
    try {
      const res = await sc.request<PricingFetchResponse>('activity.pricing.fetch')
      models.value = normalizeModels(res?.models)
      fetchedAt.value = typeof res?.fetchedAt === 'string' ? res.fetchedAt : null
      seedOverrides(models.value)
      return typeof res?.updated === 'number' ? res.updated : 0
    } catch (err) {
      console.warn('[pricing] activity.pricing.fetch failed', err)
      error.value = err instanceof Error ? err.message : 'Failed to fetch prices'
      return 0
    } finally {
      fetching.value = false
    }
  }

  const overrideCount = computed(() => Object.keys(overrides.value).length)

  return {
    models,
    loading,
    error,
    dirty,
    fetchedAt,
    fetching,
    overrideCount,
    load,
    save,
    fetchRemote,
    effectivePrice,
    isOverridden,
    setField,
    resetModel,
  }
}
