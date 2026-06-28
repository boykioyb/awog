import { ref } from 'vue'

// Shared, app-wide state for the Project quick-view modal. A single
// ProjectQuickViewModal instance (mounted in the default layout) reads this store
// so a button rendered deep in a session can pop the project's detail (Overview /
// Issues / PRs) over the session — to peek info + GitHub issues/PRs — without
// navigating away. Mirrors useGitModal.
//
// `key` is the session's `project` value as-is (a project id OR display name); the
// modal resolves it to the real entity, so callers don't need to know which.
const isOpen = ref(false)
const key = ref<string | null>(null)

export function useProjectModal() {
  function open(projectKey: string | null): void {
    key.value = projectKey
    isOpen.value = true
  }
  function close(): void {
    isOpen.value = false
  }
  return { isOpen, key, open, close }
}
