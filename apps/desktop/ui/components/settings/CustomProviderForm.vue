<template>
  <form class="space-y-3" @submit.prevent="onSubmit">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <label class="block">
        <span class="text-[1em]" :style="{ color: t.textDim }">Label</span>
        <input
          v-model="draft.label"
          class="mt-1 w-full rounded px-2 py-1.5 text-[1em]"
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
        class="mt-1 w-full rounded px-2 py-1.5 text-[1em] font-mono"
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
          class="flex-1 rounded px-2 py-1.5 text-[1em] font-mono"
          :style="inputStyle"
          :placeholder="editing ? 'Leave blank to keep current key' : 'sk-…'"
        />
        <button
          type="button"
          class="px-2 py-1.5 rounded text-[1em] flex items-center"
          :style="iconBtnStyle"
          :title="reveal ? 'Hide' : 'Show'"
          @click="reveal = !reveal"
        >
          <component :is="reveal ? EyeOff : Eye" :size="13" />
        </button>
      </div>
    </label>

    <label class="block">
      <span class="text-[1em]" :style="{ color: t.textDim }">
        Model IDs — one per line or comma-separated
      </span>
      <textarea
        v-model="modelsText"
        rows="3"
        class="mt-1 w-full rounded px-2 py-1.5 text-[1em] font-mono resize-y min-h-[4.5rem]"
        :style="inputStyle"
        placeholder="openrouter/auto&#10;anthropic/claude-sonnet-4.5&#10;openai/gpt-5"
      />
    </label>

    <div class="flex items-center justify-end gap-2 pt-1">
      <button
        type="button"
        class="px-3 py-1.5 text-[1em] rounded transition"
        :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
        @click="emit('cancel')"
      >
        Cancel
      </button>
      <button
        type="submit"
        class="px-3 py-1.5 text-[1em] rounded transition"
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
// optional and hints as much.
withDefaults(
  defineProps<{
    submitLabel: string
    editing?: boolean
  }>(),
  { editing: false },
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

// Raw text is the textarea's own source of truth. Binding :value to a computed
// re-joined from the parsed array fights the cursor: each keystroke would split→
// trim→filter→rejoin, so a trailing newline vanishes (can't go to a new line)
// and spaces get eaten mid-typing. Keep the text local; parse into draft.models
// reactively. Seeded once from the model — the form unmounts on close/submit so
// it re-seeds fresh next open (no back-sync watcher needed).
const modelsText = ref(draft.value.models.join('\n'))

watch(modelsText, (raw) => {
  draft.value = {
    ...draft.value,
    models: raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean),
  }
})

const canSubmit = computed(
  () => draft.value.label.trim().length > 0 && draft.value.baseUrl.trim().length > 0,
)

const onSubmit = () => {
  if (canSubmit.value) emit('submit')
}
</script>
