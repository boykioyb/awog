import { readonly, ref } from 'vue'

// Desktop pet: temporary dismiss (docs/features/desktop-pet.md). A singleton
// module-scope ref, NOT part of usePetStatus — keeping it in its own file cuts the
// dependency cycle usePetStatus ↔ sessions (the store resets it, usePetStatus reads
// it). Runtime only, never persisted: dismiss is "hide it for now", and a fresh app
// launch should show the pet again.
const dismissed = ref(false)

export function usePetDismiss() {
  return {
    dismissed: readonly(dismissed),
    // Hide the pet until the next reset trigger.
    dismiss: () => {
      dismissed.value = true
    },
    // Show it again (a new prompt in any session, or the enabled toggle flipping on).
    resetDismiss: () => {
      dismissed.value = false
    },
  }
}
