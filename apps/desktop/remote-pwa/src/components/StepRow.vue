<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Check,
  ChevronRight,
  Circle,
  CircleDot,
  CornerDownRight,
  FileText,
  Pencil,
  Search,
  Sparkles,
  Terminal,
  X,
  Zap,
} from 'lucide-vue-next'
import StepDetail from './StepDetail.vue'
import type { Component } from 'vue'
import type { SessionStep } from '../types'

const props = defineProps<{ step: SessionStep }>()

const isTodo = computed(() => props.step.kind === 'note' && !!props.step.todos?.length)
const isThinking = computed(() => props.step.kind === 'thinking')
const isSteer = computed(() => props.step.kind === 'steer')

// Rows collapse by default (same as the desktop transcript) and open on tap when
// the engine attached a detail payload — that is where the real diff / command
// output / reasoning lives.
const expandable = computed(() => !!props.step.detail && !isTodo.value)
const open = ref(false)

function toggle(): void {
  if (expandable.value) open.value = !open.value
}

// One icon set, one stroke weight (see `.lucide` in style.css). Status wins over
// tool: an errored read has to read as an error first.
const icon = computed<Component>(() => {
  const s = props.step
  if (s.status === 'error') return X
  if (s.status === 'running') return CircleDot
  switch (s.tool) {
    case 'read':
      return FileText
    case 'write':
    case 'edit':
    case 'save':
      return Pencil
    case 'search':
    case 'find-files':
      return Search
    case 'terminal':
      return Terminal
    case 'task':
      return CornerDownRight
    default:
      if (isThinking.value) return Sparkles
      return isSteer.value ? Zap : ChevronRight
  }
})

const counts = computed(() => {
  const { additions, deletions } = props.step
  if (additions == null && deletions == null) return ''
  const a = additions ? `+${additions}` : ''
  const d = deletions ? `−${deletions}` : ''
  return [a, d].filter(Boolean).join(' ')
})
</script>

<template>
  <div
    class="step"
    :class="{
      running: step.status === 'running',
      error: step.status === 'error',
      thinking: isThinking,
    }"
  >
    <div class="line" :class="{ tappable: expandable }" @click="toggle">
      <component :is="icon" class="icn-sm ic" />
      <span class="label">{{ step.label }}</span>
      <span v-if="step.target" class="target">{{ step.target }}</span>
      <span v-if="counts" class="counts">{{ counts }}</span>
      <ChevronRight v-if="expandable" class="icn-sm chev" :class="{ open }" />
    </div>

    <div v-if="isSteer && step.steerText" class="steer">{{ step.steerText }}</div>

    <ul v-if="isTodo" class="todos">
      <li v-for="(t, i) in step.todos" :key="i" :class="t.status">
        <Check v-if="t.status === 'completed'" class="icn-sm tick" />
        <CircleDot v-else-if="t.status === 'in_progress'" class="icn-sm tick" />
        <Circle v-else class="icn-sm tick" />
        <span>{{ t.content }}</span>
      </li>
    </ul>

    <StepDetail v-if="open && step.detail" :detail="step.detail" />
  </div>
</template>

<style scoped>
.step {
  margin: 2px 0 6px;
}
.line {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text-dim);
  overflow: hidden;
  min-height: 26px;
}
.line.tappable:active {
  opacity: 0.6;
}
.ic {
  color: var(--text-faint);
}
.step.running .ic {
  color: var(--accent);
}
.step.error .ic,
.step.error .label {
  color: var(--danger);
}
.step.thinking .label {
  font-style: italic;
  color: var(--text-dim);
}
.label {
  flex-shrink: 0;
  color: var(--text);
}
.target {
  /* mono-ok: a file path / command the step operated on. */
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.counts {
  flex-shrink: 0;
  /* mono-ok: +/- line counts, read against the diff they summarise. */
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--text-faint);
}
.chev {
  margin-left: auto;
  color: var(--text-faint);
  transition: transform 0.15s;
}
.chev.open {
  transform: rotate(90deg);
}
.steer {
  margin: 2px 0 6px 21px;
  padding: 6px 10px;
  border-left: 2px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: pre-wrap;
  word-break: break-word;
}
.todos {
  list-style: none;
  margin: 4px 0 0 21px;
  padding: 0;
}
.todos li {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text-dim);
  padding: 1px 0;
}
.todos li.completed {
  color: var(--text-faint);
  text-decoration: line-through;
}
.todos li.in_progress {
  color: var(--text);
}
.tick {
  color: var(--accent);
  /* Centre on the FIRST line (--lh-sm = 20px box, 14px icon), not on a wrapped
     block — align-items:center would float it to the middle of a 2-line item. */
  margin-top: 3px;
}
</style>
