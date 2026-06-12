<template>
  <div v-if="step.kind === 'group'" class="text-[1em]">
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
        class="inline-flex items-center justify-center text-[1em] px-1.5 rounded-sm font-mono"
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
      <StepItem v-for="child in step.children" :key="child.id" :step="child" :timeline="timeline" />
    </div>
  </div>

  <div v-else-if="step.kind === 'thinking'" class="text-[1em] min-w-0">
    <!-- Reasoning streams live in `detail` (full text, growing). The row is a
         collapse toggle: expanded while thinking (status running) so the user
         watches it like the Claude extension, then auto-collapses when done. -->
    <button
      v-if="thinkingDetail"
      type="button"
      class="flex items-center gap-1.5 w-full text-left min-w-0 transition"
      @click="collapsed = !collapsed"
    >
      <Loader2
        v-if="thinkingActive"
        :size="11"
        class="flex-shrink-0 animate-spin"
        :style="{ color: t.textDim }"
      />
      <Brain v-else :size="11" class="flex-shrink-0" :style="{ color: t.textDim }" />
      <span class="italic min-w-0" :class="{ truncate: collapsed }" :style="{ color: t.textMuted }">
        {{ collapsed ? step.label : thinkingActive ? 'Thinking…' : 'Reasoning' }}
      </span>
      <ChevronDown
        :size="10"
        class="flex-shrink-0 ml-auto"
        :style="{
          color: t.textDim,
          transform: collapsed ? 'rotate(-90deg)' : 'none',
          transition: 'transform 0.15s',
        }"
      />
    </button>
    <div v-else class="flex items-center gap-1.5 min-w-0">
      <Loader2
        v-if="thinkingActive"
        :size="11"
        class="flex-shrink-0 animate-spin"
        :style="{ color: t.textDim }"
      />
      <Brain v-else :size="11" class="flex-shrink-0" :style="{ color: t.textDim }" />
      <span class="italic truncate min-w-0" :style="{ color: t.textMuted }">{{ step.label }}</span>
    </div>
    <div
      v-if="thinkingDetail && !collapsed"
      class="mt-1 whitespace-pre-wrap italic text-[1em] leading-relaxed"
      :style="{ color: t.textMuted, paddingLeft: '18px' }"
    >
      {{ thinkingDetail }}
    </div>
  </div>

  <!-- Todo checklist (TodoWrite). Rendered inline + always expanded so it reads
       as the agent's live progress, not a click-to-open row. -->
  <div v-else-if="step.kind === 'note'" class="text-[1em] min-w-0">
    <div class="flex items-center gap-1.5 mb-1" :style="{ color: t.textDim }">
      <ListChecks :size="11" class="flex-shrink-0" :style="{ color: t.accent }" />
      <span class="uppercase tracking-wider font-semibold">{{ step.label }}</span>
    </div>
    <div v-if="step.todos?.length" class="space-y-0.5">
      <div v-for="(todo, i) in step.todos" :key="i" class="flex items-start gap-1.5">
        <span
          class="font-mono flex-shrink-0"
          :style="{ color: todoColor(todo.status), paddingTop: '1px' }"
        >
          {{ todoMark(todo.status) }}
        </span>
        <span
          class="min-w-0 break-words"
          :style="{
            color: todo.status === 'completed' ? t.textFaint : t.text,
            textDecoration: todo.status === 'completed' ? 'line-through' : 'none',
          }"
        >
          {{ todo.content }}
        </span>
      </div>
    </div>
    <!-- Fallback for legacy note steps persisted before structured todos. -->
    <div
      v-else-if="noteFallbackText"
      class="whitespace-pre-wrap leading-relaxed"
      :style="{ color: t.textMuted }"
    >
      {{ noteFallbackText }}
    </div>
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
        <div class="text-[1em] font-semibold flex items-center gap-1.5" :style="{ color: t.text }">
          Proposed plan
          <span
            class="text-[1em] px-1.5 py-0.5 rounded uppercase tracking-wider font-medium"
            :style="{
              background: planAccent.bg,
              color: planAccent.accent,
              border: `1px solid ${planAccent.border}`,
            }"
          >
            {{ planStatusLabel }}
          </span>
        </div>
      </div>
    </div>
    <!-- Plan body: render the RAW markdown as a document (headers / nested lists
         / bold preserved) so it reads as a plan, not a flat todo list. Older
         steps without planMarkdown fall back to the flattened numbered list. -->
    <div
      v-if="step.planMarkdown"
      class="px-3 py-2 awog-md text-[1em]"
      :style="{ color: t.text, '--awog-accent': t.accent }"
    >
      <MarkdownRenderer :content="step.planMarkdown" />
    </div>
    <template v-else>
      <ol class="px-3 py-2 space-y-1 list-none">
        <li
          v-for="(parts, idx) in planItemParts"
          :key="idx"
          class="flex gap-2 text-[1em] leading-relaxed"
          :style="{ color: t.text }"
        >
          <span
            class="inline-flex items-center justify-center min-w-[16px] h-4 px-1 mt-0.5 rounded-full flex-shrink-0 text-[10px] font-semibold font-mono leading-none"
            :style="{
              background: t.bgInput,
              color: t.accent,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ idx + 1 }}
          </span>
          <span class="flex-1 min-w-0"><MarkdownInline :parts="parts" /></span>
        </li>
      </ol>
      <div
        v-if="step.planRationale"
        class="px-3 py-2 text-[1em] italic"
        :style="{ color: t.textMuted, borderTop: `1px solid ${t.border}` }"
      >
        <MarkdownInline :parts="parseInline(step.planRationale || '')" />
      </div>
    </template>
    <div
      v-if="resolvePlan && (!step.planStatus || step.planStatus === 'pending')"
      class="px-3 py-2 flex items-center gap-1.5"
      :style="{ borderTop: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <button
        type="button"
        class="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[1em] font-medium transition"
        :style="{ background: t.accent, color: t.accentText }"
        @click="resolvePlan(step.id, 'approve')"
      >
        <Check :size="11" />
        Approve & execute
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[1em] transition"
        :style="{
          background: 'transparent',
          color: t.textDim,
          border: `1px solid ${t.border}`,
        }"
        @click="resolvePlan(step.id, 'reject')"
      >
        <X :size="11" />
        Reject
      </button>
      <span class="ml-auto text-[1em]" :style="{ color: t.textFaint }">
        Plan mode · sẽ không sửa file đến khi approve
      </span>
    </div>
  </div>

  <div v-else>
    <button
      type="button"
      class="flex gap-1.5 text-[1em] min-w-0 w-full text-left rounded py-0.5 px-1 -mx-1 transition"
      :class="timeline ? 'items-start flex-wrap' : 'items-center'"
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
      <component
        :is="statusIcon"
        :size="11"
        class="flex-shrink-0"
        :class="statusClass"
        :style="{ color: statusColor }"
      />
      <component :is="toolIcon" :size="11" class="flex-shrink-0" :style="{ color: t.textMuted }" />
      <span
        class="min-w-0"
        :class="timeline ? 'break-words' : 'truncate'"
        :style="{ color: t.text }"
      >
        {{ step.label }}
      </span>

      <span
        v-if="step.children?.length"
        class="inline-flex items-center justify-center text-[1em] px-1.5 rounded-sm font-mono"
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
        class="inline-flex items-center px-1 rounded-sm font-mono text-[1em]"
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
        class="inline-flex items-center px-1 rounded-sm font-mono text-[1em]"
        :style="{ background: t.dangerBg, color: t.danger, border: `1px solid ${t.dangerBorder}` }"
      >
        {{ step.deletions }}
      </span>

      <span
        v-if="step.target"
        class="px-1.5 rounded-sm font-mono text-[1em] min-w-0"
        :class="timeline ? 'break-all' : 'truncate'"
        :style="{
          background: t.bgInput,
          color: t.text,
          border: `1px solid ${t.border}`,
          maxWidth: timeline ? '100%' : '50%',
        }"
      >
        {{ step.target }}
      </span>

      <span v-if="step.description" :style="{ color: t.textFaint }">·</span>
      <span
        v-if="step.description"
        class="min-w-0"
        :class="timeline ? 'break-words' : 'flex-1 truncate'"
        :style="{ color: t.textMuted }"
      >
        {{ step.description }}
      </span>

      <span
        v-if="step.pathHint"
        class="font-mono text-[1em]"
        :class="timeline ? 'break-all' : 'truncate ml-auto'"
        :style="{ color: t.textFaint, maxWidth: timeline ? '100%' : '38%' }"
      >
        {{ step.pathHint }}
      </span>
    </button>

    <!-- Result summary (⎿), timeline variant only. Short gist of the tool result;
         the full output is still one click away via the row's detail panel. -->
    <div
      v-if="timeline && step.kind === 'tool' && resultSummary"
      class="flex items-start gap-1.5 mt-0.5 text-[1em]"
      :style="{ paddingLeft: '3px' }"
    >
      <span class="flex-shrink-0 font-mono" :style="{ color: t.textDim }">⎿</span>
      <span
        class="min-w-0 break-words"
        :style="{ color: step.status === 'error' ? t.danger : t.textFaint }"
      >
        {{ resultSummary }}
      </span>
    </div>

    <div
      v-if="step.children?.length && !collapsed"
      class="mt-0.5 space-y-0.5"
      :style="{
        paddingLeft: '18px',
        borderLeft: `1px dashed ${t.border}`,
        marginLeft: '6px',
      }"
    >
      <StepItem v-for="child in step.children" :key="child.id" :step="child" :timeline="timeline" />
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
  Save,
  Search,
  Sparkles,
  Terminal,
  X,
} from 'lucide-vue-next'
import type { SessionStep, TodoStatus } from '~/types'
import { parseInline } from '~/utils/markdown-parse'
import { RESOLVE_PLAN_KEY, SELECT_STEP_KEY, SELECTED_STEP_ID_KEY } from '~/utils/step-context'

const props = withDefaults(
  defineProps<{
    step: SessionStep
    // Session timeline variant (Claude-Code style): wrap long paths/commands
    // instead of truncating, and show a one-line result summary (⎿) under tool
    // rows. Off by default so the compact task/phase trace + subagent drawer keep
    // their tight single-line rows.
    timeline?: boolean
  }>(),
  { timeline: false },
)

const { t } = useTheme()
// Thinking starts EXPANDED while the reasoning streams (so the user watches it
// live, like the Claude extension) and auto-collapses once done — except a
// reasoning block reloaded already-done starts collapsed. Group/tool steps keep
// the prior default-expanded behaviour.
const collapsed = ref(props.step.kind === 'thinking' && props.step.status === 'done')
const hover = ref(false)

// Full extended-thinking text (newlines preserved), streamed live in `detail`.
const thinkingDetail = computed(() =>
  props.step.detail?.kind === 'text' ? props.step.detail.content : null,
)
// Reasoning still being generated → spinner + keep expanded.
const thinkingActive = computed(
  () => props.step.kind === 'thinking' && props.step.status === 'running',
)

// Todo checklist (kind === 'note'). Marker + color per status; legacy note steps
// (persisted before structured todos) fall back to their detail text.
const TODO_MARK: Record<TodoStatus, string> = { pending: '○', in_progress: '▸', completed: '✓' }
const todoMark = (status: TodoStatus): string => TODO_MARK[status]
const todoColor = (status: TodoStatus): string => {
  if (status === 'completed') return t.value.success
  if (status === 'in_progress') return t.value.accent
  return t.value.textDim
}
const noteFallbackText = computed(() =>
  props.step.kind === 'note' && props.step.detail?.kind === 'text' ? props.step.detail.content : '',
)

// Plan items carry inline markdown (**bold**, `code`) — parse once per render so
// the list renders rich text instead of raw markers.
const planItemParts = computed(() => (props.step.planItems ?? []).map((it) => parseInline(it)))

// One-line result summary for the timeline `⎿` line (session variant only). The
// full result is still one click away (selectStep → detail panel); this is just
// the "Read 240 lines" / "42 passed" gist Claude Code shows inline. Capped so a
// huge first line can't blow up the row — the wrap handles the rest.
const RESULT_SUMMARY_MAX = 200
const resultSummary = computed<string | null>(() => {
  const d = props.step.detail
  if (!d) return null
  let text: string | null = null
  if (d.kind === 'terminal') {
    const out = (d.output ?? '').trim()
    const firstLines = out
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 2)
      .join(' ')
    text = firstLines || (d.exitCode !== undefined ? `exit ${d.exitCode}` : null)
  } else if (d.kind === 'file') {
    const lines = d.content ? d.content.split('\n').length : 0
    text = lines ? `${lines} line${lines === 1 ? '' : 's'}` : d.path || null
  } else if (d.kind === 'list') {
    text = `${d.items.length} result${d.items.length === 1 ? '' : 's'}`
  } else if (d.kind === 'text') {
    text =
      d.content
        .split('\n')
        .find((l) => l.trim())
        ?.trim() ?? null
  }
  if (!text) return null
  return text.length > RESULT_SUMMARY_MAX ? `${text.slice(0, RESULT_SUMMARY_MAX)}…` : text
})

// Auto-collapse the reasoning block the moment it completes (running → done),
// matching the Claude extension. Guarded to thinking so a tool step's
// running → done transition never collapses its children.
watch(
  () => props.step.status,
  (status) => {
    if (props.step.kind === 'thinking' && status === 'done') collapsed.value = true
  },
)

const selectStep = inject(SELECT_STEP_KEY, null)
const selectedStepId = inject(SELECTED_STEP_ID_KEY, ref<string | null>(null))
// Plan-card Approve/Reject. Null outside a session context → the card hides its
// action buttons (read-only render).
const resolvePlan = inject(RESOLVE_PLAN_KEY, null)

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
