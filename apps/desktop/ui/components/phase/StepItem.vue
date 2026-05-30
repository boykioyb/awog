<template>
  <div v-if="step.kind === 'group'" class="text-[0.86em]">
    <button
      class="flex items-center gap-1.5 w-full text-left py-0.5 transition"
      :style="{ color: t.text }"
      @click="collapsed = !collapsed"
    >
      <ChevronDown
        :size="11"
        :style="{
          color: t.textDim,
          transform: collapsed ? 'rotate(-90deg)' : 'none',
          transition: 'transform 0.15s',
        }"
      />
      <span
        v-if="step.children?.length"
        class="inline-flex items-center justify-center text-[0.71em] px-1.5 rounded-sm font-mono"
        :style="{
          background: t.bgInput,
          color: t.textDim,
          border: `1px solid ${t.border}`,
          minWidth: '20px',
          height: '16px',
        }"
      >
        {{ step.children.length }}
      </span>
      <span class="truncate">{{ step.label }}</span>
    </button>
    <div
      v-if="!collapsed && step.children?.length"
      class="mt-0.5 space-y-0.5"
      :style="{ paddingLeft: '22px' }"
    >
      <StepItem v-for="child in step.children" :key="child.id" :step="child" />
    </div>
  </div>

  <div v-else-if="step.kind === 'thinking'" class="flex items-center gap-1.5 text-[0.86em]">
    <Brain :size="11" :style="{ color: t.textDim }" />
    <span class="italic" :style="{ color: t.textMuted }">{{ step.label }}</span>
  </div>

  <div v-else-if="step.kind === 'note'" class="text-[0.86em]" :style="{ color: t.text }">
    {{ step.label }}
  </div>

  <div
    v-else-if="step.kind === 'plan'"
    class="rounded-md"
    :style="{
      background: t.bgSubtle,
      border: `1px solid ${planAccent.border}`,
      borderLeft: `3px solid ${planAccent.accent}`,
    }"
  >
    <div
      class="px-3 py-2 flex items-center gap-2"
      :style="{ borderBottom: `1px solid ${t.border}` }"
    >
      <ListChecks :size="13" :style="{ color: planAccent.accent }" />
      <div class="flex-1 min-w-0">
        <div class="text-[0.86em] font-semibold flex items-center gap-1.5" :style="{ color: t.text }">
          Proposed plan
          <span
            class="text-[0.64em] px-1.5 py-0.5 rounded uppercase tracking-wider font-medium"
            :style="{
              background: planAccent.bg,
              color: planAccent.accent,
              border: `1px solid ${planAccent.border}`,
            }"
          >
            {{ planStatusLabel }}
          </span>
        </div>
        <div v-if="step.label" class="text-[0.79em] mt-0.5" :style="{ color: t.textDim }">
          {{ step.label }}
        </div>
      </div>
    </div>
    <ol class="px-3 py-2 space-y-1 list-none">
      <li
        v-for="(item, idx) in step.planItems"
        :key="idx"
        class="flex gap-2 text-[0.86em] leading-relaxed"
        :style="{ color: t.text }"
      >
        <span
          class="inline-flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 text-[0.71em] font-semibold"
          :style="{
            background: planAccent.bg,
            color: planAccent.accent,
            border: `1px solid ${planAccent.border}`,
          }"
        >
          {{ idx + 1 }}
        </span>
        <span class="flex-1 min-w-0">{{ item }}</span>
      </li>
    </ol>
    <div
      v-if="step.planRationale"
      class="px-3 py-2 text-[0.79em] italic"
      :style="{ color: t.textMuted, borderTop: `1px solid ${t.border}` }"
    >
      {{ step.planRationale }}
    </div>
    <div
      v-if="!step.planStatus || step.planStatus === 'pending'"
      class="px-3 py-2 flex items-center gap-1.5"
      :style="{ borderTop: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <button
        class="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[0.79em] font-medium transition"
        :style="{ background: t.accent, color: t.accentText }"
      >
        <Check :size="11" />
        Approve & execute
      </button>
      <button
        class="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[0.79em] transition"
        :style="{
          background: 'transparent',
          color: t.text,
          border: `1px solid ${t.border}`,
        }"
      >
        <Pencil :size="11" />
        Edit plan
      </button>
      <button
        class="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[0.79em] transition"
        :style="{
          background: 'transparent',
          color: t.textDim,
          border: `1px solid ${t.border}`,
        }"
      >
        <X :size="11" />
        Reject
      </button>
      <span class="ml-auto text-[0.71em]" :style="{ color: t.textFaint }">
        Plan mode · sẽ không sửa file đến khi approve
      </span>
    </div>
  </div>

  <div v-else>
    <button
      type="button"
      class="flex items-center gap-1.5 text-[0.86em] min-w-0 w-full text-left rounded py-0.5 px-1 -mx-1 transition"
      :style="{
        background: isSelected ? t.bgActive : hover && step.detail ? t.bgHover : 'transparent',
        cursor: step.detail || step.children?.length ? 'pointer' : 'default',
      }"
      :disabled="!step.detail && !step.children?.length"
      @mouseenter="hover = true"
      @mouseleave="hover = false"
      @click="onClick"
    >
      <component
        :is="ChevronDown"
        v-if="step.children?.length"
        :size="10"
        :style="{
          color: t.textDim,
          transform: collapsed ? 'rotate(-90deg)' : 'none',
          transition: 'transform 0.15s',
          flexShrink: 0,
        }"
      />
      <component :is="statusIcon" :size="11" :class="statusClass" :style="{ color: statusColor }" />
      <component :is="toolIcon" :size="11" class="flex-shrink-0" :style="{ color: t.textMuted }" />
      <span :style="{ color: t.text }">{{ step.label }}</span>

      <span
        v-if="step.children?.length"
        class="inline-flex items-center justify-center text-[0.71em] px-1.5 rounded-sm font-mono"
        :style="{
          background: t.bgInput,
          color: t.textDim,
          border: `1px solid ${t.border}`,
          minWidth: '20px',
          height: '16px',
        }"
        :title="`${step.children.length} nested step(s)`"
      >
        {{ step.children.length }}
      </span>

      <span
        v-if="step.additions !== undefined"
        class="inline-flex items-center px-1 rounded-sm font-mono text-[0.71em]"
        :style="{
          background: 'rgba(34, 197, 94, 0.12)',
          color: '#22c55e',
          border: '1px solid rgba(34, 197, 94, 0.35)',
        }"
      >
        {{ step.additions }}
      </span>
      <span
        v-if="step.deletions !== undefined"
        class="inline-flex items-center px-1 rounded-sm font-mono text-[0.71em]"
        :style="{ background: t.dangerBg, color: t.danger, border: `1px solid ${t.dangerBorder}` }"
      >
        {{ step.deletions }}
      </span>

      <span
        v-if="step.target"
        class="inline-flex items-center px-1.5 rounded-sm font-mono text-[0.71em]"
        :style="{
          background: t.bgInput,
          color: t.text,
          border: `1px solid ${t.border}`,
        }"
      >
        {{ step.target }}
      </span>

      <span v-if="step.description" :style="{ color: t.textFaint }">·</span>
      <span v-if="step.description" class="flex-1 min-w-0 truncate" :style="{ color: t.textMuted }">
        {{ step.description }}
      </span>

      <span
        v-if="step.pathHint"
        class="font-mono text-[0.71em] truncate ml-auto"
        :style="{ color: t.textFaint, maxWidth: '38%' }"
      >
        {{ step.pathHint }}
      </span>
    </button>
    <div
      v-if="step.children?.length && !collapsed"
      class="mt-0.5 space-y-0.5"
      :style="{
        paddingLeft: '18px',
        borderLeft: `1px dashed ${t.border}`,
        marginLeft: '6px',
      }"
    >
      <StepItem v-for="child in step.children" :key="child.id" :step="child" />
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Edit3,
  FileText,
  FolderSearch,
  ListChecks,
  Loader2,
  Pencil,
  Save,
  Search,
  Sparkles,
  Terminal,
  X,
} from 'lucide-vue-next'
import type { SessionStep } from '~/types'
import { SELECT_STEP_KEY, SELECTED_STEP_ID_KEY } from '~/utils/step-context'

const props = defineProps<{
  step: SessionStep
}>()

const { t } = useTheme()
const collapsed = ref(false)
const hover = ref(false)

const selectStep = inject(SELECT_STEP_KEY, null)
const selectedStepId = inject(SELECTED_STEP_ID_KEY, ref<string | null>(null))

const isSelected = computed(() => selectedStepId.value === props.step.id)

const onClick = () => {
  // Children present → click is a collapse toggle. Detail (when present) is
  // still available via the parent select via SELECT_STEP_KEY for deep dives.
  if (props.step.children?.length) {
    collapsed.value = !collapsed.value
    return
  }
  if (!props.step.detail) return
  selectStep?.(props.step)
}

const TOOL_ICONS = {
  read: FileText,
  write: Sparkles,
  edit: Edit3,
  save: Save,
  search: Search,
  'find-files': FolderSearch,
  terminal: Terminal,
  task: Sparkles,
} as const

const toolIcon = computed(() => (props.step.tool ? TOOL_ICONS[props.step.tool] : FileText))

const statusIcon = computed(() => {
  if (props.step.status === 'error') return CircleAlert
  if (props.step.status === 'running') return Loader2
  return CheckCircle2
})

const statusColor = computed(() => {
  if (props.step.status === 'error') return t.value.danger
  if (props.step.status === 'running') return t.value.textDim
  return t.value.success
})

const statusClass = computed(() => (props.step.status === 'running' ? 'animate-spin' : ''))

const planAccent = computed(() => {
  if (props.step.planStatus === 'approved') {
    return {
      accent: '#22c55e',
      bg: 'rgba(34, 197, 94, 0.10)',
      border: 'rgba(34, 197, 94, 0.35)',
    }
  }
  if (props.step.planStatus === 'rejected') {
    return { accent: t.value.danger, bg: t.value.dangerBg, border: t.value.dangerBorder }
  }
  return { accent: t.value.warning, bg: t.value.warningBg, border: t.value.warningBorder }
})

const planStatusLabel = computed(() => {
  if (props.step.planStatus === 'approved') return 'Approved'
  if (props.step.planStatus === 'rejected') return 'Rejected'
  return 'Pending review'
})
</script>
