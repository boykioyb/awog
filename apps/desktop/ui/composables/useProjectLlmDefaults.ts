import { computed, ref, watch } from 'vue'
import type { ProjectLlmDefaults, ProviderAccount, ProviderName, ThinkingLevel } from '~/types'
import { levelsForModel, modelById, modelsForProvider, type ModelDef } from '~/utils/models'

// Editable draft for a project's session LLM defaults. `accountId` undefined =
// follow the provider's active account (no per-project pin).
export interface LlmDefaultsDraft {
  provider: ProviderName
  accountId: string | undefined
  modelId: string
  level: ThinkingLevel
}

const PROVIDERS: ProviderName[] = ['anthropic', 'openai', 'google']

// Controller for the project LLM-defaults form (shared by the Projects page
// section and the Sessions right-click modal). Owns the draft + the
// provider→account→model→effort reconciliation, mirroring SessionChipsPopover
// but writing to a local draft instead of a live session. `getProjectId` /
// `getOpen` are getters so the caller can pass reactive props.
export const useProjectLlmDefaults = (
  getProjectId: () => string | null,
  getOpen: () => boolean,
) => {
  const ws = useWorkspaceStore()
  const settings = useSettingsStore()

  const project = computed(() => {
    const id = getProjectId()
    return id ? ws.projectById(id) : undefined
  })

  // Seed used when a project has no per-project defaults yet — the global app
  // defaults, so the form opens on something sensible rather than empty.
  const appDefault = (): LlmDefaultsDraft => ({
    provider: settings.defaults.provider,
    accountId: undefined,
    modelId: settings.defaults.modelId,
    level: settings.defaults.thinkingLevel,
  })

  const draft = ref<LlmDefaultsDraft>(appDefault())

  // (Re)load the draft from the project whenever the form opens or the target
  // project changes, so reopening always reflects what is persisted on disk.
  watch(
    [getOpen, getProjectId],
    ([open]) => {
      if (!open) return
      const ld = project.value?.llmDefaults
      draft.value = ld
        ? { provider: ld.provider, accountId: ld.accountId, modelId: ld.modelId, level: ld.level }
        : appDefault()
    },
    { immediate: true },
  )

  const accounts = computed<ProviderAccount[]>(
    () => settings.providers[draft.value.provider]?.accounts ?? [],
  )

  // Models the effective account serves (custom endpoint / curated list), else
  // the provider's static catalog. The effective account = the draft's pinned
  // account, falling back to the provider's active one.
  const accountModels = computed<string[]>(() => {
    const cfg = settings.providers[draft.value.provider]
    if (!cfg) return []
    const id = draft.value.accountId ?? cfg.activeAccountId
    return cfg.accounts.find((a) => a.id === id)?.models ?? []
  })

  const availableModels = computed<ModelDef[]>(() => {
    if (accountModels.value.length) {
      return accountModels.value.map(
        (id) =>
          modelById(id) ?? {
            id,
            label: id,
            vendor: 'Custom endpoint',
            tier: 'Custom',
            provider: draft.value.provider,
            supportsThinking: false,
            maxLevel: 'low' as ThinkingLevel,
          },
      )
    }
    return modelsForProvider(draft.value.provider)
  })

  const currentModel = computed(() =>
    availableModels.value.find((m) => m.id === draft.value.modelId),
  )
  const availableLevels = computed(() => levelsForModel(currentModel.value))

  const isProviderConnected = (p: ProviderName) => settings.isProviderConnected(p)
  const hasCustomDefaults = computed(() => !!project.value?.llmDefaults)

  // Keep the chosen effort within the current model's supported range.
  const reconcileLevel = () => {
    if (!availableLevels.value.includes(draft.value.level)) {
      draft.value.level = availableLevels.value[0] ?? 'low'
    }
  }
  // Keep the chosen model valid after a provider/account switch.
  const reconcileModel = () => {
    if (!availableModels.value.some((m) => m.id === draft.value.modelId)) {
      const first = availableModels.value[0]
      if (first) draft.value.modelId = first.id
    }
    reconcileLevel()
  }

  const setProvider = (p: ProviderName) => {
    if (draft.value.provider === p) return
    draft.value.provider = p
    draft.value.accountId = undefined // any pinned account belonged to the old provider
    reconcileModel()
  }
  const setAccount = (id: string | undefined) => {
    draft.value.accountId = id
    reconcileModel()
  }
  const setModel = (id: string) => {
    draft.value.modelId = id
    reconcileLevel()
  }
  const setLevel = (lv: ThinkingLevel) => {
    draft.value.level = lv
  }

  const save = async () => {
    const p = project.value
    if (!p) return
    const llmDefaults: ProjectLlmDefaults = {
      provider: draft.value.provider,
      modelId: draft.value.modelId,
      level: draft.value.level,
    }
    if (draft.value.accountId) llmDefaults.accountId = draft.value.accountId
    await ws.updateProject({ ...p, llmDefaults })
  }

  const resetToAppDefault = async () => {
    const p = project.value
    if (!p) return
    const next = { ...p }
    delete next.llmDefaults
    await ws.updateProject(next)
    draft.value = appDefault()
  }

  return {
    project,
    draft,
    providers: PROVIDERS,
    accounts,
    availableModels,
    availableLevels,
    currentModel,
    isProviderConnected,
    hasCustomDefaults,
    setProvider,
    setAccount,
    setModel,
    setLevel,
    save,
    resetToAppDefault,
  }
}
