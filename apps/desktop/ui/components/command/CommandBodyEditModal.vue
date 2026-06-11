<template>
  <PromptCreatorPanel
    :anchor="anchor"
    :headline="`${tr('commands.llm.headline')}: ${command.name}`"
    :subheadline="tr('commands.llm.subheadline')"
    :placeholder="tr('commands.llm.placeholder')"
    :generated-label="tr('commands.llm.proposed')"
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
        class="rounded-xl p-3 space-y-2"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <div class="text-[1em] font-mono" :style="{ color: t.text }">/{{ draft.name }}</div>
        <div
          class="rounded p-2 max-h-[40vh] overflow-y-auto text-[1em] leading-relaxed"
          :style="{ background: t.bgPanel, border: `1px solid ${t.border}`, color: t.textMuted }"
        >
          <MarkdownRenderer :content="draft.body || '(empty template)'" />
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
        {{ tr('commands.llm.apply') }}
      </button>
    </template>
  </PromptCreatorPanel>
</template>

<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import type { Command } from '~/types'
import type { CommandDraft } from '~/composables/useCommandGenerator'

const props = defineProps<{ command: Command; anchor?: { top: number; left: number } | null }>()
const emit = defineEmits<{ apply: [command: Command]; cancel: [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()
const generator = useCommandGenerator()

const draft = ref<CommandDraft | null>(null)
const isGenerating = computed(() => generator.isGenerating.value)
const error = computed(() => generator.error.value)

const onSubmit = async (prompt: string) => {
  const result = await generator.edit(prompt, props.command)
  if (result) draft.value = result
}

const onRegenerate = () => {
  draft.value = null
}

const onApply = () => {
  const d = draft.value
  if (!d) return
  // Preserve identity/location; only content fields come from the LLM.
  const updated: Command = {
    ...props.command,
    name: d.name,
    description: d.description,
    argumentHint: d.argumentHint,
    body: d.body,
  }
  emit('apply', updated)
}
</script>
