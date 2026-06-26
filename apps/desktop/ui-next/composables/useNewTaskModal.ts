import { ref } from 'vue'

// Shared, app-wide state for the New Task modal (ADR 0055). A single
// NewTaskModalHost (mounted in the default layout) reads this store so the modal
// can be opened from anywhere — the Tasks page "New" button AND the session
// composer's "Run as task" — without each page hosting its own instance. Mirrors
// useGitModal. `seed` pre-fills the modal (project + title) and, when
// `originSessionId` is set, stamps the created task's source as that session.
export type NewTaskSeed = {
  projectId?: string
  title?: string
  // Pre-selects this workflow in the picker (e.g. opened from the Workflows "Run"
  // button). Ignored if the id isn't offered for the chosen project.
  workflowId?: string
  // When set, the task is spawned from this session: source = { type:'session',
  // sessionId: originSessionId }. The source picker (github/jira/manual) is hidden.
  originSessionId?: string
}

const open = ref(false)
const seed = ref<NewTaskSeed>({})

export function useNewTaskModal() {
  function openModal(s: NewTaskSeed = {}): void {
    seed.value = { ...s }
    open.value = true
  }
  function close(): void {
    open.value = false
  }
  return { open, seed, openModal, close }
}
