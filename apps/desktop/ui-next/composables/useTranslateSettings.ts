import { computed } from 'vue'
import { useSettingsStore } from '~/stores/settings'
import { providerModelDisplayName, providerModelIds } from '~/composables/useProviderModels'
import type { ProviderName } from '~/types'

// Controller for the "Translation model" settings section (SettingsDefaults).
// Wired to the store's `translate` slice; mirrors useProjectLlmDefaults'
// provider→account→model reconciliation, trimmed (no effort / MCP). All writes go
// through settings.updateTranslate so the slice stays mutated in one place.

const PROVIDERS: ProviderName[] = ['anthropic', 'openai', 'google']

export function useTranslateSettings() {
  const settings = useSettingsStore()

  const followAppDefault = computed<boolean>({
    get: () => settings.translate.followAppDefault,
    set: (v) => settings.updateTranslate({ followAppDefault: v }),
  })

  const accounts = computed(() => settings.providers[settings.translate.provider]?.accounts ?? [])

  // Models the CUSTOM endpoint serves (its own curated list) else the shared
  // provider catalog. Built-in accounts share the provider list — legacy
  // `account.models` no longer restricts the picker (models belong to the provider).
  const availableModelIds = computed<string[]>(() => {
    const p = settings.translate.provider
    const cfg = settings.providers[p]
    const id = settings.translate.accountId ?? cfg?.activeAccountId ?? null
    const acct = cfg?.accounts.find((a) => a.id === id)
    if (acct?.baseURL && acct.models?.length) return acct.models
    return providerModelIds(p)
  })

  const modelLabel = (id: string): string => providerModelDisplayName(id)

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
