<template>
  <PromptCreatorPanel
    :anchor="anchor"
    :headline="`Edit script: ${path}`"
    :subheadline="tr('hooks.llm.script_subheadline')"
    :placeholder="tr('hooks.llm.script_placeholder')"
    :generated-label="tr('hooks.llm.proposed')"
    :has-draft="contentDraft !== null"
    :is-generating="isGenerating"
    :error="error"
    @submit="onSubmit"
    @cancel="emit('cancel')"
    @regenerate="onRegenerate"
  >
    <template #preview>
      <pre
        v-if="contentDraft !== null"
        class="rounded-xl p-3 max-h-[40vh] overflow-y-auto text-[1em] font-mono whitespace-pre-wrap leading-relaxed m-0"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}`, color: t.textMuted }"
        >{{ contentDraft || '(empty)' }}</pre
      >
    </template>

    <template #actions>
      <button
        class="text-[1em] inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium"
        :style="{
          background: contentDraft !== null ? t.accent : t.bgInput,
          color: contentDraft !== null ? t.accentText : t.textDim,
          cursor: contentDraft !== null ? 'pointer' : 'not-allowed',
        }"
        :disabled="contentDraft === null"
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

const props = defineProps<{
  path: string
  command: string
  currentContent: string
  anchor?: { top: number; left: number } | null
}>()
const emit = defineEmits<{ apply: [content: string]; cancel: [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()
const generator = useHookScriptGenerator()

const contentDraft = ref<string | null>(null)
const isGenerating = computed(() => generator.isGenerating.value)
const error = computed(() => generator.error.value)

const onSubmit = async (prompt: string) => {
  const result = await generator.generate(prompt, {
    command: props.command,
    currentScript: props.currentContent,
  })
  if (result !== null) contentDraft.value = result
}
const onRegenerate = () => {
  contentDraft.value = null
}
const onApply = () => {
  if (contentDraft.value !== null) emit('apply', contentDraft.value)
}
</script>
