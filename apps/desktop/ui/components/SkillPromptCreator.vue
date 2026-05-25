<template>
  <PromptCreatorPanel
    :anchor="anchor"
    headline="What would you like to change?"
    subheadline="Just describe it — I'll handle the rest"
    placeholder='What should I learn to do?, e.g., "Review PRs following our code standards"'
    generated-label="Generated skill"
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
          <span class="text-[12px] font-mono" :style="{ color: t.text }">{{ draft.name }}</span>
          <span
            class="text-[10px] px-1.5 py-0.5 rounded"
            :style="{
              background: t.bgPanel,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ draft.category }}
          </span>
        </div>
        <div class="text-[12px] mb-2" :style="{ color: t.textMuted }">
          {{ draft.description }}
        </div>
        <div v-if="draft.tags.length" class="flex flex-wrap gap-1">
          <span
            v-for="tag in draft.tags"
            :key="tag"
            class="text-[10px] px-1.5 py-0.5 rounded"
            :style="{
              background: t.bgPanel,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
          >
            #{{ tag }}
          </span>
        </div>
      </div>
    </template>

    <template #actions>
      <button
        class="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded"
        :style="{ color: t.textMuted }"
        @click="onEditDetails"
      >
        <Sliders :size="11" />
        Edit details
      </button>
      <button
        class="text-[11px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium"
        :style="{ background: t.accent, color: t.accentText }"
        @click="onSave"
      >
        <Save :size="11" />
        Save skill
      </button>
    </template>
  </PromptCreatorPanel>
</template>

<script setup lang="ts">
import { Save, Sliders } from 'lucide-vue-next'
import type { Skill } from '~/types'
import type { SkillDraft } from '~/composables/useSkillGenerator'

defineProps<{
  anchor?: { top: number; left: number } | null
}>()

const emit = defineEmits<{
  save: [skill: Skill]
  'edit-manually': [draft: SkillDraft]
  cancel: []
}>()

const { t } = useTheme()
const { generate, isGenerating, error } = useSkillGenerator()

const draft = ref<SkillDraft | null>(null)

const onSubmit = async (prompt: string) => {
  const result = await generate(prompt)
  if (result) draft.value = result
}

const onRegenerate = () => {
  draft.value = null
}

const onSave = () => {
  if (!draft.value) return
  emit('save', { ...(draft.value as Skill) })
}

const onEditDetails = () => {
  if (!draft.value) return
  emit('edit-manually', draft.value)
}
</script>
