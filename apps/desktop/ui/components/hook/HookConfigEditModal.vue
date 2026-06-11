<template>
  <PromptCreatorPanel
    :anchor="anchor"
    :headline="`Edit hook: ${hook.name || hook.event}`"
    :subheadline="tr('hooks.llm.config_subheadline')"
    :placeholder="tr('hooks.llm.config_placeholder')"
    :generated-label="tr('hooks.llm.proposed')"
    :has-draft="!!draft"
    :is-generating="isGenerating"
    :error="error"
    @submit="onSubmit"
    @cancel="emit('cancel')"
    @regenerate="onRegenerate"
  >
    <template #preview>
      <div
        v-if="draft"
        class="rounded-xl p-3 space-y-1.5"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <div class="flex items-center gap-2 flex-wrap text-[1em]">
          <span class="font-mono" :style="{ color: t.accent }">{{ draft.event }}</span>
          <span class="uppercase" :style="{ color: t.textDim }">{{ draft.runMode }}</span>
        </div>
        <pre
          class="text-[1em] font-mono whitespace-pre-wrap leading-relaxed m-0"
          :style="{ color: t.textMuted }"
          >{{ draft.command }}</pre
        >
        <div
          v-if="Object.keys(draft.matcher).length"
          class="text-[1em]"
          :style="{ color: t.textDim }"
        >
          matcher: {{ JSON.stringify(draft.matcher) }}
        </div>
      </div>
    </template>

    <template #actions>
      <button
        class="text-[1em] inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium"
        :style="{
          background: draft ? t.accent : t.bgInput,
          color: draft ? t.accentText : t.textDim,
          cursor: draft ? 'pointer' : 'not-allowed',
        }"
        :disabled="!draft"
        @click="onApply"
      >
        <Check :size="11" />
        {{ tr('hooks.llm.apply') }}
      </button>
    </template>
  </PromptCreatorPanel>
</template>

<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import type { Hook } from '~/types'
import type { HookDraft } from '~/composables/useHookGenerator'

const props = defineProps<{ hook: Hook; anchor?: { top: number; left: number } | null }>()
const emit = defineEmits<{ apply: [draft: HookDraft]; cancel: [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()
const generator = useHookGenerator()

const draft = ref<HookDraft | null>(null)
const isGenerating = computed(() => generator.isGenerating.value)
const error = computed(() => generator.error.value)

const onSubmit = async (prompt: string) => {
  const result = await generator.edit(prompt, props.hook)
  if (result) draft.value = result
}
const onRegenerate = () => {
  draft.value = null
}
const onApply = () => {
  if (draft.value) emit('apply', draft.value)
}
</script>
