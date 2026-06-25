<template>
  <PromptCreatorPanel
    :anchor="anchor"
    :headline="`Edit /${skill.id}`"
    subheadline="Describe what should change — slug + storage location stay the same"
    placeholder='e.g. "Make this shorter" or "Add a section about edge cases"'
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
          <span class="text-[1em] font-mono" :style="{ color: t.text }">{{ draft.name }}</span>
          <span
            v-if="draft.id"
            class="text-[1em] px-2 py-0.5 rounded-full font-mono"
            :style="{
              background: t.bgPanel,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
          >
            /{{ draft.id }}
          </span>
        </div>
        <div class="text-[1em]" :style="{ color: t.textMuted }">
          {{ draft.description }}
        </div>
        <div
          class="rounded-lg p-2.5 max-h-[40vh] overflow-y-auto text-[1em] leading-relaxed"
          :style="{
            background: t.bgPanel,
            border: `1px solid ${t.border}`,
            color: t.textMuted,
          }"
        >
          <MarkdownRenderer :content="draft.body || '(empty body)'" />
        </div>
      </div>
    </template>

    <template #actions>
      <button
        class="text-[1em] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium"
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
import type { Skill } from '~/types'
import type { SkillDraft } from '~/composables/useSkillGenerator'

const props = defineProps<{
  skill: Skill
  anchor?: { top: number; left: number } | null
}>()

const emit = defineEmits<{
  apply: [skill: Skill]
  cancel: []
}>()

const { t } = useTheme()
const generator = useSkillGenerator()

const draft = ref<SkillDraft | null>(null)
const isGenerating = computed(() => generator.isGenerating.value)
const error = computed(() => generator.error.value)

const canApply = computed(() => !!(draft.value?.id && draft.value.name && draft.value.description))

const onSubmit = async (prompt: string) => {
  const result = await generator.edit(prompt, props.skill)
  if (result) draft.value = result
}

const onRegenerate = () => {
  draft.value = null
}

const onApply = () => {
  const d = draft.value
  if (!d || !d.id) return
  // Preserve storage metadata; only content fields come from the LLM.
  const updated: Skill = {
    id: d.id,
    source: props.skill.source,
    name: d.name,
    description: d.description,
    body: d.body,
  }
  if (props.skill.projectId) updated.projectId = props.skill.projectId
  if (d.icon) updated.icon = d.icon
  if (d.globs && d.globs.length > 0) updated.globs = [...d.globs]
  if (d.alwaysAllow && d.alwaysAllow.length > 0) updated.alwaysAllow = [...d.alwaysAllow]
  if (d.requiredSources && d.requiredSources.length > 0) {
    updated.requiredSources = [...d.requiredSources]
  }
  emit('apply', updated)
}
</script>
