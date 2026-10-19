<template>
  <div class="flex items-center gap-2">
    <span
      class="size-2 shrink-0 rounded-full"
      :class="[dotClass, { 'animate-pulse': task.status === 'running' }]"
    />
    <span class="min-w-0 flex-1 truncate text-base font-medium">{{ task.title }}</span>
    <span
      v-if="isActive && progress.totalNodes > 0"
      class="shrink-0 text-xs tabular-nums text-dim"
      :title="t('tasks.list.progress')"
    >
      {{ progress.doneNodes }}/{{ progress.totalNodes }}
    </span>
  </div>
  <div class="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
    <Badge variant="outline" class="rounded-sm" :class="tagClass">
      {{ t(`tasks.statusLabel.${task.status}`) }}
    </Badge>
    <span class="truncate">{{ metaText }}</span>
  </div>
</template>

<script setup lang="ts">
// One Tasks-list row (rendered in LibraryView's #row slot). Port of the old UI
// TaskListItem: status dot + title + N/M count + status tag +
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

const dotClass = computed(() => {
  switch (props.task.status) {
    case 'running':
      return 'bg-primary'
    case 'waiting_approval':
    case 'waiting_connection':
    case 'paused':
      return 'bg-warning'
    case 'failed':
      return 'bg-destructive'
    case 'completed':
      return 'bg-success'
    default:
      return 'bg-faint'
  }
})

const tagClass = computed(() => {
  if (props.task.status === 'running') return 'border-primary/40 bg-primary/10 text-primary'
  if (
    props.task.status === 'waiting_approval' ||
    props.task.status === 'waiting_connection' ||
    props.task.status === 'paused'
  )
    return 'border-warning/40 text-warning'
  return 'text-muted-foreground'
})

const metaText = computed(() => {
  const wf = props.task.workflowSnapshot?.name
  const pct = props.progress.pct
  return wf ? `${wf} · ${pct}%` : `${pct}%`
})
</script>
