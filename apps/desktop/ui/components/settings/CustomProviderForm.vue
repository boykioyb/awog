<template>
  <form class="space-y-3" @submit.prevent="onSubmit">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <label class="block">
        <span class="text-[1em]" :style="{ color: t.textDim }">Label</span>
        <input
          v-model="draft.label"
          class="mt-1 w-full rounded-lg px-2.5 py-2 text-[1em]"
          :style="inputStyle"
          placeholder="OpenRouter"
          required
        />
      </label>
      <label class="block">
        <span class="text-[1em]" :style="{ color: t.textDim }">API type</span>
        <AppSelect v-model="draft.api" class="mt-1">
          <option value="anthropic-messages">Anthropic-compatible</option>
          <option value="openai-completions">OpenAI-compatible</option>
        </AppSelect>
      </label>
    </div>

    <label class="block">
      <span class="text-[1em]" :style="{ color: t.textDim }">
        <template v-if="isOpenAi">
          Base URL — usually ends in
          <span class="font-mono">/v1</span>
          (we append
          <span class="font-mono">/chat/completions</span>
          )
        </template>
        <template v-else>
          Base URL — root only, no
          <span class="font-mono">/v1</span>
          (we append
          <span class="font-mono">/v1/messages</span>
          )
        </template>
      </span>
      <input
        v-model="draft.baseUrl"
        class="mt-1 w-full rounded-lg px-2.5 py-2 text-[1em] font-mono"
        :style="inputStyle"
        :placeholder="baseUrlPlaceholder"
        required
      />
    </label>

    <label class="block">
      <span class="text-[1em]" :style="{ color: t.textDim }">API key</span>
      <div class="mt-1 flex items-center gap-2">
        <input
          v-model="draft.apiKey"
          :type="reveal ? 'text' : 'password'"
          class="flex-1 rounded-lg px-2.5 py-2 text-[1em] font-mono"
          :style="inputStyle"
          :placeholder="editing ? 'Enter a new key to replace' : 'sk-…'"
        />
        <button
          type="button"
          class="px-2 py-2 rounded-lg text-[1em] flex items-center"
          :style="iconBtnStyle"
          :title="reveal ? 'Hide' : 'Show'"
          @click="reveal = !reveal"
        >
          <component :is="reveal ? EyeOff : Eye" :size="13" />
        </button>
      </div>
      <!-- The stored key never leaves the sidecar (security invariant #1) — we
           can only tell the user that a key is saved, not show it. -->
      <p v-if="editing" class="mt-1 text-[1em]" :style="{ color: t.textDim }">
        <template v-if="hasKey">
          An API key is saved — leave blank to keep it, or enter a new key to replace it.
        </template>
        <template v-else>Leave blank to keep the current key.</template>
      </p>
    </label>

    <div class="block">
      <span class="text-[1em]" :style="{ color: t.textDim }">Model IDs</span>
      <div class="mt-1">
        <ModelListEditor
          :model-value="draft.models"
          placeholder="openrouter/auto"
          @update:model-value="(v) => (draft = { ...draft, models: v })"
        />
      </div>
    </div>

    <div class="flex items-center justify-end gap-2 pt-1">
      <button
        type="button"
        class="px-3 py-1.5 text-[1em] rounded-lg transition"
        :style="{ color: t.text, border: `1px solid ${t.borderStrong}`, background: t.bgSubtle }"
        @click="emit('cancel')"
      >
        Cancel
      </button>
      <button
        type="submit"
        class="px-3 py-1.5 text-[1em] rounded-lg transition"
        :style="{ background: t.accent, color: t.accentText, border: 'none' }"
        :disabled="!canSubmit"
      >
        {{ submitLabel }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { Eye, EyeOff } from 'lucide-vue-next'
import type { CustomProviderInput } from '~/stores/settings'

// `editing` only changes the API-key affordance: on edit, a blank key keeps the
// current one (the parent sends `apiKey: trimmed || undefined`), so the field is
// optional and hints as much. `hasKey` lets the form say a key is already saved
// (the key itself never reaches the UI).
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

const { t } = useTheme()
const reveal = ref(false)

const isOpenAi = computed(() => draft.value.api === 'openai-completions')
const baseUrlPlaceholder = computed(() =>
  isOpenAi.value ? 'http://localhost:11434/v1' : 'https://api.stepfun.ai/step_plan',
)

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const iconBtnStyle = computed(() => ({
  color: t.value.text,
  border: `1px solid ${t.value.borderStrong}`,
  background: 'transparent',
}))

const canSubmit = computed(
  () => draft.value.label.trim().length > 0 && draft.value.baseUrl.trim().length > 0,
)

const onSubmit = () => {
  if (canSubmit.value) emit('submit')
}
</script>
