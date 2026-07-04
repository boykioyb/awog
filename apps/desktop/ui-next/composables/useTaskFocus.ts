import { ref } from 'vue'

// Cross-view signal for focusing a specific task in the Tasks page. The tasks list
// (LibraryView) owns its selection internally, so restoring a minimized task PiP
// can't set it directly — instead we publish the wanted id here and the Tasks page
// binds it to LibraryView's `selectKey` (a one-way controllable-selection prop).
// Module-level ref → single source of truth for every caller.

const focusId = ref<string | null>(null)

export function useTaskFocus() {
  function focusTask(id: string): void {
    focusId.value = id
  }
  return { focusId, focusTask }
}
