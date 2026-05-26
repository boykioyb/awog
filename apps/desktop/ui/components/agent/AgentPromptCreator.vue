<template>
  <PromptCreatorPanel
    :anchor="anchor"
    headline="What kind of agent do you need?"
    subheadline="Describe the agent's job — we'll generate the rest"
    placeholder='What should this agent do?, e.g., "Senior reviewer focused on security and performance"'
    generated-label="Generated agent"
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
          <span class="text-[12px] font-medium" :style="{ color: t.text }">{{ draft.name }}</span>
          <span
            class="text-[10px] px-1.5 py-0.5 rounded"
            :style="{
              background: t.bgPanel,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ draft.role }}
          </span>
        </div>
        <div class="text-[11px] mb-2" :style="{ color: t.textDim }">
          {{ modelLabel }}
        </div>
        <div
          class="text-[11px] font-mono whitespace-pre-wrap rounded p-2 max-h-24 overflow-y-auto"
          :style="{ background: t.bgPanel, color: t.textMuted, border: `1px solid ${t.border}` }"
        >
          {{ draft.systemPrompt }}
        </div>
      </div>
    </template>

    <template #actions>
      <button
        class="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded"
        :style="{ color: t.textMuted }"
        @click="draft && emit('edit-manually', draft)"
      >
        <Sliders :size="11" />
        Edit details
      </button>
      <button
        class="text-[11px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium"
        :style="{ background: t.accent, color: t.accentText }"
        @click="draft && emit('save', { ...(draft as Agent) })"
      >
        <Save :size="11" />
        Save agent
      </button>
    </template>
  </PromptCreatorPanel>
</template>

<script setup lang="ts">
import { Save, Sliders } from 'lucide-vue-next'
import type { Agent } from '~/types'
import type { AgentDraft } from '~/composables/useAgentGenerator'
import { MODELS } from '~/utils/models'

defineProps<{
  anchor?: { top: number; left: number } | null
}>()

const emit = defineEmits<{
  save: [agent: Agent]
  'edit-manually': [draft: AgentDraft]
  cancel: []
}>()

const { t } = useTheme()
const { draft, isGenerating, error, onSubmit, onRegenerate } =
  usePromptCreator<AgentDraft>(useAgentGenerator())

const modelLabel = computed(
  () => MODELS.find((m) => m.id === draft.value?.model)?.label ?? draft.value?.model ?? '',
)
</script>
