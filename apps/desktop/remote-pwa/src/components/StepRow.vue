<script setup lang="ts">
import { computed, ref } from 'vue'
import StepDetail from './StepDetail.vue'
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

const icon = computed(() => {
  const s = props.step
  if (s.status === 'error') return '✕'
  if (s.status === 'running') return '•'
  switch (s.tool) {
    case 'read':
      return '◇'
    case 'write':
    case 'edit':
    case 'save':
      return '✎'
    case 'search':
    case 'find-files':
      return '⌕'
    case 'terminal':
      return '▶'
    case 'task':
      return '⇢'
    default:
      if (isThinking.value) return '✳'
      return isSteer.value ? '↯' : '›'
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
      <span class="ic">{{ icon }}</span>
      <span class="label">{{ step.label }}</span>
      <span v-if="step.target" class="target">{{ step.target }}</span>
      <span v-if="counts" class="counts">{{ counts }}</span>
      <span v-if="expandable" class="chev" :class="{ open }">›</span>
    </div>

    <div v-if="isSteer && step.steerText" class="steer">{{ step.steerText }}</div>

    <ul v-if="isTodo" class="todos">
      <li v-for="(t, i) in step.todos" :key="i" :class="t.status">
        <span class="tick">{{
          t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○'
        }}</span>
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
  font-size: 13px;
  color: var(--text-dim);
  overflow: hidden;
  min-height: 26px;
}
.line.tappable:active {
  opacity: 0.6;
}
.ic {
  color: var(--text-faint);
  flex-shrink: 0;
  width: 14px;
  text-align: center;
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
  font-family: var(--mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.counts {
  flex-shrink: 0;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-faint);
}
.chev {
  flex-shrink: 0;
  margin-left: auto;
  padding-left: 6px;
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
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: 13px;
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
  gap: 7px;
  font-size: 13px;
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
  flex-shrink: 0;
}
</style>
