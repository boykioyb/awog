<template>
  <PromptCreatorPanel
    :anchor="anchor"
    headline="What workflow do you want to build?"
    subheadline="Describe the steps — we'll set up the skeleton"
    placeholder='What does this workflow do?, e.g., "Triage GitHub issues then assign to reviewer"'
    generated-label="Generated workflow"
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
        class="rounded-xl p-3"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <div class="flex items-center gap-2 mb-1.5">
          <Workflow :size="12" :style="{ color: t.textDim }" />
          <span class="text-[0.86em] font-medium" :style="{ color: t.text }">{{ draft.name }}</span>
        </div>
        <div class="text-[0.86em]" :style="{ color: t.textMuted }">
          {{ draft.description }}
        </div>
        <div class="text-[0.71em] mt-2" :style="{ color: t.textFaint }">
          Drag agents onto the canvas after creating.
        </div>
      </div>
    </template>

    <template #actions>
      <button
        class="text-[0.79em] inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium"
        :style="{ background: t.accent, color: t.accentText }"
        @click="draft && emit('save', { ...draft })"
      >
        <Save :size="11" />
        Create workflow
      </button>
    </template>
  </PromptCreatorPanel>
</template>

<script setup lang="ts">
import { Save, Workflow } from 'lucide-vue-next'
import type { WorkflowDraft } from '~/composables/useWorkflowGenerator'

defineProps<{
  anchor?: { top: number; left: number } | null
}>()

const emit = defineEmits<{
  save: [draft: WorkflowDraft]
  cancel: []
}>()

const { t } = useTheme()
const { draft, isGenerating, error, onSubmit, onRegenerate } =
  usePromptCreator<WorkflowDraft>(useWorkflowGenerator())
</script>
