import { ref } from 'vue'

// Which status-bar config chip popover is open (model / account / effort / style),
// or null. Module-level so a single source of truth drives the StatusConfig popovers
// AND lets a remote caller pop one open — e.g. the composer's `/style` builtin still
// works after the style picker moved from the composer to the footer. Mirrors
// useGitModal / useProjectModal.
export type ConfigChip = 'model' | 'account' | 'effort' | 'style'

const openChip = ref<ConfigChip | null>(null)

export function useStatusConfig() {
  function open(c: ConfigChip): void {
    openChip.value = c
  }
  function toggle(c: ConfigChip): void {
    openChip.value = openChip.value === c ? null : c
  }
  function close(): void {
    openChip.value = null
  }
  return { openChip, open, toggle, close }
}
