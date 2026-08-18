import type { Session, StepBlock, Todo } from '~/composables/useSessionsData'
import type { TodoStatus } from '~/types'

// Shared state of a session's checklist, for the docked SessionTodoPanel (the banner),
// the Plan & Progress tab, and the inline transcript step.
//
// `Session.todos` is the CURRENT checklist and the single source of truth: the engine
// writes it on every TodoWrite and the user writes it by ticking a row, so both edits
// land in one place (see sidecar sessions/todo-context.ts). The transcript step is only
// a fallback for a session with no persisted list yet (a session last
// written before the field shipped).
//
// The banner stays pinned for as long as a checklist exists — expanded while work is
// active, collapsed to a one-line `done/total` strip once the turn ends. The inline
// transcript step takes over the full list at that point, so exactly one expanded copy
// is ever on screen; it renders the model's own snapshot as a historical record and is
// deliberately NOT editable (edits belong to the current list, not the log).
export function useSessionTodo(getSession: () => Session | null | undefined) {
  // Fallback source only (see the header): the most recent assistant TodoWrite (`note`)
  // step. Scanning from the end (messages, then blocks) keeps it current across
  // cancel/resume turn boundaries. Also drives the inline transcript record.
  const latestTodoStep = computed<StepBlock | null>(() => {
    const s = getSession()
    if (!s) return null
    const msgs = s.msgs
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const m = msgs[i]
      if (!m || m.role !== 'assistant') continue
      for (let j = m.blocks.length - 1; j >= 0; j -= 1) {
        const b = m.blocks[j]
        if (b && b.kind === 'step' && b.todos && b.todos.length > 0) return b
      }
    }
    return null
  })

  // Persisted current list wins; the transcript snapshot is the back-compat fallback.
  const todos = computed<Todo[]>(() => {
    const s = getSession()
    if (s?.todos?.length) return s.todos
    return latestTodoStep.value?.todos ?? []
  })
  const total = computed(() => todos.value.length)
  const doneCount = computed(() => todos.value.filter((td) => td.done).length)
  const allDone = computed(() => total.value > 0 && doneCount.value === total.value)

  // A turn is in flight (streaming OR parked on a question/permission gate).
  const isRunning = computed(() => {
    const s = getSession()
    if (!s) return false
    const last = s.msgs[s.msgs.length - 1]
    if (!last || last.role !== 'assistant') return false
    if (last.streaming) return true
    return last.blocks.some(
      (b) =>
        (b.kind === 'question' && !questionAnswered(b) && !b.cancelled) ||
        (b.kind === 'perm' && b.status === 'pending' && !b.cancelled),
    )
  })

  // Work is live: the turn is running and the latest list still has open items. This
  // drives the banner's *shape*, not its presence — while active the banner owns the
  // full expanded list.
  const isActive = computed(() => total.value > 0 && isRunning.value && !allDone.value)

  // Banner = pinned progress affordance. Visible for as long as a checklist exists,
  // including after the turn ends — that is exactly when the user asks "where are we?".
  // It collapses itself to a one-line strip when work is no longer active (see
  // SessionTodoPanel) so it never competes with the inline record below.
  const bannerVisible = computed(() => total.value > 0)

  // The todo step to render inline in the transcript: the latest one, but only once the
  // banner has stopped owning the full expanded list (so exactly one expanded copy is
  // on screen). Older, intermediate snapshots are never the latest, so they stay hidden.
  const inlineTodoStep = computed<StepBlock | null>(() =>
    isActive.value ? null : latestTodoStep.value,
  )

  // Click order for a row: pending → in_progress → completed → pending. One control
  // reaches all three states, so there is no separate "start"/"done" affordance.
  const NEXT_STATUS: Record<TodoStatus, TodoStatus> = {
    pending: 'in_progress',
    in_progress: 'completed',
    completed: 'pending',
  }

  // Advance one row and persist the whole list. Writes to the session's current
  // checklist (never to the transcript record), so the next turn re-injects the edit
  // and the model treats it as the state of the work rather than overwriting it.
  function cycleTodo(index: number) {
    const s = getSession()
    if (!s) return
    const current = todos.value
    const row = current[index]
    if (!row) return
    const status = NEXT_STATUS[row.status ?? (row.done ? 'completed' : 'pending')]
    const next = current.map((td, i) =>
      i === index ? { ...td, status, done: status === 'completed' } : td,
    )
    useSessionsStore().setTodos(s.id, next)
  }

  return {
    todos,
    total,
    doneCount,
    cycleTodo,
    allDone,
    isRunning,
    isActive,
    bannerVisible,
    latestTodoStep,
    inlineTodoStep,
  }
}
