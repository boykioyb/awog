<template>
  <form class="cpf" @submit.prevent="onSubmit">
    <div class="cpfgrid">
      <label class="cpffield">
        <span class="fd">{{ t('settingsModels.form.label') }}</span>
        <Input
          v-model="draft.label"
          :placeholder="t('settingsModels.custom.labelPlaceholder')"
          required
          class="flex-1"
        />
      </label>
      <label class="cpffield">
        <span class="fd">{{ t('settingsModels.custom.apiType') }}</span>
        <AppSelect v-model="apiSel" :options="apiTypeOpts" width="100%" />
      </label>
    </div>

    <label class="cpffield">
      <span class="fd">
        {{
          isOpenAi
            ? t('settingsModels.custom.baseUrlOpenai')
            : t('settingsModels.custom.baseUrlAnthropic')
        }}
      </span>
      <Input
        v-model="draft.baseUrl"
        :placeholder="baseUrlPlaceholder"
        required
        class="mono flex-1"
      />
    </label>

    <label class="cpffield">
      <span class="fd">{{ t('settingsModels.custom.apiKeyLabel') }}</span>
      <div class="keyrow">
        <Input
          v-model="draft.apiKey"
          :type="reveal ? 'text' : 'password'"
          :placeholder="editing ? t('settingsModels.edit.keyReplacePlaceholder') : 'sk-…'"
          class="mono flex-1"
        />
        <span
          class="keyeye"
          :title="reveal ? t('settingsModels.form.hide') : t('settingsModels.form.show')"
          @click="reveal = !reveal"
        >
          👁
        </span>
      </div>
      <!-- The stored key never leaves the sidecar (security invariant #1) — we can
           only tell the user that a key is saved, not show it. -->
      <p v-if="editing" class="fd cpfnote">
        {{
          hasKey ? t('settingsModels.edit.keySavedReplace') : t('settingsModels.edit.keyBlankKeep')
        }}
      </p>
    </label>

    <div class="cpffield">
      <span class="fd">{{ t('settingsModels.custom.modelIds') }}</span>
      <ModelListEditor v-model="draft.models" placeholder="openrouter/auto" />
    </div>

    <div class="cpfactions">
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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
const reveal = ref(false)

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

<style scoped>
.cpf {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cpfgrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 560px) {
  .cpfgrid {
    grid-template-columns: 1fr;
  }
}
.cpffield {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cpffield > .keyinp {
  width: 100%;
}
.cpfnote {
  margin: 0;
}
.cpfactions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 2px;
}
</style>
