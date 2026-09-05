<template>
  <form class="cpf" @submit.prevent="onSubmit">
    <div class="cpfgrid">
      <label class="cpffield">
        <span class="fd">{{ t('settingsModels.form.label') }}</span>
        <input
          v-model="draft.label"
          class="keyinp"
          :placeholder="t('settingsModels.custom.labelPlaceholder')"
          required
        />
      </label>
      <label class="cpffield">
        <span class="fd">{{ t('settingsModels.custom.apiType') }}</span>
        <select v-model="draft.api" class="cpfsel">
          <option value="anthropic-messages">{{ t('settingsModels.custom.apiAnthropic') }}</option>
          <option value="openai-completions">{{ t('settingsModels.custom.apiOpenai') }}</option>
        </select>
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
      <input
        v-model="draft.baseUrl"
        class="keyinp mono"
        :placeholder="baseUrlPlaceholder"
        required
      />
    </label>

    <label class="cpffield">
      <span class="fd">{{ t('settingsModels.custom.apiKeyLabel') }}</span>
      <div class="keyrow">
        <input
          v-model="draft.apiKey"
          class="keyinp mono"
          :type="reveal ? 'text' : 'password'"
          :placeholder="editing ? t('settingsModels.edit.keyReplacePlaceholder') : 'sk-…'"
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
      <button class="btn sm" type="button" @click="emit('cancel')">
        {{ t('settingsModels.form.cancel') }}
      </button>
      <button class="btn sm pri" type="submit" :disabled="!canSubmit">
        {{ submitLabel }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import ModelListEditor from '~/components/settings/ModelListEditor.vue'
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
const reveal = ref(false)

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
.cpfsel {
  border: 1px solid var(--border);
  background: var(--bgInput);
  border-radius: var(--r-sm);
  padding: 7px 10px;
  font-size: var(--fs-sm);
  color: var(--text);
  outline: none;
  font-family: var(--sans);
  cursor: pointer;
}
.cpfsel:focus {
  border-color: var(--borderFocus);
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
