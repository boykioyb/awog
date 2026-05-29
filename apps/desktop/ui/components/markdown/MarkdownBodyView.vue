<!--
  Section header + markdown body display with preview/raw toggle, copy, and
  optional edit-body trigger. Shared by SkillDetail (Instructions) and
  AgentDetail (System prompt) — anywhere we render a frontmatter-style body.
-->
<template>
  <div>
    <div class="flex items-center justify-between mb-2">
      <div class="text-[0.71em] uppercase tracking-wider font-medium" :style="{ color: t.textDim }">
        {{ title }}
      </div>
      <div class="flex items-center gap-1">
        <div
          class="flex items-center rounded overflow-hidden"
          :style="{ border: `1px solid ${t.border}` }"
        >
          <button
            v-for="mode in ['preview', 'raw'] as const"
            :key="mode"
            class="px-2 py-1 text-[0.71em] inline-flex items-center gap-1 transition"
            :style="viewModeStyle(mode)"
            @click="viewMode = mode"
          >
            <component :is="mode === 'preview' ? Eye : FileCode" :size="10" />
            {{ mode }}
          </button>
        </div>
        <button
          v-if="content"
          class="px-2 py-1 text-[0.71em] rounded inline-flex items-center gap-1 transition"
          :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
          :title="copied ? 'Copied!' : 'Copy markdown to clipboard'"
          @click="onCopy"
        >
          <component :is="copied ? Check : Copy" :size="10" />
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
        <button
          v-if="allowEdit"
          class="px-2 py-1 text-[0.71em] rounded inline-flex items-center gap-1 transition"
          :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
          :title="editTitle"
          @click="onEdit"
        >
          <Sparkles :size="10" />
          {{ editLabel }}
        </button>
      </div>
    </div>

    <div
      v-if="!content"
      class="text-[0.79em] italic p-3 rounded"
      :style="{ color: t.textFaint, background: t.bgInput, border: `1px solid ${t.border}` }"
    >
      {{ emptyText }}
    </div>
    <div
      v-else-if="viewMode === 'preview'"
      class="p-3 rounded text-[0.93em] leading-relaxed"
      :style="{ color: t.textMuted, background: t.bgInput, border: `1px solid ${t.border}` }"
    >
      <MarkdownRenderer :content="content" />
    </div>
    <pre
      v-else
      class="text-[0.86em] font-mono whitespace-pre-wrap leading-relaxed p-3 rounded"
      :style="{
        color: t.textMuted,
        background: t.bgInput,
        border: `1px solid ${t.border}`,
        margin: 0,
      }"
      >{{ content }}</pre
    >
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { Check, Copy, Eye, FileCode, Sparkles } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    title: string
    content: string
    emptyText?: string
    allowEdit?: boolean
    editLabel?: string
    editTitle?: string
  }>(),
  {
    emptyText: '(empty — click Edit to add content)',
    allowEdit: false,
    editLabel: 'Edit',
    editTitle: 'Edit content',
  },
)

const emit = defineEmits<{
  'edit-body': [anchor: { top: number; left: number } | null]
}>()

const { t } = useTheme()

type ViewMode = 'preview' | 'raw'
const viewMode = ref<ViewMode>('preview')
const copied = ref(false)

const viewModeStyle = (mode: ViewMode): CSSProperties => {
  const active = viewMode.value === mode
  return {
    background: active ? t.value.bgActive : 'transparent',
    color: active ? t.value.text : t.value.textDim,
    borderRight: mode === 'preview' ? `1px solid ${t.value.border}` : 'none',
  }
}

const onCopy = async () => {
  try {
    await navigator.clipboard.writeText(props.content ?? '')
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // Clipboard API can fail under non-secure contexts (e.g. file://). Fall
    // back to legacy execCommand which Tauri webview tolerates.
    const textarea = document.createElement('textarea')
    textarea.value = props.content ?? ''
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      copied.value = true
      setTimeout(() => {
        copied.value = false
      }, 1500)
    } finally {
      document.body.removeChild(textarea)
    }
  }
}

const onEdit = (e: MouseEvent) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  emit('edit-body', { top: rect.bottom + 8, left: rect.left })
}
</script>
