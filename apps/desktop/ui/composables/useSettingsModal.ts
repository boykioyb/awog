// Settings modal — owns the global open/section state so the HeaderTabBar
// trigger and the modal stay in sync without prop threading (same `useState`
// pattern as `useWhatsNew`). Settings moved from a dedicated `/settings` route
// to a modal so it overlays the current page instead of replacing it.

export type SettingsSectionId =
  | 'appearance'
  | 'workspace'
  | 'git'
  | 'sessions'
  | 'defaults'
  | 'models'
  | 'about'

export const useSettingsModal = () => {
  const open = useState<boolean>('settings:open', () => false)
  const section = useState<SettingsSectionId>('settings:section', () => 'appearance')

  // Optional target lets callers deep-open to a section (e.g. "Models & API Keys").
  const openSettings = (target?: SettingsSectionId) => {
    if (target) section.value = target
    open.value = true
  }
  const closeSettings = () => {
    open.value = false
  }

  return { open, section, openSettings, closeSettings }
}
