<template>
  <div class="dh">
    <div class="td-titlecol">
      <div class="dt">{{ task.title }}</div>
      <div class="dsub">{{ task.id }} · {{ formattedTime }}</div>
    </div>
    <span style="flex: 1" />
    <span class="tag td-status" :class="statusTagClass">
      <Icon :name="statusIcon" class="td-statusi" :class="{ spin: task.status === 'running' }" />
      {{ t(`tasks.statusLabel.${task.status}`) }}
    </span>
    <button
      v-if="task.status === 'running'"
      class="iconbtn"
      :title="t('tasks.action.pause')"
      @click="emit('pause')"
    >
      <Icon name="clock" />
    </button>
    <button
      v-if="task.status === 'paused'"
      class="iconbtn"
      :title="t('tasks.action.resume')"
      @click="emit('resume')"
    >
      <Icon name="play" />
    </button>
    <button
      v-if="isActive"
      class="iconbtn danger"
      :title="t('tasks.action.stop')"
      @click="emit('cancel')"
    >
      <Icon name="stop" />
    </button>
    <button class="iconbtn" :title="t('tasks.action.openEditor')" @click="openEditor">
      <Icon name="edit" />
    </button>
    <button class="iconbtn danger" :title="t('tasks.action.delete')" @click="emit('delete')">
      <Icon name="trash" />
    </button>
  </div>

  <div class="dscroll">
    <div class="td-meta">
      <span v-if="task.workflowSnapshot" class="td-meta-item">
        <Icon name="workflows" class="td-meta-icn" />
        {{ task.workflowSnapshot.name }}
      </span>
      <span class="td-meta-dot">·</span>
      <TaskSourceBadge v-if="task.source" :source="task.source" />
    </div>
    <p v-if="task.description" class="td-desc">{{ task.description }}</p>

    <div class="th td-pipehead">
      <Icon name="workflows" />
      <span class="tt">
        {{ t('tasks.pipeline', { done: progress.doneNodes, total: progress.totalNodes }) }}
      </span>
      <span class="ct">{{ progress.pct }}%</span>
    </div>

    <div class="td-phases">
      <TaskPhaseCard
        v-for="entry in orderedPhases"
        :key="entry.nodeId"
        :task-id="task.id"
        :phase="entry.phase"
        :agent-name="entry.agentName"
        :index="entry.index"
        :task-status="task.status"
        @approve="emit('approve', entry.nodeId)"
        @rerun="(instr) => emit('rerun', entry.nodeId, instr)"
        @discuss="(v, text) => emit('discuss', entry.nodeId, v, text)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// Task detail — header (title/id/time/status + pause/resume/stop/delete) plus the
// pipeline of phase cards. Port of the old UI TaskDetail in prototype CSS. The
// detail is rendered inside LibraryView's #detail slot.
import { computed } from 'vue'
import Icon from '~/components/Icon.vue'
import TaskPhaseCard from '~/components/task/TaskPhaseCard.vue'
import TaskSourceBadge from '~/components/task/TaskSourceBadge.vue'
import { useI18n } from '~/composables/useI18n'
import { useTasksStore, type Task, type TaskPhase } from '~/stores/tasks'

const props = defineProps<{ task: Task }>()

const emit = defineEmits<{
  approve: [nodeId: string]
  rerun: [nodeId: string, instruction: string]
  discuss: [nodeId: string, runVersion: number, text: string]
  cancel: []
  pause: []
  resume: []
  delete: []
}>()

const { t } = useI18n()
const store = useTasksStore()

const progress = computed(() => store.progressOf(props.task))

// Open the task's artifacts in the standalone Monaco editor route (owned by a
// sibling agent — we only match the path `/edit/:taskId`).
const openEditor = () => navigateTo(`/edit/${props.task.id}`)

const agentNameFor = (nodeId: string): string => {
  const node = store.nodeFor(props.task, nodeId)
  return node?.agentName ?? node?.agentId ?? nodeId
}

// Phases in topological pipeline order, paired with their display index +
// resolved agent name. Skips order entries that have no seeded phase.
type PhaseEntry = { nodeId: string; phase: TaskPhase; agentName: string; index: number }
const orderedPhases = computed<PhaseEntry[]>(() => {
  const out: PhaseEntry[] = []
  for (const nodeId of store.phaseOrder(props.task)) {
    const phase = props.task.phases[nodeId]
    if (!phase) continue
    out.push({ nodeId, phase, agentName: agentNameFor(nodeId), index: out.length + 1 })
  }
  return out
})

const isActive = computed(
  () =>
    props.task.status === 'running' ||
    props.task.status === 'waiting_approval' ||
    props.task.status === 'waiting_connection' ||
    props.task.status === 'queued' ||
    props.task.status === 'paused',
)

const STATUS_ICON: Record<Task['status'], string> = {
  queued: 'clock',
  running: 'act',
  waiting_approval: 'clock',
  waiting_connection: 'clock',
  paused: 'clock',
  completed: 'check',
  failed: 'alert',
}
const statusIcon = computed(() => STATUS_ICON[props.task.status])

const statusTagClass = computed(() => {
  if (props.task.status === 'running') return 'acc'
  if (
    props.task.status === 'waiting_approval' ||
    props.task.status === 'waiting_connection' ||
    props.task.status === 'paused'
  )
    return 'warn'
  return ''
})

const formattedTime = computed(() => {
  const ms = Date.parse(props.task.createdAt)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleString()
})
</script>

<style scoped>
.td-titlecol {
  min-width: 0;
}
.td-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.td-statusi {
  width: 11px;
  height: 11px;
}
.td-statusi.spin {
  animation: td-pulse 1.4s ease-in-out infinite;
}
@keyframes td-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
.iconbtn.danger:hover {
  color: var(--danger);
  border-color: var(--dangerBorder, var(--border));
}
.td-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 0.9231rem;
  color: var(--textMuted);
  margin-bottom: 12px;
}
.td-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.td-meta-icn {
  width: 12px;
  height: 12px;
}
.td-meta-dot {
  color: var(--textFaint);
}
.td-desc {
  font-size: 0.9615rem;
  color: var(--textMuted);
  line-height: 1.6;
  margin-bottom: 6px;
}
.td-pipehead {
  margin-top: 20px;
}
.td-phases {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
