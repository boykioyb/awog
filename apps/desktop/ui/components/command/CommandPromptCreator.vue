<template>
  <PromptCreatorPanel
    :anchor="anchor"
    :headline="tr('commands.creator.headline')"
    :subheadline="tr('commands.creator.subheadline')"
    :placeholder="tr('commands.creator.placeholder')"
    :generated-label="tr('commands.creator.generated')"
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
        <div class="flex items-center gap-2">
          <span class="text-[1em] font-mono" :style="{ color: t.text }">/{{ draft.name }}</span>
          <span
            v-if="draft.argumentHint"
            class="text-[1em] font-mono"
            :style="{ color: t.textDim }"
          >
            {{ draft.argumentHint }}
          </span>
        </div>
        <div class="text-[1em]" :style="{ color: t.textMuted }">{{ draft.description }}</div>
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
        class="text-[1em] inline-flex items-center gap-1.5 px-2.5 py-1 rounded"
        :style="{ color: t.textMuted }"
        @click="draft && emit('edit-manually', draft)"
      >
        <Sliders :size="11" />
        {{ tr('commands.creator.edit_details') }}
      </button>
      <button
        class="text-[1em] inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium"
        :style="{ background: t.accent, color: t.accentText }"
        @click="draft && emit('save', draft)"
      >
        <Save :size="11" />
        {{ tr('commands.creator.save') }}
      </button>
    </template>
  </PromptCreatorPanel>
</template>

<script setup lang="ts">
import { Save, Sliders } from 'lucide-vue-next'
import type { CommandDraft } from '~/composables/useCommandGenerator'

defineProps<{ anchor?: { top: number; left: number } | null }>()

const emit = defineEmits<{
  save: [draft: CommandDraft]
  'edit-manually': [draft: CommandDraft]
  cancel: []
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const { draft, isGenerating, error, onSubmit, onRegenerate } =
  usePromptCreator<CommandDraft>(useCommandGenerator())
</script>
