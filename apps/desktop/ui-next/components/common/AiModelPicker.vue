<template>
  <AppSelect v-model="sel" :options="options" :width="width" />
</template>

<script setup lang="ts">
// Picker model dùng chung cho các đường "AI authoring" (draft team/agent/issue,
// author mini-chat…). Bind thẳng vào `settings.aiAuthoring` nên mọi surface chia
// một lựa chọn — '' = "theo model mặc định của phiên".
import { computed } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import { PROVIDER_DISPLAY } from '~/composables/useSessionsData'
import { providerModelsShown } from '~/composables/useProviderModels'
import { useI18n } from '~/composables/useI18n'
import { useSettingsStore, type ProviderName } from '~/stores/settings'

withDefaults(defineProps<{ width?: string }>(), { width: '220px' })

const { t } = useI18n()
const settings = useSettingsStore()

const PROVIDERS: ProviderName[] = ['anthropic', 'openai', 'google']

const sel = computed<string>({
  get: () =>
    settings.aiAuthoring.modelId
      ? `${settings.aiAuthoring.provider || settings.defaults.provider}|${settings.aiAuthoring.modelId}`
      : '',
  set: (v) => {
    if (!v) {
      settings.aiAuthoring.provider = ''
      settings.aiAuthoring.modelId = ''
      return
    }
    const [provider, modelId] = v.split('|')
    settings.aiAuthoring.provider = (provider || 'anthropic') as ProviderName
    settings.aiAuthoring.modelId = modelId ?? ''
  },
})

const options = computed<AppSelectOption[]>(() => {
  const auto: AppSelectOption = {
    value: '',
    label: t('settings.aiAuthoring.auto', {
      model: `${PROVIDER_DISPLAY[settings.defaults.provider]} ${settings.defaults.modelId}`,
    }),
  }
  const opts: AppSelectOption[] = [auto]
  // Chỉ list provider có account — authoring không chạy được trên provider chưa
  // connect, và danh sách gọn hơn hẳn.
  for (const p of PROVIDERS) {
    if (!settings.providers[p]?.accounts?.length) continue
    for (const m of providerModelsShown(p)) {
      opts.push({ value: `${p}|${m.id}`, label: `${PROVIDER_DISPLAY[p]} · ${m.name}` })
    }
  }
  return opts
})
</script>
