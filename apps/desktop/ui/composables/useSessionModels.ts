import type { Ref } from 'vue'
import type { Session } from '~/types'
import { modelById, modelsForProvider, resolveModelDef, type ModelDef } from '~/utils/models'

// Models a session can switch to, derived from its provider + effective account.
// A custom-endpoint / curated account carries its own model ids (overriding the
// static catalog); otherwise the provider's catalog is used. Mirrors the picker
// logic in SessionChipsPopover so the per-message "retry with model" menu offers
// the same set. Read-only — never mutates the session.
export function useSessionModels(session: Ref<Session>) {
  const settings = useSettingsStore()

  const effectiveAccountModels = computed<string[]>(() => {
    const cfg = settings.providers[session.value.settings.provider]
    if (!cfg) return []
    const id = session.value.settings.accountId ?? cfg.activeAccountId
    return cfg.accounts.find((a) => a.id === id)?.models ?? []
  })

  const availableModels = computed<ModelDef[]>(() => {
    if (effectiveAccountModels.value.length) {
      return effectiveAccountModels.value.map((id) =>
        resolveModelDef(id, session.value.settings.provider),
      )
    }
    return modelsForProvider(session.value.settings.provider)
  })

  const currentModel = computed(() => modelById(session.value.settings.modelId))
  const currentModelLabel = computed(
    () => currentModel.value?.label ?? session.value.settings.modelId,
  )

  return { availableModels, currentModel, currentModelLabel }
}
