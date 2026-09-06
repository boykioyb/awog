<template>
  <div ref="scrollEl" class="ctl-log" :style="{ maxHeight: `${maxHeightRem}rem` }">
    <div v-for="(line, i) in lines" :key="i" class="ctl-line" :class="`ctl-${line.level}`">
      <span class="ctl-gutter mono">{{ gutter(line.level) }}</span>
      <span class="ctl-msg mono">{{ line.message }}</span>
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

<style scoped>
.ctl-log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 11px;
  border-radius: var(--r-sm);
  background: var(--bgPanel);
  border: 1px solid var(--border);
  overflow-y: auto;
}
.ctl-line {
  display: flex;
  gap: 8px;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  word-break: break-word;
}
.ctl-gutter {
  flex: 0 0 auto;
  width: 12px;
  text-align: center;
  color: var(--textFaint);
  user-select: none;
}
.ctl-msg {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
}
.ctl-info .ctl-msg {
  color: var(--textDim);
}
.ctl-stderr .ctl-msg {
  color: var(--textMuted);
}
.ctl-error .ctl-gutter,
.ctl-error .ctl-msg {
  color: var(--danger);
}
</style>
