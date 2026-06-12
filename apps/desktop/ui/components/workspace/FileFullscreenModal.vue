<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[100] flex flex-col"
      :style="{ background: t.overlay }"
      @click.self="emit('close')"
    >
      <!-- Toolbar -->
      <div
        class="flex items-center gap-2 px-4 py-2.5 flex-shrink-0"
        :style="{ background: t.bgPanel, borderBottom: `1px solid ${t.border}` }"
      >
        <FileText :size="14" :style="{ color: t.accent }" />
        <span class="text-[1em] font-mono truncate" :style="{ color: t.text }">{{ path }}</span>
        <span class="flex-1" />

        <!-- Markdown/HTML preview/raw toggle (PDF is preview-only) -->
        <div
          v-if="isMarkdown || isHtml"
          class="inline-flex rounded overflow-hidden"
          :style="{ border: `1px solid ${t.border}` }"
        >
          <button
            v-for="m in viewModes"
            :key="m.value"
            type="button"
            class="px-2 py-1 inline-flex items-center transition"
            :style="{
              background: view === m.value ? t.bgActive : 'transparent',
              color: view === m.value ? t.text : t.textDim,
            }"
            :title="tr(m.labelKey)"
            @click="view = m.value"
          >
            <component :is="m.icon" :size="13" />
          </button>
        </div>

        <span
          v-if="language"
          class="text-[12px] uppercase tracking-wider"
          :style="{ color: t.textDim }"
        >
          {{ language }}
        </span>

        <button
          v-if="content"
          type="button"
          class="p-1.5 rounded transition"
          :style="{ color: copied ? t.success : t.textDim }"
          :title="copied ? tr('workspace.files.copied') : tr('common.copy')"
          @click="copy"
        >
          <Check v-if="copied" :size="14" />
          <Copy v-else :size="14" />
        </button>
        <div :style="{ width: '1px', height: '18px', background: t.border }" />
        <button
          type="button"
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('common.close')"
          @click="emit('close')"
        >
          <X :size="15" />
        </button>
      </div>

      <!-- Content surface -->
      <div class="flex-1 min-h-0 overflow-auto" :style="{ background: t.bg }">
        <FilePreviewFrame
          v-if="showFrame"
          class="h-full w-full"
          :workspace-root="workspaceRoot ?? ''"
          :path="path"
          :kind="isPdf ? 'pdf' : 'html'"
        />
        <div v-else-if="isMarkdown && view === 'preview'" class="mx-auto max-w-3xl px-8 py-6">
          <MarkdownRenderer :content="content" />
        </div>
        <pre
          v-else
          class="px-8 py-6 text-[1em] font-mono whitespace-pre"
          :style="{ color: t.text }"
          >{{ content }}</pre
        >
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Check, Code, Copy, Eye, FileText, X } from 'lucide-vue-next'
import MarkdownRenderer from '~/components/markdown/MarkdownRenderer.vue'
import FilePreviewFrame from '~/components/workspace/FilePreviewFrame.vue'

const props = defineProps<{
  path: string
  content: string
  language?: string
  workspaceRoot?: string
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()

const isMarkdown = computed(() => {
  const lang = (props.language ?? '').toLowerCase()
  return lang === 'markdown' || lang === 'md' || /\.(md|markdown|mdx)$/i.test(props.path)
})
const isHtml = computed(() => /\.html?$/i.test(props.path))
const isPdf = computed(() => /\.pdf$/i.test(props.path))

type FileView = 'preview' | 'raw'
const view = ref<FileView>(isMarkdown.value || isHtml.value || isPdf.value ? 'preview' : 'raw')
// Render the iframe preview only when we have a workspace root to read from.
const showFrame = computed(
  () => !!props.workspaceRoot && (isPdf.value || (isHtml.value && view.value === 'preview')),
)
const viewModes = [
  { value: 'preview' as const, labelKey: 'workspace.files.preview', icon: Eye },
  { value: 'raw' as const, labelKey: 'workspace.files.raw', icon: Code },
]

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
const copy = async () => {
  try {
    await navigator.clipboard.writeText(props.content)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1500)
  } catch {
    // clipboard may be denied in restricted contexts — ignore
  }
}

const onKeydown = (ev: KeyboardEvent) => {
  if (ev.key !== 'Escape') return
  // A mermaid zoom modal stacks above this one (opened from a diagram in the
  // preview) and owns Escape first — don't close underneath it.
  if (document.querySelector('.mermaid-zoom-modal')) return
  emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>
