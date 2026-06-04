<template>
  <span
    v-if="source.type === 'github'"
    class="inline-flex items-center gap-1 cursor-pointer hover:underline"
    :title="source.url"
    role="link"
    tabindex="0"
    @click.stop="openSource(source.url)"
    @keydown.enter.stop="openSource(source.url)"
  >
    <Github :size="compact ? 10 : 11" />
    <span class="font-mono">{{ source.repo }}#{{ source.issueNumber }}</span>
  </span>
  <span v-else-if="source.type === 'jira'" class="inline-flex items-center gap-1">
    <Layers :size="compact ? 10 : 11" />
    <span class="font-mono">{{ source.key }}</span>
  </span>
  <span v-else class="inline-flex items-center gap-1">
    <FileText :size="compact ? 10 : 11" />
    Manual
  </span>
</template>

<script setup lang="ts">
import { Github, Layers, FileText } from 'lucide-vue-next'
import type { TaskSource } from '~/types'

withDefaults(
  defineProps<{
    source: TaskSource
    compact?: boolean
  }>(),
  { compact: false },
)

// Open the issue/PR in the OS browser (Tauri); fall back to window.open in
// browser-dev where the sidecar bridge isn't available.
const openSource = (url: string): void => {
  if (!url) return
  useSidecar()
    .openExternal(url)
    .catch(() => {
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
    })
}
</script>
