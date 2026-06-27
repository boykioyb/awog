import { ref } from 'vue'

// Shared, app-wide state for the session fork-tree modal. One SessionForkTreeModal
// instance (mounted in the default layout) reads this so the trigger in the session
// detail header can open it without prop-drilling. Mirrors useSessionExportModal.
// `clientId` = the ui-next numeric session id the tree is rooted/centered on.
const clientId = ref<number | null>(null)

export function useSessionForkModal() {
  function open(id: number): void {
    clientId.value = id
  }
  function close(): void {
    clientId.value = null
  }
  return { clientId, open, close }
}
