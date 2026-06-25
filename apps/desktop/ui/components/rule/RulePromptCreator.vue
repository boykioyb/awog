<template>
  <PromptCreatorPanel
    :anchor="anchor"
    :headline="tr('rules.creator.headline')"
    :subheadline="tr('rules.creator.subheadline')"
    :placeholder="tr('rules.creator.placeholder')"
    :generated-label="tr('rules.creator.generated')"
    :has-draft="!!draft"
    :is-generating="isGenerating"
    :error="error"
    @submit="onSubmit"
    @cancel="emit('cancel')"
    @regenerate="onRegenerate"
  >
    <template #controls>
      <CreatorScopePicker v-model="scope" :projects="projects" />
    </template>

    <template #preview>
      <div
        v-if="draft"
        class="rounded-xl p-3 space-y-2"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <div class="text-[1em] font-medium" :style="{ color: t.text }">{{ draft.name }}</div>
        <div class="text-[1em]" :style="{ color: t.textMuted }">{{ draft.description }}</div>
        <div
          class="rounded p-2 max-h-[40vh] overflow-y-auto text-[1em] leading-relaxed"
          :style="{ background: t.bgPanel, border: `1px solid ${t.border}`, color: t.textMuted }"
        >
          <MarkdownRenderer :content="draft.body || '(empty body)'" />
        </div>
      </div>
    </template>

    <template #actions>
      <button
        class="text-[1em] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
        :style="{ color: t.textMuted }"
        @click="draft && emit('edit-manually', draft)"
      >
        <Sliders :size="11" />
        {{ tr('rules.creator.edit_details') }}
      </button>
      <button
        class="text-[1em] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium"
        :style="{ background: t.accent, color: t.accentText }"
        @click="draft && emit('save', draft, scope)"
      >
        <Save :size="11" />
        {{ tr('rules.creator.save') }}
      </button>
    </template>
  </PromptCreatorPanel>
</template>

<script setup lang="ts">
import { Save, Sliders } from 'lucide-vue-next'
import type { RuleDraft } from '~/composables/useRuleGenerator'

withDefaults(
  defineProps<{
    anchor?: { top: number; left: number } | null
    projects?: { id: string; name: string }[]
  }>(),
  { anchor: null, projects: () => [] },
)

const emit = defineEmits<{
  // scope: 'global' or a projectId — where the rule is persisted.
  save: [draft: RuleDraft, scope: string]
  'edit-manually': [draft: RuleDraft]
  cancel: []
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const scope = ref('global')
const { draft, isGenerating, error, onSubmit, onRegenerate } =
  usePromptCreator<RuleDraft>(useRuleGenerator())
</script>
