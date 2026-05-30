<template>
  <!-- eslint-disable vue/no-v-html — renderMarkdown via marked html:false (XSS safe) -->
  <div :data-stream-active="streaming ? 'true' : 'false'" v-html="renderedHtml" />
  <!-- eslint-enable vue/no-v-html -->
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { renderMarkdown } from '~/utils/markdown'

// Throttle markdown re-parsing while streaming. Without this, v-html replaces
// the entire HTML on every text chunk → layout reflow, scroll thrash, lost
// text selection. We render immediately when streaming = false (final state)
// and on the leading edge, then defer subsequent updates by THROTTLE_MS.

const THROTTLE_MS = 120

const props = defineProps<{
  text: string
  streaming: boolean
}>()

const renderedHtml = ref<string>(renderMarkdown(props.text))

let pendingTimer: ReturnType<typeof setTimeout> | null = null
let lastRenderedAt = 0

const flush = () => {
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  renderedHtml.value = renderMarkdown(props.text)
  lastRenderedAt = performance.now()
}

watch(
  () => [props.text, props.streaming] as const,
  ([, streaming]) => {
    // Streaming finished or never started → render immediately.
    if (!streaming) {
      flush()
      return
    }
    const now = performance.now()
    const sinceLast = now - lastRenderedAt
    if (sinceLast >= THROTTLE_MS) {
      flush()
      return
    }
    // Schedule a tail update so the final state always reflects current text
    // even if no further chunks arrive.
    if (pendingTimer) return
    pendingTimer = setTimeout(() => {
      pendingTimer = null
      flush()
    }, THROTTLE_MS - sinceLast)
  },
  { flush: 'post' },
)

onUnmounted(() => {
  if (pendingTimer) clearTimeout(pendingTimer)
})
</script>
