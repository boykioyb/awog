<template>
  <div class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
    <div class="min-w-0">
      <div class="truncate text-lg font-semibold">{{ task.title }}</div>
      <div class="truncate text-sm text-muted-foreground">{{ task.id }} · {{ formattedTime }}</div>
    </div>
    <span class="flex-1" />
    <Badge variant="outline" class="gap-1.5 rounded-sm" :class="statusTagClass">
      <Icon
        :name="statusIcon"
        class="size-3"
        :class="{ 'animate-pulse': task.status === 'running' }"
      />
      {{ t(`tasks.statusLabel.${task.status}`) }}
    </Badge>
    <Button
      v-if="task.status === 'running'"
      :title="t('tasks.action.pause')"
      variant="outline"
      size="iconMd"
      @click="emit('pause')"
    >
      <Icon name="clock" />
    </Button>
    <Button
      v-if="task.status === 'paused'"
      :title="t('tasks.action.resume')"
      variant="outline"
      size="iconMd"
      @click="emit('resume')"
    >
      <Icon name="play" />
    </Button>
    <Button
      v-if="isActive"
      :title="t('tasks.action.stop')"
      variant="danger"
      size="iconMd"
      @click="emit('cancel')"
    >
      <Icon name="stop" />
    </Button>
    <Button :title="t('minimize.task')" variant="outline" size="iconMd" @click="minimizeTask">
      <Icon name="minimize" />
    </Button>
    <Button
      :title="t('tasks.action.discussInSession')"
      variant="outline"
      size="iconMd"
      @click="discussTask"
    >
      <Icon name="sessions" />
    </Button>
    <Button
      :title="t('tasks.action.openEditor')"
      variant="outline"
      size="iconMd"
      @click="openEditor"
    >
      <Icon name="edit" />
    </Button>
    <Button
      :title="t('tasks.action.delete')"
      variant="danger"
      size="iconMd"
      @click="emit('delete')"
    >
      <Icon name="trash" />
    </Button>
  </div>

  <div class="flex-1 overflow-y-auto p-5">
    <div class="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span v-if="task.workflowSnapshot" class="inline-flex items-center gap-1.5">
        <Icon name="workflows" class="size-3" />
        {{ task.workflowSnapshot.name }}
      </span>
      <span class="text-faint">·</span>
      <TaskSourceBadge v-if="task.source" :source="task.source" />
    </div>
    <p v-if="task.description" class="mb-1.5 text-sm text-muted-foreground">
      {{ task.description }}
    </p>

    <div v-if="discussions.length" class="mt-3 flex flex-col gap-1">
      <div class="mb-0.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Icon name="sessions" class="size-3" />
        {{ t('tasks.discussions', { n: discussions.length }) }}
      </div>
      <Button
        v-for="d in discussions"
        :key="d.id"
        variant="outline"
        class="h-auto justify-start bg-muted px-2 py-1.5 font-normal hover:border-selected-border"
        :disabled="!d.engineId"
        @click="d.engineId && openSession(d.engineId)"
      >
        <Icon name="sessions" class="shrink-0 text-dim" />
        <span class="min-w-0 flex-1 truncate text-left font-medium text-foreground">
          {{ d.title }}
        </span>
        <Icon name="chev" class="shrink-0 text-faint" />
      </Button>
    </div>

    <div class="mt-5 mb-3 flex items-center gap-2">
      <Icon name="workflows" class="size-4 text-dim" />
      <span class="text-sm text-dim">
        {{ t('tasks.pipeline', { done: progress.doneNodes, total: progress.totalNodes }) }}
      </span>
      <span class="ml-auto text-xs tabular-nums text-faint">{{ progress.pct }}%</span>
    </div>

    <div class="flex flex-col gap-2">
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
// pipeline of phase cards. The detail is rendered inside LibraryView's #detail slot.
import { computed, onMounted } from 'vue'
import Icon from '~/components/Icon.vue'
import TaskPhaseCard from '~/components/task/TaskPhaseCard.vue'
import TaskSourceBadge from '~/components/task/TaskSourceBadge.vue'
import { useI18n } from '~/composables/useI18n'
import { useTasksStore, type Task, type TaskPhase } from '~/stores/tasks'
import { useSessionsStore } from '~/stores/sessions'
import { useSessionTaskLink } from '~/composables/useSessionTaskLink'
import { useMinimizeDock } from '~/composables/useMinimizeDock'
import Button from '~/components/ui/button/Button.vue'

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
  if (props.task.status === 'running') return 'border-primary/40 bg-primary/10 text-primary'
  if (
    props.task.status === 'waiting_approval' ||
    props.task.status === 'waiting_connection' ||
    props.task.status === 'paused'
  )
    return 'border-warning/40 text-warning'
  return 'text-muted-foreground'
})

const formattedTime = computed(() => {
  const ms = Date.parse(props.task.createdAt)
  if (Number.isNaN(ms)) return ''
  return new Date(ms).toLocaleString()
})
</script>
