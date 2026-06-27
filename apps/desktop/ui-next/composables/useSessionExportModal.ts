import { ref } from 'vue'

// Shared, app-wide state for the session Export modal. A single SessionExportModal
// instance (mounted in the default layout) reads this store, so a trigger in the
// session list context menu OR the session detail header can pop the export dialog
// without prop-drilling. Mirrors useGitModal.
//
// `sessionId` is the numeric ui-next client id (the modal resolves the Session from
// the store). null = closed.
const sessionId = ref<number | null>(null)

export function useSessionExportModal() {
  function open(id: number): void {
    sessionId.value = id
  }
  function close(): void {
    sessionId.value = null
  }
  return { sessionId, open, close }
}
