<template>
  <form class="space-y-3" @submit.prevent="onSubmit">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <label class="block">
        <span class="text-[0.79em]" :style="{ color: t.textDim }">Label</span>
        <input
          v-model="draft.label"
          class="mt-1 w-full rounded px-2 py-1.5 text-[0.86em]"
          :style="inputStyle"
          placeholder="OpenRouter"
          required
        />
      </label>
      <label class="block">
        <span class="text-[0.79em]" :style="{ color: t.textDim }">Base URL</span>
        <input
          v-model="draft.baseUrl"
          class="mt-1 w-full rounded px-2 py-1.5 text-[0.86em] font-mono"
          :style="inputStyle"
          placeholder="https://openrouter.ai/api/v1"
          required
        />
      </label>
    </div>

    <label class="block">
      <span class="text-[0.79em]" :style="{ color: t.textDim }">API key (optional for local)</span>
      <div class="mt-1 flex items-center gap-2">
        <input
          v-model="draft.apiKey"
          :type="reveal ? 'text' : 'password'"
          class="flex-1 rounded px-2 py-1.5 text-[0.86em] font-mono"
          :style="inputStyle"
          placeholder="sk-…"
        />
        <button
          type="button"
          class="px-2 py-1.5 rounded text-[0.79em] flex items-center"
          :style="iconBtnStyle"
          :title="reveal ? 'Hide' : 'Show'"
          @click="reveal = !reveal"
        >
          <component :is="reveal ? EyeOff : Eye" :size="13" />
        </button>
      </div>
    </label>

    <label class="block">
      <span class="text-[0.79em]" :style="{ color: t.textDim }">
        Model IDs — one per line or comma-separated
      </span>
      <textarea
        :value="modelsText"
        rows="3"
        class="mt-1 w-full rounded px-2 py-1.5 text-[0.86em] font-mono"
        :style="inputStyle"
        placeholder="openrouter/auto&#10;anthropic/claude-sonnet-4.5&#10;openai/gpt-5"
        @input="onModelsInput(($event.target as HTMLTextAreaElement).value)"
      />
    </label>

    <div class="flex items-center justify-end gap-2 pt-1">
      <button
        type="button"
        class="px-3 py-1.5 text-[0.79em] rounded transition"
        :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
        @click="emit('cancel')"
      >
        Cancel
      </button>
      <button
        type="submit"
        class="px-3 py-1.5 text-[0.79em] rounded transition"
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

defineProps<{
  submitLabel: string
}>()

const draft = defineModel<CustomProviderInput>({ required: true })

const emit = defineEmits<{
  submit: []
  cancel: []
}>()

const { t } = useTheme()
const reveal = ref(false)

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

const modelsText = computed(() => draft.value.models.join('\n'))

const onModelsInput = (raw: string) => {
  draft.value = {
    ...draft.value,
    models: raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean),
  }
}

const canSubmit = computed(
  () => draft.value.label.trim().length > 0 && draft.value.baseUrl.trim().length > 0,
)

const onSubmit = () => {
  if (canSubmit.value) emit('submit')
}
</script>
