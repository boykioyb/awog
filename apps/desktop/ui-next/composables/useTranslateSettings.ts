import { computed } from 'vue'
import { useSettingsStore } from '~/stores/settings'
import {
  MODEL_DISPLAY,
  modelDisplayName,
  modelIdFromDisplay,
  modelsForProvider,
  PROVIDER_DISPLAY,
} from '~/composables/useSessionsData'
import type { ProviderName } from '~/types'

// Controller for the "Translation model" settings section (SettingsDefaults).
// Wired to the store's `translate` slice; mirrors useProjectLlmDefaults'
// provider→account→model reconciliation, trimmed (no effort / MCP). All writes go
// through settings.updateTranslate so the slice stays mutated in one place.

const PROVIDERS: ProviderName[] = ['anthropic', 'openai', 'google']

function modelIdsForProvider(provider: ProviderName): string[] {
  const display = PROVIDER_DISPLAY[provider]
  if (!display) return []
  return modelsForProvider(display).map((name) => modelIdFromDisplay(name))
}

export function useTranslateSettings() {
  const settings = useSettingsStore()

  const followAppDefault = computed<boolean>({
    get: () => settings.translate.followAppDefault,
    set: (v) => settings.updateTranslate({ followAppDefault: v }),
  })

  const accounts = computed(() => settings.providers[settings.translate.provider]?.accounts ?? [])

  // Models the effective account serves (custom list) else the provider catalog.
  const availableModelIds = computed<string[]>(() => {
    const p = settings.translate.provider
    const cfg = settings.providers[p]
    const id = settings.translate.accountId ?? cfg?.activeAccountId ?? null
    const accountModels = cfg?.accounts.find((a) => a.id === id)?.models
    if (accountModels && accountModels.length) return accountModels
    return modelIdsForProvider(p)
  })

  const modelLabel = (id: string): string => MODEL_DISPLAY[id] ?? modelDisplayName(id)

  function reconcileModel() {
    if (!availableModelIds.value.includes(settings.translate.modelId)) {
      const first = availableModelIds.value[0]
      if (first) settings.updateTranslate({ modelId: first })
    }
  }

  const provider = computed<string>({
    get: () => settings.translate.provider,
    set: (value) => {
      const p = value as ProviderName
      if (settings.translate.provider === p) return
      settings.updateTranslate({ provider: p, accountId: undefined })
      reconcileModel()
    },
  })

  // '__active' sentinel ↔ undefined (follow the provider's active account).
  const accountId = computed<string>({
    get: () => settings.translate.accountId ?? '__active',
    set: (v) => {
      settings.updateTranslate({ accountId: v === '__active' ? undefined : v })
      reconcileModel()
    },
  })

  const modelId = computed<string>({
    get: () => settings.translate.modelId,
    set: (id) => settings.updateTranslate({ modelId: id }),
  })

  const isProviderConnected = (p: ProviderName) => settings.isProviderConnected(p)

  return {
    PROVIDERS,
    followAppDefault,
    provider,
    accountId,
    modelId,
    accounts,
    availableModelIds,
    modelLabel,
    isProviderConnected,
  }
}
