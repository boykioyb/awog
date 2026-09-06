<template>
  <div class="lrow">
    <span class="sdot" :class="{ pulse: task.status === 'running' }" :style="{ background: dot }" />
    <span class="ttl">{{ task.title }}</span>
    <span
      v-if="isActive && progress.totalNodes > 0"
      class="tli-count"
      :title="t('tasks.list.progress')"
    >
      {{ progress.doneNodes }}/{{ progress.totalNodes }}
    </span>
  </div>
  <div class="sub">
    <span class="tag" :class="tagClass">{{ t(`tasks.statusLabel.${task.status}`) }}</span>
    <span class="tli-meta">{{ metaText }}</span>
  </div>
</template>

<script setup lang="ts">
// One Tasks-list row (rendered in LibraryView's #row slot). Port of the old UI
// TaskListItem in prototype CSS: status dot + title + N/M count + status tag +
// "workflow · X%" meta. Status color maps to the prototype palette tokens.
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import type { Task, TaskProgress } from '~/stores/tasks'

const props = defineProps<{ task: Task; progress: TaskProgress }>()

const { t } = useI18n()

const isActive = computed(
  () =>
    props.task.status === 'running' ||
    props.task.status === 'waiting_approval' ||
    props.task.status === 'waiting_connection' ||
    props.task.status === 'paused',
)

const dot = computed(() => {
  switch (props.task.status) {
    case 'running':
      return 'var(--accent)'
    case 'waiting_approval':
    case 'waiting_connection':
    case 'paused':
      return 'var(--amber)'
    case 'failed':
      return 'var(--danger)'
    case 'completed':
      return 'var(--green)'
    default:
      return 'var(--textFaint)'
  }
})

const tagClass = computed(() => {
  if (props.task.status === 'running') return 'acc'
  if (
    props.task.status === 'waiting_approval' ||
    props.task.status === 'waiting_connection' ||
    props.task.status === 'paused'
  )
    return 'warn'
  return ''
})

const metaText = computed(() => {
  const wf = props.task.workflowSnapshot?.name
  const pct = props.progress.pct
  return wf ? `${wf} · ${pct}%` : `${pct}%`
})
</script>

<style scoped>
.tli-count {
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  flex: 0 0 auto;
}
.tli-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
