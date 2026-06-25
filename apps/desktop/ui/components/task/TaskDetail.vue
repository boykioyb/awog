<template>
  <div ref="scrollEl" class="flex-1 overflow-y-auto">
    <div class="px-4 md:px-6 py-4 md:py-5" :style="{ borderBottom: `1px solid ${t.border}` }">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-[1em] font-mono" :style="{ color: t.textDim }">{{ task.id }}</span>
        <span :style="{ color: t.textFaint }">·</span>
        <span class="text-[1em]" :style="{ color: t.textDim }">
          {{ formatTime(task.createdAt) }}
        </span>
        <div
          class="ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12px] font-medium leading-none"
          :style="{ background: statusBg, color: statusColor, border: `1px solid ${statusBorder}` }"
        >
          <component
            :is="StatusIcon"
            :size="11"
            :class="task.status === 'running' ? 'animate-pulse' : ''"
            :style="{ fill: task.status === 'completed' ? 'currentColor' : 'none' }"
          />
          {{ meta.label }}
        </div>
        <button
          v-if="task.status === 'running'"
          class="p-1.5 rounded-lg transition"
          :style="{
            background: actionHover ? t.bgHover : 'transparent',
            color: actionHover ? t.text : t.textDim,
          }"
          title="Pause task"
          @click="tasksStore.pauseTask(task.id)"
          @mouseenter="actionHover = true"
          @mouseleave="actionHover = false"
        >
          <Pause :size="13" />
        </button>
        <button
          v-if="task.status === 'paused'"
          class="p-1.5 rounded-lg transition"
          :style="{
            background: actionHover ? t.bgHover : 'transparent',
            color: actionHover ? t.text : t.textDim,
          }"
          title="Resume task"
          @click="tasksStore.resumeTask(task.id)"
          @mouseenter="actionHover = true"
          @mouseleave="actionHover = false"
        >
          <Play :size="13" />
        </button>
        <button
          v-if="isActive"
          class="p-1.5 rounded-lg transition"
          :style="{
            background: stopHover ? t.dangerBg : 'transparent',
            color: stopHover ? t.danger : t.textDim,
          }"
          title="Stop task"
          @click="tasksStore.cancelTask(task.id)"
          @mouseenter="stopHover = true"
          @mouseleave="stopHover = false"
        >
          <CircleStop :size="13" />
        </button>
        <button
          class="p-1.5 rounded-lg transition"
          :style="{
            background: deleteHover ? t.dangerBg : 'transparent',
            color: deleteHover ? t.danger : t.textDim,
          }"
          title="Delete task"
          @click="emit('delete')"
          @mouseenter="deleteHover = true"
          @mouseleave="deleteHover = false"
        >
          <Trash2 :size="13" />
        </button>
      </div>
      <h1 class="text-xl font-semibold mb-2" :style="{ color: t.text }">{{ task.title }}</h1>
      <div class="flex items-center gap-3 text-[1em] flex-wrap" :style="{ color: t.textMuted }">
        <template v-if="project">
          <div class="inline-flex items-center gap-1.5">
            <FolderGit2 :size="11" />
            <span :style="{ color: t.text }">{{ project.name }}</span>
            <span class="font-mono text-[1em]" :style="{ color: t.textDim }">
              {{ project.path }}
            </span>
          </div>
          <span :style="{ color: t.textFaint }">·</span>
        </template>
        <TaskSourceBadge :source="task.source" />
        <span :style="{ color: t.textFaint }">·</span>
        <div class="inline-flex items-center gap-1">
          <Workflow :size="11" />
          {{ workflow?.name }}
        </div>
      </div>
      <div class="mt-3 text-[1em] leading-relaxed" :style="{ color: t.textMuted }">
        {{ task.description }}
      </div>
    </div>
    <div class="px-4 md:px-6 py-4">
      <div
        class="text-[1em] uppercase tracking-wider font-medium mb-3"
        :style="{ color: t.textDim }"
      >
        Pipeline
      </div>
      <div class="space-y-2">
        <template v-for="(nodeId, idx) in order" :key="nodeId">
          <PhaseCard
            v-if="task.phases[nodeId] && nodeFor(nodeId)"
            :task-id="task.id"
            :phase="task.phases[nodeId]"
            :node="nodeFor(nodeId)!"
            :agent="agentFor(nodeId)"
            :skill="skillFor(nodeId)"
            :index="idx + 1"
            :is-last="idx === order.length - 1"
            :task-status="task.status"
            @approve="tasksStore.approvePhase(task.id, nodeId)"
            @rerun="(instr) => tasksStore.rerunFromPhase(task.id, nodeId, instr)"
            @send-message="
              (runVersion, text) => tasksStore.sendMessageToPhase(task.id, nodeId, runVersion, text)
            "
            @open-file="(fileName, content) => emit('open-file', fileName, content)"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CircleStop, FolderGit2, Pause, Play, Workflow, Trash2 } from 'lucide-vue-next'
import type { Agent, Task } from '~/types'
import { STATUS_META } from '~/utils/status-meta'
import { topoSort } from '~/utils/graph'
import { formatTime } from '~/utils/time'

const props = defineProps<{
  task: Task
}>()

const emit = defineEmits<{
  'open-file': [fileName: string, content: string]
  delete: []
}>()

const deleteHover = ref(false)
const stopHover = ref(false)
const actionHover = ref(false)

const { t } = useTheme()
const store = useWorkspaceStore()
const tasksStore = useTasksStore()
const workflowsStore = useWorkflowsStore()

// Prefer the task's workflow snapshot (what actually executes) over the live
// workflow, which may have been edited since the task started.
const workflow = computed(
  () => props.task.workflowSnapshot ?? workflowsStore.workflowById(props.task.workflowId),
)
const project = computed(() => store.projectById(props.task.projectId))

const meta = computed(() => STATUS_META[props.task.status])
const StatusIcon = computed(() => meta.value.icon)

// Task can be stopped while it's queued/running/waiting for approval.
const isActive = computed(
  () =>
    props.task.status === 'running' ||
    props.task.status === 'waiting_approval' ||
    props.task.status === 'queued' ||
    props.task.status === 'paused',
)

const statusColor = computed(() => {
  if (props.task.status === 'running') return t.value.text
  if (props.task.status === 'waiting_approval') return t.value.warning
  if (props.task.status === 'completed') return t.value.success
  if (props.task.status === 'failed') return t.value.danger
  return t.value.textDim
})
const statusBg = computed(() => {
  if (props.task.status === 'waiting_approval') return t.value.warningBg
  if (props.task.status === 'failed') return t.value.dangerBg
  return t.value.bgInput
})
const statusBorder = computed(() => {
  if (props.task.status === 'waiting_approval') return t.value.warningBorder
  return t.value.border
})

const order = computed(() =>
  workflow.value ? topoSort(workflow.value.nodes, workflow.value.edges) : [],
)

const nodeFor = (nodeId: string) => workflow.value?.nodes.find((n) => n.id === nodeId)
// Always return an Agent so the phase renders even when agents aren't hydrated
// yet (or the referenced agent was deleted) — fall back to a stub from the node.
const agentFor = (nodeId: string): Agent => {
  const node = nodeFor(nodeId)
  const found = node ? store.agentById(node.agentId) : undefined
  if (found) return found
  const id = node?.agentId ?? nodeId
  return {
    id,
    source: node?.agentSource ?? 'global',
    name: id,
    description: '',
    provider: 'anthropic',
    model: '',
    systemPrompt: '',
    role: '',
  }
}
const skillFor = (nodeId: string) => {
  const node = nodeFor(nodeId)
  return node ? store.skillById(node.skillId) : undefined
}

// Persist the detail scroll position per task so it's restored after the user opens the
// fullscreen artifact editor and returns (the page unmounts in between). Phase expand/tab
// state is persisted separately in the store via PhaseCard.
const scrollEl = ref<HTMLElement | null>(null)

const restoreScroll = (taskId: string) => {
  nextTick(() => {
    if (scrollEl.value) scrollEl.value.scrollTop = tasksStore.detailScrollFor(taskId)
  })
}
const saveScroll = (taskId: string) => {
  if (scrollEl.value) tasksStore.setDetailScroll(taskId, scrollEl.value.scrollTop)
}

onMounted(() => restoreScroll(props.task.id))
onBeforeUnmount(() => saveScroll(props.task.id))
// Switching the selected task reuses this instance (no remount) — save the outgoing
// task's scroll and restore the incoming one.
watch(
  () => props.task.id,
  (newId, oldId) => {
    if (oldId) saveScroll(oldId)
    restoreScroll(newId)
  },
)
</script>
