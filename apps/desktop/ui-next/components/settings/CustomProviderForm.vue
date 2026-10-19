<template>
  <form class="flex flex-col gap-3" @submit.prevent="onSubmit">
    <div class="grid grid-cols-2 gap-3">
      <label class="flex flex-col gap-1.5">
        <span class="text-sm text-dim">{{ t('settingsModels.form.label') }}</span>
        <Input
          v-model="draft.label"
          :placeholder="t('settingsModels.custom.labelPlaceholder')"
          required
          class="flex-1"
        />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-sm text-dim">{{ t('settingsModels.custom.apiType') }}</span>
        <AppSelect v-model="apiSel" :options="apiTypeOpts" width="100%" />
      </label>
    </div>

    <label class="flex flex-col gap-1.5">
      <span class="text-sm text-dim">
        {{
          isOpenAi
            ? t('settingsModels.custom.baseUrlOpenai')
            : t('settingsModels.custom.baseUrlAnthropic')
        }}
      </span>
      <!-- mono-ok: base URL -->
      <Input
        v-model="draft.baseUrl"
        :placeholder="baseUrlPlaceholder"
        required
        class="flex-1 font-mono"
      />
    </label>

    <div class="flex flex-col gap-1.5">
      <span class="text-sm text-dim">{{ t('settingsModels.custom.apiKeyLabel') }}</span>
      <SettingsKeyRow
        v-model="draft.apiKey"
        :placeholder="editing ? t('settingsModels.edit.keyReplacePlaceholder') : 'sk-…'"
        mono
      />
      <!-- The stored key never leaves the sidecar (security invariant #1) — we can
           only tell the user that a key is saved, not show it. -->
      <p v-if="editing" class="m-0 text-sm text-dim">
        {{
          hasKey ? t('settingsModels.edit.keySavedReplace') : t('settingsModels.edit.keyBlankKeep')
        }}
      </p>
    </div>

    <div class="flex flex-col gap-1.5">
      <span class="text-sm text-dim">{{ t('settingsModels.custom.modelIds') }}</span>
      <ModelListEditor v-model="draft.models" placeholder="openrouter/auto" />
    </div>

    <div class="flex items-center justify-end gap-2 pt-0.5">
      <Button type="button" variant="outline" size="sm" @click="emit('cancel')">
        {{ t('settingsModels.form.cancel') }}
      </Button>
      <Button type="submit" :disabled="!canSubmit" variant="default" size="sm">
        {{ submitLabel }}
      </Button>
    </div>
  </form>
</template>

<script setup lang="ts">
import ModelListEditor from '~/components/settings/ModelListEditor.vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import type { EndpointApi } from '~/stores/settings'

// Custom endpoint draft — local to the Models subtree (ui-next store does not
// export a CustomProviderInput type). Mirrors the legacy shape.
export type CustomProviderInput = {
  label: string
  baseUrl: string
  apiKey: string
  api: EndpointApi
  models: string[]
}

// `editing` only changes the API-key affordance: on edit, a blank key keeps the
// current one, so the field is optional and hints as much. `hasKey` lets the form
// say a key is already saved (the key itself never reaches the UI).
withDefaults(
  defineProps<{
    submitLabel: string
    editing?: boolean
    hasKey?: boolean
  }>(),
  { editing: false, hasKey: false },
)

const draft = defineModel<CustomProviderInput>({ required: true })

const emit = defineEmits<{
  submit: []
  cancel: []
}>()

const { t } = useI18n()

// AppSelect's v-model is a plain string — bridge to the EndpointApi union.
const apiSel = computed<string>({
  get: () => draft.value.api,
  set: (v) => {
    draft.value = { ...draft.value, api: v as EndpointApi }
  },
})
const apiTypeOpts = computed<AppSelectOption[]>(() => [
  { value: 'anthropic-messages', label: t('settingsModels.custom.apiAnthropic') },
  { value: 'openai-completions', label: t('settingsModels.custom.apiOpenai') },
])

const isOpenAi = computed(() => draft.value.api === 'openai-completions')
const baseUrlPlaceholder = computed(() =>
  isOpenAi.value ? 'http://localhost:11434/v1' : 'https://api.stepfun.ai/step_plan',
)

const canSubmit = computed(
  () => draft.value.label.trim().length > 0 && draft.value.baseUrl.trim().length > 0,
)

const onSubmit = () => {
  if (canSubmit.value) emit('submit')
}
</script>
