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
    <template #controls>
      <CreatorScopePicker v-model="scope" :projects="projects" />
    </template>

    <template #preview>
      <div
        v-if="draft"
        class="rounded-xl p-3"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <div class="flex items-center gap-2 mb-1.5">
          <span class="text-[1em]" :style="{ color: t.text }">{{ draft.name }}</span>
          <span
            class="text-[1em] px-1.5 py-0.5 rounded font-mono"
            :style="{ background: t.bgPanel, color: t.textMuted, border: `1px solid ${t.border}` }"
          >
            {{ draft.event }}
          </span>
          <span
            class="text-[1em] px-1.5 py-0.5 rounded uppercase"
            :style="{ background: t.bgPanel, color: t.textMuted, border: `1px solid ${t.border}` }"
          >
            {{ draft.runMode }}
          </span>
        </div>
        <div class="text-[1em] mb-2" :style="{ color: t.textMuted }">
          {{ draft.description }}
        </div>
        <div
          class="text-[1em] font-mono p-2 rounded whitespace-pre-wrap"
          :style="{ background: t.bgPanel, color: t.textDim, border: `1px solid ${t.border}` }"
        >
          {{ draft.command }}
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
        Edit details
      </button>
      <button
        class="text-[1em] inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium"
        :style="{ background: t.accent, color: t.accentText }"
        @click="draft && emit('save', { ...(draft as Hook) }, scope)"
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

withDefaults(
  defineProps<{
    anchor?: { top: number; left: number } | null
    projects?: { id: string; name: string }[]
  }>(),
  { anchor: null, projects: () => [] },
)

const emit = defineEmits<{
  // scope: 'global' or a projectId — where the hook is persisted.
  save: [hook: Hook, scope: string]
  'edit-manually': [draft: HookDraft]
  cancel: []
}>()

const { t } = useTheme()
const scope = ref('global')
const { draft, isGenerating, error, onSubmit, onRegenerate } =
  usePromptCreator<HookDraft>(useHookGenerator())
</script>
