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
    <button class="iconbtn" :title="t('minimize.task')" @click="minimizeTask">
      <Icon name="minimize" />
    </button>
    <button class="iconbtn" :title="t('tasks.action.discussInSession')" @click="discussTask">
      <Icon name="sessions" />
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

    <div v-if="discussions.length" class="td-discuss">
      <div class="td-discuss-head">
        <Icon name="sessions" class="td-meta-icn" />
        {{ t('tasks.discussions', { n: discussions.length }) }}
      </div>
      <button
        v-for="d in discussions"
        :key="d.id"
        class="td-discuss-row"
        :disabled="!d.engineId"
        @click="d.engineId && openSession(d.engineId)"
      >
        <Icon name="sessions" class="td-discuss-icn" />
        <span class="td-discuss-title">{{ d.title }}</span>
        <Icon name="chev" class="td-discuss-chev" />
      </button>
    </div>

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
        :gate="entry.gate"
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
import { computed, onMounted } from 'vue'
import Icon from '~/components/Icon.vue'
import TaskPhaseCard from '~/components/task/TaskPhaseCard.vue'
import TaskSourceBadge from '~/components/task/TaskSourceBadge.vue'
import { useI18n } from '~/composables/useI18n'
import { useTasksStore, type Task, type TaskPhase } from '~/stores/tasks'
import { useSessionsStore } from '~/stores/sessions'
import { useSessionTaskLink } from '~/composables/useSessionTaskLink'
import { useMinimizeDock } from '~/composables/useMinimizeDock'

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
const sessionsStore = useSessionsStore()
const { openSession, discussInSession } = useSessionTaskLink()

// Minimize this task to the corner dock as a live PiP tile (keeps tracking status
// while the user works elsewhere; the pill pulses on attention / completion).
const { minimize: dockMinimize } = useMinimizeDock()
function minimizeTask() {
  dockMinimize({
    id: `task:${props.task.id}`,
    kind: 'task',
    icon: 'workflows',
    title: props.task.title,
    taskId: props.task.id,
  })
}

// "Discuss in session" → spawn a session bound to this task and navigate to it.
const discussTask = () =>
  discussInSession(
    props.task.id,
    props.task.projectId,
    t('tasks.discussTitle', { title: props.task.title }),
  )

// Sessions opened to discuss this task (ADR 0055 — reverse link, derived). Hydrate
// the sessions list on mount so this populates even when arriving from the Tasks
// page before Sessions has loaded.
onMounted(() => {
  void sessionsStore.hydrate()
})
const discussions = computed(() =>
  sessionsStore.sessions.filter((s) => s.aboutTaskId === props.task.id),
)

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
type GateSlice = { onFailTarget: string; maxIterations: number; auto: boolean }
type PhaseEntry = {
  nodeId: string
  phase: TaskPhase
  agentName: string
  index: number
  gate?: GateSlice
}
const orderedPhases = computed<PhaseEntry[]>(() => {
  const out: PhaseEntry[] = []
  for (const nodeId of store.phaseOrder(props.task)) {
    const phase = props.task.phases[nodeId]
    if (!phase) continue
    const gate = store.nodeFor(props.task, nodeId)?.gate
    const entry: PhaseEntry = {
      nodeId,
      phase,
      agentName: agentNameFor(nodeId),
      index: out.length + 1,
    }
    if (gate) entry.gate = gate
    out.push(entry)
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
.td-discuss {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.td-discuss-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9231rem;
  color: var(--textMuted);
  margin-bottom: 2px;
}
.td-discuss-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bgSubtle);
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.12s ease,
    background 0.12s ease;
}
.td-discuss-row:hover:not(:disabled) {
  border-color: var(--accentBorder);
  background: var(--bgHover);
}
.td-discuss-row:disabled {
  cursor: default;
  opacity: 0.6;
}
.td-discuss-icn {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: var(--textDim);
}
.td-discuss-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.td-discuss-chev {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: var(--textFaint);
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
