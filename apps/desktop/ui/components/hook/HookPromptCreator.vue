<template>
  <PromptCreatorPanel
    :anchor="anchor"
    headline="What automation do you want?"
    subheadline="Mô tả khi nào hook nên chạy và làm gì"
    placeholder='e.g., "Chạy prettier mỗi khi agent ghi file .ts"'
    generated-label="Generated hook"
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
          <span class="text-[0.86em]" :style="{ color: t.text }">{{ draft.name }}</span>
          <span
            class="text-[0.71em] px-1.5 py-0.5 rounded font-mono"
            :style="{ background: t.bgPanel, color: t.textMuted, border: `1px solid ${t.border}` }"
          >
            {{ draft.event }}
          </span>
          <span
            class="text-[0.71em] px-1.5 py-0.5 rounded uppercase"
            :style="{ background: t.bgPanel, color: t.textMuted, border: `1px solid ${t.border}` }"
          >
            {{ draft.runMode }}
          </span>
        </div>
        <div class="text-[0.86em] mb-2" :style="{ color: t.textMuted }">
          {{ draft.description }}
        </div>
        <div
          class="text-[0.71em] font-mono p-2 rounded whitespace-pre-wrap"
          :style="{ background: t.bgPanel, color: t.textDim, border: `1px solid ${t.border}` }"
        >
          {{ draft.command }}
        </div>
      </div>
    </template>

    <template #actions>
      <button
        class="text-[0.79em] inline-flex items-center gap-1.5 px-2.5 py-1 rounded"
        :style="{ color: t.textMuted }"
        @click="draft && emit('edit-manually', draft)"
      >
        <Sliders :size="11" />
        Edit details
      </button>
      <button
        class="text-[0.79em] inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium"
        :style="{ background: t.accent, color: t.accentText }"
        @click="draft && emit('save', { ...(draft as Hook) })"
      >
        <Save :size="11" />
        Save hook
      </button>
    </template>
  </PromptCreatorPanel>
</template>

<script setup lang="ts">
import { Save, Sliders } from 'lucide-vue-next'
import type { Hook } from '~/types'
import type { HookDraft } from '~/composables/useHookGenerator'

defineProps<{ anchor?: { top: number; left: number } | null }>()

const emit = defineEmits<{
  save: [hook: Hook]
  'edit-manually': [draft: HookDraft]
  cancel: []
}>()

const { t } = useTheme()
const { draft, isGenerating, error, onSubmit, onRegenerate } =
  usePromptCreator<HookDraft>(useHookGenerator())
</script>
