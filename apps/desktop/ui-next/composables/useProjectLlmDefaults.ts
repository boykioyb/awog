import { computed, ref, watch } from 'vue'
import { useProjectsStore } from '~/stores/projects'
import { useSettingsStore } from '~/stores/settings'
import { useConnectionsStore } from '~/stores/connections'
import { THINKING_LEVELS } from '~/composables/useSessionsData'
import type { ThinkingLevel } from '~/composables/useSessionsData'
import { providerModelDisplayName, providerModelIds } from '~/composables/useProviderModels'
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
  // MCP whitelist new sessions in this project start with. undefined = all enabled
  // servers (default); explicit array = whitelist (a subset, possibly empty).
  mcpServerIds: string[] | undefined
}

const PROVIDERS: ProviderName[] = ['anthropic', 'openai', 'google']
const LEVELS = THINKING_LEVELS

export function useProjectLlmDefaults(getProjectId: () => string | null, getOpen: () => boolean) {
  const store = useProjectsStore()
  const settings = useSettingsStore()
  const connections = useConnectionsStore()

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
    mcpServerIds: undefined,
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
      // The connections store loads lazily — pull the server list so the MCP picker
      // isn't empty when this modal is opened before the Connections page was visited.
      if (!connections.loaded) void connections.loadServers()
      const ld = project.value?.llmDefaults
      draft.value = ld
        ? {
            provider: ld.provider,
            accountId: ld.accountId,
            modelId: ld.modelId,
            level: ld.level,
            mcpServerIds: ld.mcpServerIds ? [...ld.mcpServerIds] : undefined,
          }
        : appDefault()
    },
    { immediate: true },
  )

  const accounts = computed(() => settings.providers[draft.value.provider]?.accounts ?? [])

  // Models the CUSTOM endpoint serves (its own curated list) else the shared
  // provider catalog. Built-in accounts share the provider list — their legacy
  // `account.models` no longer restricts the picker (models belong to the provider).
  const availableModelIds = computed<string[]>(() => {
    const cfg = settings.providers[draft.value.provider]
    const id = draft.value.accountId ?? cfg?.activeAccountId ?? null
    const acct = cfg?.accounts.find((a) => a.id === id)
    if (acct?.baseURL && acct.models?.length) return acct.models
    return providerModelIds(draft.value.provider)
  })

  const modelLabel = (id: string): string => providerModelDisplayName(id)

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

  // ─── MCP whitelist ──────────────────────────────────────────────────────────
  // Same semantics as the per-session config (SessionConfigPopover): undefined =
  // all enabled servers, explicit array = whitelist (the first toggle materialises
  // the full enabled set so a tick reads as include and an untick as exclude).
  const mcpEnabledServers = computed(() => connections.mcpServers.filter((s) => s.enabled))
  const isMcpCustomized = computed(() => draft.value.mcpServerIds !== undefined)
  const isMcpActive = (id: string): boolean => {
    const list = draft.value.mcpServerIds
    return list === undefined ? true : list.includes(id)
  }
  const toggleMcp = (id: string) => {
    const current = draft.value.mcpServerIds ?? mcpEnabledServers.value.map((s) => s.id)
    const set = new Set(current)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    draft.value.mcpServerIds = [...set]
  }
  const resetMcp = () => {
    draft.value.mcpServerIds = undefined
  }

  // True while save/reset writes the project JSON. `updateProject` has no
  // re-entry guard, so this blocks a double-click from firing two concurrent
  // writes and also lets the modal disable its buttons.
  const saving = ref(false)

  // Persist the draft as the project's llmDefaults. Returns the saved project.
  const save = async () => {
    const p = project.value
    if (!p || saving.value) return undefined
    saving.value = true
    try {
      const llmDefaults: ProjectLlmDefaults = {
        provider: draft.value.provider,
        modelId: draft.value.modelId,
        level: draft.value.level,
      }
      if (draft.value.accountId) llmDefaults.accountId = draft.value.accountId
      if (draft.value.mcpServerIds !== undefined)
        llmDefaults.mcpServerIds = [...draft.value.mcpServerIds]
      return await store.updateProject({ ...p, llmDefaults })
    } finally {
      saving.value = false
    }
  }

  // Clear the per-project override (new sessions inherit the global defaults).
  const resetToAppDefault = async () => {
    const p = project.value
    if (!p || saving.value) return undefined
    saving.value = true
    try {
      const next = { ...p }
      delete next.llmDefaults
      const saved = await store.updateProject(next)
      draft.value = appDefault()
      return saved
    } finally {
      saving.value = false
    }
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
    mcpEnabledServers,
    isMcpCustomized,
    isMcpActive,
    toggleMcp,
    resetMcp,
    setProvider,
    setAccount,
    setModel,
    setLevel,
    saving,
    save,
    resetToAppDefault,
  }
}
