<script setup lang="ts">
import { computed } from 'vue'
import type { SessionStep } from '../types'

const props = defineProps<{ step: SessionStep }>()

const isTodo = computed(() => props.step.kind === 'note' && !!props.step.todos?.length)
const isThinking = computed(() => props.step.kind === 'thinking')

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
      return isThinking.value ? '✳' : '›'
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
  <div class="step" :class="{ running: step.status === 'running', error: step.status === 'error' }">
    <div class="line">
      <span class="ic">{{ icon }}</span>
      <span class="label">{{ step.label }}</span>
      <span v-if="step.target" class="target">{{ step.target }}</span>
      <span v-if="counts" class="counts">{{ counts }}</span>
    </div>

    <ul v-if="isTodo" class="todos">
      <li v-for="(t, i) in step.todos" :key="i" :class="t.status">
        <span class="tick">{{ t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○' }}</span>
        <span>{{ t.content }}</span>
      </li>
    </ul>
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
