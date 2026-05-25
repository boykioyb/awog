<template>
  <PromptCreatorPanel
    :anchor="anchor"
    headline="What slash command do you want?"
    subheadline="Mô tả shortcut bạn muốn — mình sẽ chọn type + sinh template"
    placeholder='e.g., "Review artifact gần nhất, focus security"'
    generated-label="Generated command"
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
          <span class="text-[12px] font-mono" :style="{ color: t.text }">/{{ draft.name }}</span>
          <span
            class="text-[10px] px-1.5 py-0.5 rounded"
            :style="{ background: t.bgPanel, color: t.textMuted, border: `1px solid ${t.border}` }"
          >
            {{ draft.type }}
          </span>
          <span
            v-for="arg in draft.args"
            :key="arg.name"
            class="text-[10px] px-1.5 py-0.5 rounded font-mono"
            :style="{ background: t.bgPanel, color: t.textDim, border: `1px solid ${t.border}` }"
          >
            &lt;{{ arg.name }}{{ arg.required ? '' : '?' }}&gt;
          </span>
        </div>
        <div class="text-[12px] mb-2" :style="{ color: t.textMuted }">
          {{ draft.description }}
        </div>
        <div
          class="text-[10px] font-mono p-2 rounded whitespace-pre-wrap"
          :style="{ background: t.bgPanel, color: t.textDim, border: `1px solid ${t.border}` }"
        >
          {{ draft.body }}
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
        Save command
      </button>
    </template>
  </PromptCreatorPanel>
</template>

<script setup lang="ts">
import { Save, Sliders } from 'lucide-vue-next'
import type { SlashCommand } from '~/types'
import type { CommandDraft } from '~/composables/useCommandGenerator'

defineProps<{ anchor?: { top: number; left: number } | null }>()

const emit = defineEmits<{
  save: [command: SlashCommand]
  'edit-manually': [draft: CommandDraft]
  cancel: []
}>()

const { t } = useTheme()
const { generate, isGenerating, error } = useCommandGenerator()

const draft = ref<CommandDraft | null>(null)

const onSubmit = async (prompt: string) => {
  const result = await generate(prompt)
  if (result) draft.value = result
}

const onRegenerate = () => {
  draft.value = null
}

const onSave = () => {
  if (!draft.value) return
  emit('save', { ...(draft.value as SlashCommand) })
}

const onEditDetails = () => {
  if (!draft.value) return
  emit('edit-manually', draft.value)
}
</script>
