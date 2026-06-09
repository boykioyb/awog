<template>
  <div
    class="cursor-pointer transition mx-1.5 my-px rounded"
    :style="{
      background: pill(selected, hovered).background,
      padding: '8px 10px',
    }"
    @click="emit('click')"
    @contextmenu.prevent="emit('context-menu', $event)"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <div class="flex items-center gap-2.5">
      <component
        :is="StatusIcon"
        :size="12"
        :class="task.status === 'running' ? 'animate-pulse' : ''"
        :style="{
          color: statusColor,
          fill: task.status === 'completed' ? statusColor : 'none',
          flexShrink: 0,
        }"
      />
      <div class="flex-1 min-w-0">
        <input
          v-if="renaming"
          :ref="setRenameInputRef"
          :value="renameValue"
          class="text-[1em] leading-tight w-full rounded px-1 py-0.5"
          :style="{
            background: t.bgInput,
            border: `1px solid ${t.borderStrong}`,
            color: t.text,
            outline: 'none',
          }"
          @click.stop
          @input="emit('update:renameValue', ($event.target as HTMLInputElement).value)"
          @keydown.enter="emit('commit-rename')"
          @keydown.escape="emit('cancel-rename')"
          @blur="emit('commit-rename')"
        />
        <div
          v-else
          class="text-[1em] leading-tight truncate"
          :style="{ color: t.text }"
          @dblclick.stop="emit('start-rename')"
        >
          {{ task.title }}
        </div>
        <div v-if="metaText" class="text-[1em] mt-1 truncate" :style="{ color: t.textDim }">
          {{ metaText }}
        </div>
      </div>
      <div
        v-if="isActive && totalCount > 0"
        class="text-[1em] font-mono flex-shrink-0"
        :style="{ color: t.textDim }"
      >
        {{ completedCount }}/{{ totalCount }}
      </div>
      <button
        class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
        :style="{ color: t.textMuted }"
        title="Actions"
        @click.stop="emit('open-menu', $event)"
      >
        <MoreHorizontal :size="13" />
      </button>
    </div>
    <div
      v-if="isActive"
      class="mt-2 h-0.5 rounded-full overflow-hidden"
      :style="{ background: t.border }"
    >
      <div
        class="h-full transition-all duration-500"
        :style="{
          width: `${progress * 100}%`,
          background: task.status === 'waiting_approval' ? t.warning : t.accent,
        }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { MoreHorizontal } from 'lucide-vue-next'
import type { Task } from '~/types'
import { STATUS_META } from '~/utils/status-meta'

const props = withDefaults(
  defineProps<{
    task: Task
    selected: boolean
    groupBy?: string
    renaming?: boolean
    renameValue?: string
  }>(),
  { groupBy: 'project', renaming: false, renameValue: '' },
)

const emit = defineEmits<{
  click: []
  'context-menu': [event: MouseEvent]
  'open-menu': [event: MouseEvent]
  'start-rename': []
  'commit-rename': []
  'cancel-rename': []
  'update:renameValue': [value: string]
}>()

const { t } = useTheme()
const { pill } = useGlass()
const store = useWorkspaceStore()
const workflowsStore = useWorkflowsStore()

const hovered = ref(false)

const workflow = computed(
  () => props.task.workflowSnapshot ?? workflowsStore.workflowById(props.task.workflowId),
)
const project = computed(() => store.projectById(props.task.projectId))

const meta = computed(() => STATUS_META[props.task.status])
const StatusIcon = computed(() => meta.value.icon)

const statusColor = computed(() => {
  if (props.task.status === 'running') return t.value.text
  if (props.task.status === 'waiting_approval') return t.value.warning
  if (props.task.status === 'completed') return t.value.success
  if (props.task.status === 'failed') return t.value.danger
  return t.value.textDim
})

const completedCount = computed(() =>
  workflow.value
    ? Object.values(props.task.phases).filter((p) => p.status === 'completed').length
    : 0,
)
const totalCount = computed(() => workflow.value?.nodes.length || 0)
const progress = computed(() => (totalCount.value ? completedCount.value / totalCount.value : 0))
const isActive = computed(
  () => props.task.status === 'running' || props.task.status === 'waiting_approval',
)

const metaText = computed(() => {
  if (props.groupBy === 'project' && workflow.value) return workflow.value.name
  if (props.groupBy === 'status' && project.value) return project.value.name
  if (props.groupBy === 'workflow' && project.value) return project.value.name
  if (props.groupBy === 'none' && project.value) return project.value.name
  return null
})

const setRenameInputRef = (el: unknown) => {
  if (el instanceof HTMLInputElement) {
    nextTick(() => {
      el.focus()
      el.select()
    })
  }
}
</script>
