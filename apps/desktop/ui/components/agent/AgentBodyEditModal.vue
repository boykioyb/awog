<!--
  Edit-by-prompt modal for an agent's systemPrompt. Mirror of
  SkillBodyEditModal: user types a revision instruction, sidecar's
  `agents.generate` returns the updated agent draft, user reviews preview and
  clicks Apply to persist. Source + projectId are preserved on the parent side.
-->
<template>
  <PromptCreatorPanel
    :anchor="anchor"
    :headline="`Edit ${agent.id}.md`"
    subheadline="Describe what should change — slug + storage location stay the same"
    placeholder='e.g. "Make this more concise" or "Add a section about edge cases"'
    generated-label="Proposed change"
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
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[0.86em] font-medium" :style="{ color: t.text }">{{ draft.name }}</span>
          <span
            v-if="draft.role"
            class="text-[0.71em] px-1.5 py-0.5 rounded uppercase tracking-wider"
            :style="{
              background: t.bgPanel,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ draft.role }}
          </span>
          <span
            v-if="draft.id"
            class="text-[0.71em] px-1.5 py-0.5 rounded font-mono"
            :style="{
              background: t.bgPanel,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
          >
            /{{ draft.id }}
          </span>
        </div>
        <div class="text-[0.79em]" :style="{ color: t.textMuted }">
          {{ draft.description }}
        </div>
        <div
          class="rounded p-2 max-h-[40vh] overflow-y-auto text-[0.86em] leading-relaxed"
          :style="{
            background: t.bgPanel,
            border: `1px solid ${t.border}`,
            color: t.textMuted,
          }"
        >
          <MarkdownRenderer :content="draft.systemPrompt || '(empty system prompt)'" />
        </div>
      </div>
    </template>

    <template #actions>
      <button
        class="text-[0.79em] inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium"
        :style="{
          background: canApply ? t.accent : t.bgInput,
          color: canApply ? t.accentText : t.textDim,
          cursor: canApply ? 'pointer' : 'not-allowed',
        }"
        :disabled="!canApply"
        @click="onApply"
      >
        <Check :size="11" />
        Apply change
      </button>
    </template>
  </PromptCreatorPanel>
</template>

<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import type { Agent } from '~/types'
import type { AgentDraft } from '~/composables/useAgentGenerator'

const props = defineProps<{
  agent: Agent
  anchor?: { top: number; left: number } | null
}>()

const emit = defineEmits<{
  apply: [agent: Agent]
  cancel: []
}>()

const { t } = useTheme()
const generator = useAgentGenerator()

const draft = ref<AgentDraft | null>(null)
const isGenerating = computed(() => generator.isGenerating.value)
const error = computed(() => generator.error.value)

const canApply = computed(() => !!(draft.value?.id && draft.value.name && draft.value.description))

const onSubmit = async (prompt: string) => {
  const result = await generator.edit(prompt, props.agent)
  if (result) draft.value = result
}

const onRegenerate = () => {
  draft.value = null
}

const onApply = () => {
  const d = draft.value
  if (!d || !d.id) return
  // Preserve storage metadata (source/projectId) + per-agent restrictions
  // (tools, mcpServerIds) since the body-edit prompt focuses on persona/copy.
  // Content fields come from the LLM draft.
  const updated: Agent = {
    id: d.id,
    source: props.agent.source,
    name: d.name,
    description: d.description,
    model: d.model,
    systemPrompt: d.systemPrompt,
    role: d.role,
    skillIds: d.skillIds,
  }
  if (props.agent.projectId) updated.projectId = props.agent.projectId
  if (props.agent.tools && props.agent.tools.length > 0) updated.tools = [...props.agent.tools]
  if (props.agent.mcpServerIds && props.agent.mcpServerIds.length > 0) {
    updated.mcpServerIds = [...props.agent.mcpServerIds]
  }
  emit('apply', updated)
}
</script>
