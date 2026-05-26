<template>
  <div v-if="mode === 'diff'" class="flex-1 overflow-auto" :style="{ background: t.bg }">
    <DiffViewer :content="content" />
  </div>
  <div
    v-else
    class="flex flex-col overflow-hidden"
    :class="isSplit ? 'hidden md:flex w-1/2' : 'flex-1'"
    :style="{ background: t.bgSubtle }"
  >
    <div class="flex-1 overflow-auto">
      <div class="max-w-3xl mx-auto px-4 md:px-8 py-6">
        <MarkdownRenderer :content="content" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  content: string
  /** 'diff' renders DiffViewer; 'preview' renders MarkdownRenderer in a styled card. */
  mode: 'diff' | 'preview'
  /** When true (split view), preview pane uses half width on desktop. */
  isSplit: boolean
}>()

const { t } = useTheme()
</script>
