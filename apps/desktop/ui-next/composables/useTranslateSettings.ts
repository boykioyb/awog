import { computed } from 'vue'
import { useSettingsStore } from '~/stores/settings'
import { LLM_PROVIDERS, useLlmPicker } from '~/composables/useLlmPicker'
import type { ProviderName } from '~/types'

// Controller for the "Translation model" settings section (SettingsDefaults).
// Wired to the store's `translate` slice; the provider→account→model reconciliation
// lives in useLlmPicker (shared with the Slack translation settings). All writes go
// through settings.updateTranslate so the slice stays mutated in one place.

export function useTranslateSettings() {
  const settings = useSettingsStore()

  const followAppDefault = computed<boolean>({
    get: () => settings.translate.followAppDefault,
    set: (v) => settings.updateTranslate({ followAppDefault: v }),
  })

  const picker = useLlmPicker({
    get: () => settings.translate,
    update: (patch) => settings.updateTranslate(patch),
  })

  const isProviderConnected = (p: ProviderName) => settings.isProviderConnected(p)

  return {
    PROVIDERS: LLM_PROVIDERS,
    followAppDefault,
    ...picker,
    isProviderConnected,
  }
}
