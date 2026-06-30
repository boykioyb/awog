import type { Session, StepBlock, Todo } from '~/composables/useSessionsData'

// Shared derivation of a session's live checklist. Both the docked SessionTodoPanel
// (the banner) and the inline transcript step read from here so they agree on ONE
// rule: the latest TodoWrite owns the display, it lives in the banner ONLY while the
// turn is running with open items, and once it finishes (all done) or the turn ends
// it renders inline as a normal step instead — never both at once, never flickering
// up during a reply that doesn't touch todos.
export function useSessionTodo(getSession: () => Session | null | undefined) {
  // The current checklist = the most recent assistant TodoWrite (`note`) step. Scanning
  // from the end (messages, then blocks) keeps it current across cancel/resume turn
  // boundaries: a new turn's checklist lands in a new block and we pick it up.
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

  const todos = computed<Todo[]>(() => latestTodoStep.value?.todos ?? getSession()?.todos ?? [])
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

  // Banner = the live, in-progress checklist. Visible ONLY while the turn runs and the
  // latest list still has open items. It yields the moment work finishes (all done) or
  // the turn ends — the checklist then re-appears as the inline step below.
  const bannerVisible = computed(() => total.value > 0 && isRunning.value && !allDone.value)

  // The todo step to render inline in the transcript: the latest one, but only while it
  // is NOT occupying the banner (so the checklist shows in exactly one place). Older,
  // intermediate snapshots are never the latest, so they stay hidden.
  const inlineTodoStep = computed<StepBlock | null>(() =>
    bannerVisible.value ? null : latestTodoStep.value,
  )

  return {
    todos,
    total,
    doneCount,
    allDone,
    isRunning,
    bannerVisible,
    latestTodoStep,
    inlineTodoStep,
  }
}
