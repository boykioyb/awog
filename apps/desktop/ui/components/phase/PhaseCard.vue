<template>
  <div
    class="rounded-md"
    :style="{
      background: t.bgElevated,
      border: `1px solid ${
        phase.status === 'running' || phase.status === 'waiting_approval'
          ? t.borderStrong
          : t.border
      }`,
    }"
  >
    <button
      class="w-full px-3 py-2.5 flex items-center gap-3 transition text-left"
      :style="{
        cursor: isInteractive ? 'pointer' : 'default',
        background: headerHover && isInteractive ? t.bgHover : 'transparent',
      }"
      @click="isInteractive && (expanded = !expanded)"
      @mouseenter="headerHover = true"
      @mouseleave="headerHover = false"
    >
      <div class="flex items-center gap-2 flex-shrink-0" :style="{ minWidth: '32px' }">
        <span class="text-[1em] font-mono" :style="{ color: t.textFaint }">
          {{ String(index).padStart(2, '0') }}
        </span>
        <component
          :is="StatusIcon"
          :size="13"
          :class="phase.status === 'running' ? 'animate-pulse' : ''"
          :style="{
            color: statusColor,
            fill: phase.status === 'completed' ? statusColor : 'none',
          }"
        />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-[1em] font-medium truncate" :style="{ color: t.text }">
            {{ agent.name }}
          </span>
          <span
            class="text-[1em] uppercase tracking-wider font-semibold flex-shrink-0 px-1 py-0.5 rounded"
            :style="{
              color: t.textMuted,
              background: t.bgInput,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ agent.role }}
          </span>
        </div>
        <div class="text-[1em] font-mono" :style="{ color: t.textDim }">
          {{ phase.skillName }}
        </div>
      </div>
      <span
        v-if="phase.runs.length > 1"
        class="text-[1em] px-1.5 py-0.5 rounded"
        :style="{
          background: t.bgInput,
          color: t.textDim,
          border: `1px solid ${t.border}`,
        }"
      >
        v{{ latestRun!.version }} of {{ phase.runs.length }}
      </span>
      <span
        v-if="phase.status === 'waiting_approval'"
        class="text-[1em] px-1.5 py-0.5 rounded"
        :style="{
          background: t.warningBg,
          color: t.warning,
          border: `1px solid ${t.warningBorder}`,
        }"
      >
        Approval needed
      </span>
      <span
        v-if="phase.status === 'running' && currentRun"
        class="text-[1em] inline-flex items-center gap-1"
        :style="{ color: t.textDim }"
      >
        <Activity :size="10" class="animate-pulse" />
        Live
      </span>
      <span v-if="currentRun?.duration" class="text-[1em] font-mono" :style="{ color: t.textDim }">
        {{ currentRun.duration }}
      </span>
      <ChevronDown
        v-if="isInteractive"
        :size="14"
        class="transition-transform"
        :style="{
          color: t.textDim,
          transform: expanded ? 'rotate(180deg)' : 'none',
        }"
      />
    </button>

    <div v-if="expanded && currentRun" :style="{ borderTop: `1px solid ${t.border}` }">
      <div
        v-if="phase.runs.length > 1"
        class="px-3 py-2 flex items-center gap-2 overflow-x-auto"
        :style="{
          borderBottom: `1px solid ${t.border}`,
          background: t.bgSubtle,
        }"
      >
        <History :size="11" :style="{ color: t.textDim }" />
        <span
          class="text-[1em] uppercase tracking-wider font-medium flex-shrink-0"
          :style="{ color: t.textDim }"
        >
          History
        </span>
        <button
          v-for="r in phase.runs"
          :key="r.version"
          class="text-[1em] px-2 py-0.5 rounded transition flex items-center gap-1 flex-shrink-0"
          :style="{
            background:
              (selectedRunVersion || latestRun!.version) === r.version ? t.bgActive : 'transparent',
            color:
              r.status === 'superseded'
                ? t.textFaint
                : (selectedRunVersion || latestRun!.version) === r.version
                  ? t.text
                  : t.textMuted,
            border: `1px solid ${
              (selectedRunVersion || latestRun!.version) === r.version ? t.borderStrong : t.border
            }`,
            textDecoration: r.status === 'superseded' ? 'line-through' : 'none',
          }"
          @click.stop="selectedRunVersion = r.version"
        >
          v{{ r.version }}
          <RotateCcw v-if="r.triggeredBy === 'rerun'" :size="8" />
        </button>
      </div>

      <div
        class="px-3 flex items-center gap-3"
        :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgSubtle }"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="py-2 flex items-center gap-1.5 text-[1em] transition"
          :style="{
            color: activeTab === tab.id ? t.text : t.textDim,
            borderBottom: `1.5px solid ${activeTab === tab.id ? t.text : 'transparent'}`,
            marginBottom: '-1px',
          }"
          @click.stop="activeTab = tab.id"
        >
          <component :is="tab.icon" :size="11" />
          {{ tab.label }}
          <span
            v-if="tab.badge != null"
            class="px-1 py-0 text-[1em] rounded"
            :style="{
              background: t.bgInput,
              color: t.textDim,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ tab.badge }}
          </span>
        </button>
        <div class="ml-auto flex items-center gap-1">
          <button
            v-if="phase.status === 'waiting_approval'"
            class="px-2 py-1 text-[1em] rounded font-medium transition"
            :style="{ background: t.accent, color: t.accentText }"
            @click.stop="emit('approve')"
          >
            Approve
          </button>
          <button
            v-if="canRerun"
            class="px-2 py-1 text-[1em] rounded transition inline-flex items-center gap-1"
            :style="{
              color: t.text,
              border: `1px solid ${t.borderStrong}`,
              background: rerunHover ? t.bgHover : 'transparent',
            }"
            @click.stop="showRerunModal = true"
            @mouseenter="rerunHover = true"
            @mouseleave="rerunHover = false"
          >
            <RotateCcw :size="10" />
            Rerun from here
          </button>
        </div>
      </div>

      <div class="p-3">
        <PhaseOutputTab
          v-if="activeTab === 'output'"
          :run="currentRun"
          :node="node"
          :phase="phase"
          @open-file="(f, c) => emit('open-file', f, c)"
        />
        <PhaseTraceTab v-else-if="activeTab === 'trace'" :trace="currentRun.trace" />
        <PhaseDiscussTab
          v-else-if="activeTab === 'discuss'"
          :run="currentRun"
          :agent="agent"
          @send="(text) => emit('send-message', currentRun!.version, text)"
        />
      </div>
    </div>

    <RerunModal
      v-if="showRerunModal"
      :phase="phase"
      :agent="agent"
      @confirm="onRerunConfirm"
      @cancel="showRerunModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { Activity, ChevronDown, History, RotateCcw, FileText, MessageSquare } from 'lucide-vue-next'
import type { Phase, WorkflowNode, Agent, Skill, TaskStatus } from '~/types'
import { STATUS_META } from '~/utils/status-meta'
import { countTraceItems } from '~/utils/mock-output'

const props = defineProps<{
  phase: Phase
  node: WorkflowNode
  agent: Agent
  skill: Skill | undefined
  index: number
  isLast: boolean
  taskStatus: TaskStatus
}>()

const emit = defineEmits<{
  approve: []
  rerun: [instruction: string]
  'send-message': [runVersion: number, text: string]
  'open-file': [fileName: string, content: string]
}>()

const { t } = useTheme()

const expanded = ref(props.phase.status === 'running' || props.phase.status === 'waiting_approval')
const activeTab = ref<'output' | 'trace' | 'discuss'>('output')
const selectedRunVersion = ref<number | null>(null)
const showRerunModal = ref(false)
const headerHover = ref(false)
const rerunHover = ref(false)

const latestRun = computed(() => props.phase.runs[props.phase.runs.length - 1])
const currentRun = computed(() =>
  selectedRunVersion.value
    ? props.phase.runs.find((r) => r.version === selectedRunVersion.value)
    : latestRun.value,
)

const meta = computed(() => STATUS_META[props.phase.status])
const StatusIcon = computed(() => meta.value.icon)

const statusColor = computed(() => {
  if (props.phase.status === 'running') return t.value.text
  if (props.phase.status === 'waiting_approval') return t.value.warning
  if (props.phase.status === 'completed') return t.value.success
  return t.value.textFaint
})

const isInteractive = computed(() => props.phase.runs.length > 0)
const canRerun = computed(
  () =>
    props.phase.runs.length > 0 &&
    (props.phase.status === 'completed' ||
      props.phase.status === 'waiting_approval' ||
      props.taskStatus === 'completed'),
)

const tabs = computed(() => [
  { id: 'output' as const, label: 'Output', icon: FileText, badge: null as number | null },
  {
    id: 'trace' as const,
    label: 'Execution',
    icon: Activity,
    badge: currentRun.value ? countTraceItems(currentRun.value.trace) : 0,
  },
  {
    id: 'discuss' as const,
    label: 'Discussion',
    icon: MessageSquare,
    badge: currentRun.value?.messages.length || null,
  },
])

const onRerunConfirm = (instruction: string) => {
  emit('rerun', instruction)
  showRerunModal.value = false
}
</script>
