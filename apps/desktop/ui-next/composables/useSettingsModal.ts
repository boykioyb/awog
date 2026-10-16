import type { SettingsSectionId } from '~/components/settings/sections'

// Settings modal — global open/section state (Nuxt `useState`) so the NavRail
// trigger and the modal stay in sync without prop threading. Ported from
// apps/desktop/ui/composables/useSettingsModal.ts. Settings is a modal overlay
// (not a route) so it sits over the current page like the legacy app.
export function useSettingsModal() {
  const open = useState<boolean>('settings:open', () => false)
  const section = useState<SettingsSectionId>('settings:section', () => 'appearance')
  // Dòng cài đặt cần cuộn tới + nháy sáng sau khi mở (tên hiển thị của nó — ⌘K tìm
  // cài đặt). SettingsModal tiêu thụ rồi đặt lại null.
  const focus = useState<string | null>('settings:focus', () => null)

  // Optional target lets callers deep-open to a section (e.g. 'models'); `focusLabel`
  // = tên của MỘT dòng cài đặt trong mục đó để cuộn tới.
  const openSettings = (target?: SettingsSectionId, focusLabel?: string) => {
    if (target) section.value = target
    focus.value = focusLabel ?? null
    open.value = true
  }
  const closeSettings = () => {
    open.value = false
  }

  return { open, section, focus, openSettings, closeSettings }
}
