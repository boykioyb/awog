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
            v-if="draft.id"
            class="text-[10px] px-1.5 py-0.5 rounded font-mono"
            :style="{
              background: t.bgPanel,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
          >
            /{{ draft.id }}
          </span>
        </div>
        <div class="text-[12px]" :style="{ color: t.textMuted }">
          {{ draft.description }}
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
        :style="{
          background: canSave ? t.accent : t.bgInput,
          color: canSave ? t.accentText : t.textDim,
          cursor: canSave ? 'pointer' : 'not-allowed',
        }"
        :disabled="!canSave"
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
const { draft, isGenerating, error, onSubmit, onRegenerate } =
  usePromptCreator<SkillDraft>(useSkillGenerator())

const canSave = computed(() => !!(draft.value?.id && draft.value.name && draft.value.description))

const onSave = () => {
  const d = draft.value
  if (!d || !d.id) return
  // Prompt-driven creation defaults to the global tier; user can change via
  // SkillEditor (the "Edit details" path) when they want a project-scoped skill.
  const skill: Skill = {
    id: d.id,
    source: 'global',
    name: d.name,
    description: d.description,
    body: d.body,
  }
  if (d.icon) skill.icon = d.icon
  if (d.globs && d.globs.length > 0) skill.globs = [...d.globs]
  if (d.alwaysAllow && d.alwaysAllow.length > 0) skill.alwaysAllow = [...d.alwaysAllow]
  if (d.requiredSources && d.requiredSources.length > 0) {
    skill.requiredSources = [...d.requiredSources]
  }
  emit('save', skill)
}
</script>
