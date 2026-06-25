import type { SettingsSectionId } from '~/components/settings/sections'

// Settings modal — global open/section state (Nuxt `useState`) so the NavRail
// trigger and the modal stay in sync without prop threading. Ported from
// apps/desktop/ui/composables/useSettingsModal.ts. Settings is a modal overlay
// (not a route) so it sits over the current page like the legacy app.
export function useSettingsModal() {
  const open = useState<boolean>('settings:open', () => false)
  const section = useState<SettingsSectionId>('settings:section', () => 'appearance')

  // Optional target lets callers deep-open to a section (e.g. 'models').
  const openSettings = (target?: SettingsSectionId) => {
    if (target) section.value = target
    open.value = true
  }
  const closeSettings = () => {
    open.value = false
  }

  return { open, section, openSettings, closeSettings }
}
