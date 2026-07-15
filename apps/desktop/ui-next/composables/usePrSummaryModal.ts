import { ref } from 'vue'

// Shared, app-wide state for the PR summary modal. A single GitPrSummaryHost
// instance (mounted in the default layout) reads this store so the modal can be
// opened from anywhere — the ⌘I global shortcut (from a session, no need to open
// Git Manager first) OR the Git Manager branch context menu — without leaving the
// page. Two entry points, one modal.
//
// Module-level refs → one source of truth. `open(projectId, head?)` scopes the
// host's git store to that project; `head` overrides the branch to summarise
// (the context menu passes the clicked branch; ⌘I leaves it null → current branch).
const isOpen = ref(false)
const projectId = ref<string | null>(null)
const headOverride = ref<string | null>(null)

export function usePrSummaryModal() {
  function open(pid: string | null, head: string | null = null): void {
    projectId.value = pid
    headOverride.value = head
    isOpen.value = true
  }
  function close(): void {
    isOpen.value = false
  }
  return { isOpen, projectId, headOverride, open, close }
}
