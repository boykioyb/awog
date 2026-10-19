<template>
  <div
    ref="scrollEl"
    class="flex flex-col gap-0.5 overflow-y-auto rounded-md border bg-sidebar px-3 py-2"
    :style="{ maxHeight: `${maxHeightRem}rem` }"
  >
    <!-- Log lệnh/stderr là nội dung người dùng copy ⇒ mono. -->
    <div
      v-for="(line, i) in lines"
      :key="i"
      class="flex gap-2 font-mono text-xs break-words"
      :class="LEVEL_CLASS[line.level]"
    >
      <span
        class="w-3 flex-none text-center select-none"
        :class="line.level !== 'error' && 'text-faint'"
      >
        {{ gutter(line.level) }}
      </span>
      <span class="min-w-0 flex-1 whitespace-pre-wrap">{{ line.message }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// A read-only activity console for the connection-test log (ADR 0060 P5 Tools
// section). Renders the streamed/returned SourceLogLine[]; when `live` it pins the
// scroll to the bottom as lines arrive (the "what it's doing" ticker). Levels are
// color-coded: info (dim), stderr (muted mono), error (danger).
import { nextTick, useTemplateRef, watch } from 'vue'
import type { SourceLogLine, SourceLogLevel } from '~/stores/connections'

const props = withDefaults(
  defineProps<{
    lines: SourceLogLine[]
    live?: boolean
    maxHeightRem?: number
  }>(),
  { live: false, maxHeightRem: 12 },
)

const scrollEl = useTemplateRef<HTMLElement>('scrollEl')

// info mờ · stderr xám · error đỏ (cả gutter lẫn message).
const LEVEL_CLASS: Record<SourceLogLevel, string> = {
  info: 'text-dim',
  stderr: 'text-muted-foreground',
  error: 'text-destructive',
}

function gutter(level: SourceLogLevel): string {
  if (level === 'stderr') return '2'
  if (level === 'error') return '✕'
  return '›'
}

// Auto-scroll to the newest line while streaming (only when `live`, so a
// collapsed after-run transcript keeps its scroll position).
watch(
  () => props.lines.length,
  async () => {
    if (!props.live) return
    await nextTick()
    const el = scrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  },
)
</script>
