<template>
  <!-- Session-level pinned todo panel. Unlike the per-message inline checklist
       (removed), this derives the LATEST TodoWrite across all turns and renders
       it once, docked above the composer — so it stays visible while scrolling a
       long reply (it lives outside the message scroll container) AND keeps
       updating across cancel/resume turn boundaries (it tracks the newest todo
       step, not a single frozen bubble). Auto-hidden when there are no todos or
       all are complete. -->
  <div
    v-if="visible"
    class="px-4 md:px-6 py-2 flex-shrink-0"
    :style="{ background: t.bgSubtle, borderTop: `1px solid ${t.border}` }"
  >
    <button
      type="button"
      class="w-full flex items-center gap-1.5 select-none"
      :style="{ color: t.textDim }"
      :title="collapsed ? tr('session.todos.expand') : tr('session.todos.collapse')"
      @click="collapsed = !collapsed"
    >
      <component :is="collapsed ? ChevronRight : ChevronDown" :size="13" class="flex-shrink-0" />
      <ListChecks :size="12" class="flex-shrink-0" :style="{ color: t.accent }" />
      <span class="uppercase tracking-wider font-semibold text-[1em]">
        {{ tr('session.todos.title') }}
      </span>
      <span
        class="font-mono leading-none text-[12px] px-1.5 py-0.5 rounded"
        :style="{ background: t.bgElevated, color: t.textDim, border: `1px solid ${t.border}` }"
      >
        {{ done }}/{{ total }}
      </span>
    </button>

    <div v-if="!collapsed" class="mt-1.5 space-y-0.5 max-h-[180px] overflow-y-auto pr-1">
      <div v-for="(todo, i) in latestTodos" :key="i" class="flex items-start gap-1.5 text-[1em]">
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
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight, ListChecks } from 'lucide-vue-next'
import type { Session, SessionStep, TodoItem, TodoStatus } from '~/types'

const props = defineProps<{
  session: Session
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

// The current plan = the todos from the most recent agent message that emitted a
// TodoWrite (a `kind:'note'` step carrying `todos`). Scanning from the end keeps
// the panel current across turns: a cancel + resume puts the new checklist in a
// new message, and we pick that up automatically instead of freezing on the
// canceled turn's bubble.
const latestTodos = computed<TodoItem[]>(() => {
  const messages = props.session.messages
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const steps = messages[i]?.steps
    if (!steps) continue
    const note = steps.find((s: SessionStep) => s.kind === 'note' && !!s.todos?.length)
    if (note?.todos?.length) return note.todos
  }
  return []
})

const total = computed(() => latestTodos.value.length)
const done = computed(() => latestTodos.value.filter((todo) => todo.status === 'completed').length)

// The panel is a LIVE progress affordance: shown only while a turn is in flight
// (including parked on a question/permission), and hidden once the session goes
// idle. This matters because the model frequently ends a turn leaving the last
// item at `in_progress` instead of emitting a final TodoWrite that marks it
// `completed` — gating on `done < total` alone would strand the panel at e.g.
// "3/4" forever. When idle, the reply text already carries the conclusion, so
// the checklist has no live role; the next turn re-shows it when todos update.
const store = useSessionsStore()
const isRunning = computed(() => store.isSessionStreaming(props.session.id))
// Also hidden when there's nothing to do or every item is already checked.
const visible = computed(() => isRunning.value && total.value > 0 && done.value < total.value)

const collapsed = ref(false)

const TODO_MARK: Record<TodoStatus, string> = { pending: '○', in_progress: '▸', completed: '✓' }
const todoMark = (status: TodoStatus): string => TODO_MARK[status]
const todoColor = (status: TodoStatus): string => {
  if (status === 'completed') return t.value.success
  if (status === 'in_progress') return t.value.accent
  return t.value.textDim
}
</script>
