import { ref } from 'vue'

// App-wide open state for ClaudeImportModal (mounted once in AppGlobalHosts). Triggers
// live in the Workbench sessions explorer header and the Sessions list ⋯ menu, so the
// state is a module-level ref instead of a prop chain. Mirrors useSessionExportModal.
const isOpen = ref(false)

export function useClaudeImportModal() {
  function open(): void {
    isOpen.value = true
  }
  function close(): void {
    isOpen.value = false
  }
  return { isOpen, open, close }
}
