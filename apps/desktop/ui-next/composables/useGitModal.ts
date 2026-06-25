import { ref } from 'vue'

// Shared, app-wide state for the session Git modal. A single SessionGitModal
// instance (mounted in the default layout) reads this store so a button rendered
// deep in a session's workspace panel can pop the full Git Manager over the
// session without prop-drilling or leaving the page.
//
// Module-level refs → one source of truth for every caller. `open(projectId)`
// scopes the modal's Git Manager to that project; `close()` dismisses it.
const isOpen = ref(false)
const projectId = ref<string | null>(null)

export function useGitModal() {
  function open(pid: string | null): void {
    projectId.value = pid
    isOpen.value = true
  }
  function close(): void {
    isOpen.value = false
  }
  return { isOpen, projectId, open, close }
}
