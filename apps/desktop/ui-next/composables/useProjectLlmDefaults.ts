import { computed, ref, watch } from 'vue'
import { useProjectsStore } from '~/stores/projects'
import { useSettingsStore } from '~/stores/settings'
import {
  MODEL_DISPLAY,
  modelDisplayName,
  modelIdFromDisplay,
  modelsForProvider,
  PROVIDER_DISPLAY,
  type ThinkingLevel,
} from '~/composables/useSessionsData'
import type { ProjectLlmDefaults, ProviderName } from '~/types'

// Controller for the per-project LLM-defaults form. Owns the draft + the
// provider→account→model→effort reconciliation, mirroring the old UI
// useProjectLlmDefaults trimmed to the ui-next model catalog (useSessionsData).
// `accountId` undefined = follow the provider's active account. `getProjectId` /
// `getOpen` are getters so the modal can pass reactive props.

export interface LlmDefaultsDraft {
  provider: ProviderName
  accountId: string | undefined
  modelId: string
  level: ThinkingLevel
}

const PROVIDERS: ProviderName[] = ['anthropic', 'openai', 'google']
const LEVELS: ThinkingLevel[] = ['low', 'medium', 'high', 'extra-high', 'max']

// Map a display catalog name (e.g. "Opus 4.8") → engine modelId. Falls back to
// the display string itself when unknown (custom endpoint ids round-trip as-is).
function modelIdsForProvider(provider: ProviderName): string[] {
  const display = PROVIDER_DISPLAY[provider]
  if (!display) return []
  return modelsForProvider(display).map((name) => modelIdFromDisplay(name))
}

export function useProjectLlmDefaults(getProjectId: () => string | null, getOpen: () => boolean) {
  const store = useProjectsStore()
  const settings = useSettingsStore()

  const project = computed(() => {
    const id = getProjectId()
    return id ? store.projectById(id) : undefined
  })

  // Seed used when a project has no per-project defaults yet — the global app
  // defaults so the form opens on something sensible.
  const appDefault = (): LlmDefaultsDraft => ({
    provider: settings.defaults.provider,
    accountId: undefined,
    modelId: settings.defaults.modelId,
    level: settings.defaults.thinkingLevel,
  })

  const draft = ref<LlmDefaultsDraft>(appDefault())

  watch(
    [getOpen, getProjectId] as const,
    ([open]) => {
      if (!open) return
      // The settings store only hydrates accounts on the Settings modal mount;
      // pull the real accounts.list so the account picker isn't empty when this
      // modal is opened directly (else it shows only the "active account" stub).
      void settings.hydrateFromSidecar()
      const ld = project.value?.llmDefaults
      draft.value = ld
        ? {
            provider: ld.provider,
            accountId: ld.accountId,
            modelId: ld.modelId,
            level: ld.level,
          }
        : appDefault()
    },
    { immediate: true },
  )

  const accounts = computed(() => settings.providers[draft.value.provider]?.accounts ?? [])

  // Models the effective account serves (custom list) else the provider catalog.
  const availableModelIds = computed<string[]>(() => {
    const cfg = settings.providers[draft.value.provider]
    const id = draft.value.accountId ?? cfg?.activeAccountId ?? null
    const accountModels = cfg?.accounts.find((a) => a.id === id)?.models
    if (accountModels && accountModels.length) return accountModels
    return modelIdsForProvider(draft.value.provider)
  })

  const modelLabel = (id: string): string => MODEL_DISPLAY[id] ?? modelDisplayName(id)

  const hasCustomDefaults = computed(() => !!project.value?.llmDefaults)
  const isProviderConnected = (p: ProviderName) => settings.isProviderConnected(p)

  const reconcileModel = () => {
    if (!availableModelIds.value.includes(draft.value.modelId)) {
      const first = availableModelIds.value[0]
      if (first) draft.value.modelId = first
    }
  }

  const setProvider = (p: ProviderName) => {
    if (draft.value.provider === p) return
    draft.value.provider = p
    draft.value.accountId = undefined
    reconcileModel()
  }
  const setAccount = (id: string | undefined) => {
    draft.value.accountId = id
    reconcileModel()
  }
  const setModel = (id: string) => {
    draft.value.modelId = id
  }
  const setLevel = (lv: ThinkingLevel) => {
    draft.value.level = lv
  }

  // Persist the draft as the project's llmDefaults. Returns the saved project.
  const save = async () => {
    const p = project.value
    if (!p) return undefined
    const llmDefaults: ProjectLlmDefaults = {
      provider: draft.value.provider,
      modelId: draft.value.modelId,
      level: draft.value.level,
    }
    if (draft.value.accountId) llmDefaults.accountId = draft.value.accountId
    return store.updateProject({ ...p, llmDefaults })
  }

  // Clear the per-project override (new sessions inherit the global defaults).
  const resetToAppDefault = async () => {
    const p = project.value
    if (!p) return undefined
    const next = { ...p }
    delete next.llmDefaults
    const saved = await store.updateProject(next)
    draft.value = appDefault()
    return saved
  }

  return {
    project,
    draft,
    providers: PROVIDERS,
    levels: LEVELS,
    accounts,
    availableModelIds,
    modelLabel,
    hasCustomDefaults,
    isProviderConnected,
    setProvider,
    setAccount,
    setModel,
    setLevel,
    save,
    resetToAppDefault,
  }
}
